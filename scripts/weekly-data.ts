/**
 * 주간 청약 데이터 만들기 (GitHub Actions가 매주 월요일 오전 6시에 실행. 내 컴퓨터에서도 실행 가능)
 *
 * 실행:  npx tsx scripts/weekly-data.ts                 데이터 + 새 공고 이미지 수집
 *        npx tsx scripts/weekly-data.ts --skip-images   이미지 수집 없이 데이터만
 *
 * 하는 일
 *  1) 청약홈 분양정보·무순위·경쟁률(당첨가점) API에서 이번 주(월~일, 한국시간) 일정과 지난주 당첨 결과를 받아
 *     data/weekly/2026-W48.json 처럼 주차별 파일로 저장 (홈 팝업이 이 파일을 먼저 읽음)
 *  2) 이번 주 새로 들어온 공고 중 이미지를 한 번도 확인하지 않은 단지만 collect-images를 돌려 auto-images.json에 추가
 *  3) data/tips.json에서 이번 주 팁 번호를 정해 파일에 같이 적음
 *  4) 점검: 일정 0건, 단지명·날짜 빈 값, 새 이미지 0건이면 요약(.weekly/summary.md)에 경고로 남김
 *
 * 공고·당첨가점 API를 받지 못하면 아무 파일도 쓰지 않고 실패(종료 코드 1)로 끝납니다. → 지난주 파일이 그대로 남음
 * 판정·계산 로직은 쓰지 않습니다. 숫자는 API 응답에 있는 값만 옮겨 적습니다.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { imageFor, imageKey } from "../lib/complexImage";
import { loadComplexes } from "../lib/complexes";
import { md } from "../lib/mySchedule";
import { SIMILAR_RULES } from "../lib/similar";
import { isoWeekId, lastWeekOf, tipIndexFor, weekOf, weekScheduleEvents, type Tip, type WeeklyFile } from "../lib/weekly-cards";

const ROOT = process.cwd();
const WEEKLY_DIR = path.join(ROOT, "data", "weekly");
const AUTO_IMAGES = path.join(ROOT, "data", "auto-images.json");
const OVERRIDES = path.join(ROOT, "data", "image-overrides.json");
const TIPS = path.join(ROOT, "data", "tips.json");
const SUMMARY_DIR = path.join(ROOT, ".weekly"); // 요약은 저장소에 올리지 않음 (.gitignore)

const SKIP_IMAGES = process.argv.includes("--skip-images");
const DOW = ["월", "화", "수", "목", "금", "토", "일"];

function loadEnv() {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function fail(message: string): never {
  console.error(`!! ${message}`);
  mkdirSync(SUMMARY_DIR, { recursive: true });
  writeFileSync(path.join(SUMMARY_DIR, "error.txt"), `${message}\n`, "utf8");
  process.exit(1);
}

/** 표 칸 안의 | 와 줄바꿈 정리 */
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

