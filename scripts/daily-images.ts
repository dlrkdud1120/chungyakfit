/**
 * 새 공고 조감도 매일 모으기 (GitHub Actions가 매일 오전 7시에 실행. 내 컴퓨터에서도 실행 가능)
 *
 * 실행:  npx tsx scripts/daily-images.ts
 *
 * 하는 일
 *  1) 청약홈에서 최근 분양 공고와 무순위·잔여세대 공고를 받음
 *  2) 그중 이미지를 한 번도 확인하지 않은 단지만 골라 collect-images --new-only로 모음
 *     (직접 넣은 조감도·image-overrides.json이 있는 단지, 이미 확인한 단지는 건너뜀)
 *  3) 단지별 결과를 .daily/summary.md에 적음 → PR 본문. 성공한 단지는 이미지 주소를 같이 적어 PR에서 바로 확인
 *  4) GITHUB_OUTPUT에 count(이번에 확인한 단지 수)를 남김. 0이면 PR을 만들지 않음
 *
 * 이미지 우선순위와 고르는 기준은 collect-images와 같고, 여기서는 대상만 정합니다.
 * 공고 API를 받지 못하면 아무 파일도 쓰지 않고 실패(종료 코드 1)로 끝납니다.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { imageFor, imageKey } from "../lib/complexImage";
import { loadComplexes } from "../lib/complexes";
import { PDF_SOURCE } from "../lib/image-resolve";
import { loadEnv, readJson } from "./image-targets";

const ROOT = process.cwd();
const AUTO_IMAGES = path.join(ROOT, "data", "auto-images.json");
const OVERRIDES = path.join(ROOT, "data", "image-overrides.json");
const SUMMARY_DIR = path.join(ROOT, ".daily"); // 요약은 저장소에 올리지 않음 (.gitignore)

type Img = { items?: { name: string; image: string; review?: boolean }[]; skipped?: { name: string; reason: string }[] };
type Target = { no: string; name: string; region: string; noticeDate: string | null; group: "분양 공고" | "무순위" };

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function fail(message: string): never {
  console.error(`!! ${message}`);
  mkdirSync(SUMMARY_DIR, { recursive: true });
  writeFileSync(path.join(SUMMARY_DIR, "error.txt"), `${message}\n`, "utf8");
  process.exit(1);
}

async function main() {
  loadEnv();
  if (!process.env.APPLYHOME_API_KEY) fail("APPLYHOME_API_KEY가 없습니다. GitHub 저장소 Settings > Secrets에 넣었는지 확인하세요.");
  const { fetchNotices, fetchRemndrNotices } = await import("../lib/applyhome");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

  const [noticeRes, remndrRes] = await Promise.all([fetchNotices(), fetchRemndrNotices()]);
  if (!noticeRes.ok) fail(`분양정보 API 실패: ${noticeRes.reason}`);
  const warnings: string[] = [];
  if (!remndrRes.ok) warnings.push(`무순위·잔여세대 API를 받지 못해 무순위 공고는 이번에 빠졌습니다 (${remndrRes.reason})`);

  const area = (region: string, unit: string) => `${region} ${unit}`.trim();
  const all: Target[] = [
    ...noticeRes.notices.map((n) => ({ no: n.houseManageNo, name: n.name, region: area(n.region, n.unit), noticeDate: n.noticeDate ?? null, group: "분양 공고" as const })),
    ...(remndrRes.ok ? remndrRes.notices.map((n) => ({ no: n.houseManageNo, name: n.name, region: area(n.region, n.unit), noticeDate: n.noticeDate ?? null, group: "무순위" as const })) : []),
  ];

  // 처음 보는 단지만 (이름 기준 한 번만)
  const manual = loadComplexes().images;
  const overrides = new Set(Object.keys(readJson<Record<string, unknown>>(OVERRIDES, {})).filter((k) => !k.startsWith("_")).map(imageKey));
  const before = readJson<Img>(AUTO_IMAGES, {});
  const known = new Set([...(before.items ?? []), ...(before.skipped ?? [])].map((x) => imageKey(x.name)));
  const seen = new Set<string>();
  const targets = all.filter((t) => {
    const k = imageKey(t.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return !imageFor(manual, t.name) && !overrides.has(k) && !known.has(k);
  });
  console.log(`${today} · 최근 공고 ${all.length}건 중 처음 보는 단지 ${targets.length}곳`);

  if (targets.length) {
    const run = spawnSync("npx", ["tsx", "scripts/collect-images.ts", "--new-only", "--scope=all", `--nos=${targets.map((t) => t.no).join(",")}`], {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    if (run.status !== 0) warnings.push("이미지 수집 도구가 중간에 멈췄습니다. 일부 단지는 결과가 없을 수 있습니다.");
  }

  // 결과 정리
  const after = readJson<Img>(AUTO_IMAGES, {});
  const items = new Map((after.items ?? []).map((x) => [imageKey(x.name), x]));
  const skipped = new Map((after.skipped ?? []).map((x) => [imageKey(x.name), x.reason]));
  const csvNow = loadComplexes().images;
  let ok = 0;
  const rows = targets.map((t) => {
    const k = imageKey(t.name);
    const item = items.get(k);
    const pdf = csvNow[k];
    let result: string;
    let image = "–";
    if (item) {
      ok += 1;
      result = item.review ? "성공 (확인 필요)" : "성공";
      image = `[보기](${item.image})`;
    } else if (pdf && (pdf.source ?? "").startsWith(PDF_SOURCE)) {
      ok += 1;
      result = "성공 (모집공고 PDF)";
      image = `\`${pdf.src}\``;
    } else if (skipped.has(k)) result = `지도 대체 (${skipped.get(k)})`;
    else result = "결과 없음";
    return `| ${cell(t.name)} | ${t.group} | ${cell(t.region)} | ${t.noticeDate ?? "데이터 없음"} | ${cell(result)} | ${image} |`;
  });
  if (targets.length && ok === 0) warnings.push(`처음 보는 단지 ${targets.length}곳 중 이미지가 잡힌 단지가 없습니다 (모두 지도 썸네일).`);

  const lines = [
    `## ${today} 새 공고 조감도`,
    "",
    `최근 분양 공고·무순위 ${all.length}건 중 처음 보는 단지 **${targets.length}곳** · 이미지 찾음 **${ok}곳** · 지도 대체 ${targets.length - ok}곳`,
    "",
    ...(rows.length ? ["| 단지 | 구분 | 지역 | 공고일 | 결과 | 이미지 |", "| --- | --- | --- | --- | --- | --- |", ...rows] : ["처음 보는 단지가 없습니다."]),
    "",
    "### 경고",
    "",
    ...(warnings.length ? warnings.map((w) => `- ${w}`) : ["경고 없음"]),
    "",
    "---",
    "이미지를 확인하고 병합해 주세요. 엉뚱한 사진은 이 PR에서 빼거나, 병합 후 /admin/images에서 \"지도 사용\"으로 바꾸면 됩니다.",
    "병합하지 않으면 다음 날 실행 때 이 PR이 그날 결과로 새로 바뀝니다. 이 PR은 GitHub Actions가 자동으로 만들었습니다.",
  ];
  mkdirSync(SUMMARY_DIR, { recursive: true });
  writeFileSync(path.join(SUMMARY_DIR, "summary.md"), `${lines.join("\n")}\n`, "utf8");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `count=${targets.length}\ndate=${today}\n`);
  console.log(`\n처음 보는 단지 ${targets.length}곳 · 이미지 찾음 ${ok}곳`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
}

main().catch((e) => fail(`예상하지 못한 오류: ${e instanceof Error ? e.message : String(e)}`));