async function main() {
  loadEnv();
  if (!process.env.APPLYHOME_API_KEY) fail("APPLYHOME_API_KEY가 없습니다. GitHub 저장소 Settings > Secrets에 넣었는지 확인하세요.");
  const { fetchHistory, fetchNotices, fetchRemndrNotices } = await import("../lib/applyhome");

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const week = weekOf(today);
  const lastWeek = lastWeekOf(today);
  const id = isoWeekId(today);
  console.log(`기준 주간 ${id} (${week.start} ~ ${week.end}), 지난주 ${lastWeek.start} ~ ${lastWeek.end}`);

  // ── 1. API ──
  const [noticeRes, remndrRes, historyRes] = await Promise.all([
    fetchNotices(),
    fetchRemndrNotices(),
    fetchHistory(SIMILAR_RULES.yearsBack),
  ]);
  if (!noticeRes.ok) fail(`분양정보 API 실패: ${noticeRes.reason}`);
  if (!historyRes.ok) fail(`경쟁률(당첨가점) API 실패: ${historyRes.reason}`);
  const warnings: string[] = [];
  if (!remndrRes.ok) warnings.push(`무순위·잔여세대 API를 받지 못해 그 카드는 빠집니다 (${remndrRes.reason})`);

  const inRange = (w: { start: string; end: string }, s: string | null | undefined, e?: string | null) => !!s && s <= w.end && (e ?? s) >= w.start;
  const events = weekScheduleEvents(noticeRes.notices, today);
  const eventNos = new Set(events.map((e) => e.key.slice(0, e.key.lastIndexOf("-"))));
  const lastWeekNos = new Set(noticeRes.notices.filter((n) => inRange(lastWeek, n.schedule.winner)).map((n) => n.houseManageNo));
  const notices = noticeRes.notices.filter((n) => eventNos.has(n.houseManageNo) || lastWeekNos.has(n.houseManageNo));
  const remndr = remndrRes.ok ? remndrRes.notices.filter((r) => inRange(week, r.receiptStart, r.receiptEnd)) : [];
  const lastWeekRows = historyRes.rows.filter((r) => lastWeekNos.has(r.no));

  // ── 3. 이번 주 팁 ──
  const tips = readJson<{ tips?: Tip[] }>(TIPS, {}).tips ?? [];
  const tipIndex = tipIndexFor(today, tips.length);

  // ── 4. 점검 (단지명·날짜) ──
  if (events.length === 0) warnings.push("이번 주 일정(특별공급·1순위 접수, 당첨자 발표)이 0건입니다.");
  for (const n of notices) {
    if (!n.name || n.name === "(이름 없음)") warnings.push(`단지명이 빈 공고가 있습니다 (주택관리번호 ${n.houseManageNo}).`);
    if (!n.noticeDate) warnings.push(`공고일이 빈 공고: ${n.name}`);
    if (!n.schedule.special && !n.schedule.rank1 && !n.schedule.winner) warnings.push(`접수·발표 날짜가 모두 빈 공고: ${n.name}`);
  }
  for (const r of remndr) {
    if (!r.name || r.name === "(이름 없음)") warnings.push(`단지명이 빈 무순위 공고가 있습니다 (주택관리번호 ${r.houseManageNo}).`);
  }

  // ── 2. 새로 들어온 공고 이미지 ──
  const prevFile = readdirSync(existsSync(WEEKLY_DIR) ? WEEKLY_DIR : ROOT)
    .filter((f) => /^\d{4}-W\d{2}\.json$/.test(f) && f !== `${id}.json`)
    .sort()
    .at(-1);
  const prev = prevFile ? readJson<WeeklyFile | null>(path.join(WEEKLY_DIR, prevFile), null) : null;
  const prevNos = new Set(prev?.notices.map((n) => n.houseManageNo) ?? []);
  const newNotices = notices.filter((n) => eventNos.has(n.houseManageNo) && !prevNos.has(n.houseManageNo));

  const manual = loadComplexes().images;
  const overrides = new Set(Object.keys(readJson<Record<string, unknown>>(OVERRIDES, {})).filter((k) => !k.startsWith("_")).map(imageKey));
  type Img = { items?: { name: string }[]; skipped?: { name: string; reason: string }[] };
  const before = readJson<Img>(AUTO_IMAGES, {});
  const knownBefore = new Set([...(before.items ?? []), ...(before.skipped ?? [])].map((x) => imageKey(x.name)));
  const status = new Map<string, string>(); // 주택관리번호 → 이미지 결과
  const targets: string[] = [];
  for (const n of newNotices) {
    const key = imageKey(n.name);
    if (imageFor(manual, n.name) || overrides.has(key)) status.set(n.houseManageNo, "직접 지정 (수집 안 함)");
    else if (knownBefore.has(key)) status.set(n.houseManageNo, "기존 결과 사용 (다시 수집 안 함)");
    else targets.push(n.houseManageNo);
  }

  let imageOk = 0;
  let imageMap = 0;
  if (targets.length && SKIP_IMAGES) {
    for (const no of targets) status.set(no, "수집 건너뜀 (--skip-images)");
  } else if (targets.length) {
    console.log(`\n새 공고 ${targets.length}건 이미지 수집 시작`);
    const run = spawnSync("npx", ["tsx", "scripts/collect-images.ts", "--new-only", `--nos=${targets.join(",")}`], {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    if (run.status !== 0) warnings.push("이미지 수집 도구가 중간에 멈췄습니다. 이번 주 새 이미지는 반영되지 않았을 수 있습니다.");
    const after = readJson<Img>(AUTO_IMAGES, {});
    // 모집공고 PDF에서 찾은 조감도는 complexes.csv에 적히므로 새로 읽음
    const csvNow = loadComplexes().images;
    const items = new Set((after.items ?? []).map((x) => imageKey(x.name)));
    const skipped = new Map((after.skipped ?? []).map((x) => [imageKey(x.name), x.reason]));
    for (const no of targets) {
      const n = notices.find((x) => x.houseManageNo === no)!;
      const key = imageKey(n.name);
      if (items.has(key)) {
        status.set(no, "성공");
        imageOk += 1;
      } else if ((csvNow[key]?.source ?? "").startsWith("입주자모집공고")) {
        status.set(no, "성공 (모집공고 PDF)");
        imageOk += 1;
      } else if (skipped.has(key)) {
        status.set(no, `지도 대체 (${skipped.get(key)})`);
        imageMap += 1;
      } else status.set(no, "결과 없음");
    }
  }
  if (!SKIP_IMAGES && imageOk === 0) {
    warnings.push(targets.length ? `새 공고 ${targets.length}건 중 이미지가 새로 잡힌 단지가 없습니다 (모두 지도 썸네일).` : "새로 수집할 공고가 없어 새 이미지가 0건입니다.");
  }

  // ── 파일 쓰기 (여기까지 왔으면 API는 성공) ──
  const file: WeeklyFile & { _설명: string } = {
    _설명: "scripts/weekly-data.ts(GitHub Actions)가 매주 만드는 파일입니다. 직접 고치지 마세요. 홈 '이번 주 청약 소식' 팝업이 이 파일을 먼저 읽습니다.",
    week: id,
    start: week.start,
    end: week.end,
    generatedAt: new Date().toISOString(),
    tipIndex,
    notices,
    remndr,
    lastWeekRows,
  };
  mkdirSync(WEEKLY_DIR, { recursive: true });
  writeFileSync(path.join(WEEKLY_DIR, `${id}.json`), `${JSON.stringify(file, null, 2)}\n`, "utf8");

  // ── 요약 (PR 본문) ──
  const perDay = DOW.map((d, i) => {
    const date = new Date(Date.UTC(+week.start.slice(0, 4), +week.start.slice(5, 7) - 1, +week.start.slice(8, 10) + i)).toISOString().slice(0, 10);
    return { label: `${d} ${md(date)}`, count: events.filter((e) => e.date === date).length };
  });
  const lines = [
    `## ${id} 주간 청약 데이터`,
    "",
    `${week.start}(월) ~ ${week.end}(일), 한국시간 기준 · 생성 ${file.generatedAt}`,
    "",
    "| 항목 | 값 |",
    "| --- | --- |",
    `| 이번 주 일정 (특별공급·1순위 접수, 당첨자 발표) | ${events.length}건 |`,
    `| 일정이 있는 공고 | ${eventNos.size}건 |`,
    `| 이번 주 무순위·잔여세대 접수 | ${remndr.length}건 |`,
    `| 지난주 당첨자 발표 공고 / 당첨가점 줄 | ${lastWeekNos.size}건 / ${lastWeekRows.length}줄 |`,
    `| 이번 주 팁 | ${tips.length ? `${tipIndex + 1}번 "${cell(tips[tipIndex].title)}"` : "팁 없음"} |`,
    `| 이미지 수집 | 대상 ${targets.length}건 · 성공 ${imageOk}건 · 지도 대체 ${imageMap}건${SKIP_IMAGES ? " (건너뜀)" : ""} |`,
    "",
    "### 요일별 건수",
    "",
    `| ${perDay.map((d) => d.label).join(" | ")} |`,
    `| ${perDay.map(() => "---").join(" | ")} |`,
    `| ${perDay.map((d) => `${d.count}건`).join(" | ")} |`,
    "",
    `### 새로 추가된 공고 (${prev ? `지난 파일 ${prev.week}에 없던 공고` : "지난 파일 없음 → 이번 주 일정 공고 전체"})`,
    "",
    ...(newNotices.length
      ? ["| 단지 | 지역 | 공고일 | 이미지 |", "| --- | --- | --- | --- |", ...newNotices.map((n) => `| ${cell(n.name)} | ${cell(`${n.region} ${n.unit}`.trim())} | ${n.noticeDate ?? "데이터 없음"} | ${cell(status.get(n.houseManageNo) ?? "")} |`)]
      : ["새로 추가된 공고가 없습니다."]),
    "",
    "### 경고",
    "",
    ...(warnings.length ? ["| # | 내용 |", "| --- | --- |", ...warnings.map((w, i) => `| ${i + 1} | ${cell(w)} |`)] : ["경고 없음"]),
    "",
    "---",
    "Vercel 미리보기 주소에서 홈 팝업을 확인한 뒤 직접 병합해 주세요. 이 PR은 GitHub Actions가 자동으로 만들었습니다.",
  ];
  mkdirSync(SUMMARY_DIR, { recursive: true });
  writeFileSync(path.join(SUMMARY_DIR, "summary.md"), `${lines.join("\n")}\n`, "utf8");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `week=${id}\n`);

  console.log(`\ndata/weekly/${id}.json 저장 · 일정 ${events.length}건 · 경고 ${warnings.length}건`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
}

main().catch((e) => fail(`예상하지 못한 오류: ${e instanceof Error ? e.message : String(e)}`));
