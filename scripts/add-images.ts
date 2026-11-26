/**
 * 직접 구한 조감도 넣기 (우리 컴퓨터에서 실행. 앱 실행과는 무관)
 *
 * 쓰는 법
 *  1) 프로젝트의 to-add/ 폴더에 단지명 그대로 이미지를 넣음        예: to-add/광교 자연앤 센트레빌.jpg
 *     출처를 같이 적으려면 파일 이름 뒤에 "__출처"를 붙임           예: to-add/광교 자연앤 센트레빌__GH 모집공고.jpg
 *  2) npm run add-images
 *
 * 하는 일
 *  - 파일 이름의 단지명을 대상 단지(scripts/image-targets.ts, 청약홈 API)와 맞춤. 띄어쓰기·괄호 차이는 무시하고,
 *    딱 맞는 단지가 없으면 비슷한 이름 후보를 보여 주고 번호로 고르게 함 (0 또는 Enter = 건너뛰기)
 *  - 가로 1200px 이하로 줄이고 webp로 바꿔 public/images/complexes/add-주택관리번호.webp 로 저장
 *  - data/complexes.csv에 그 단지의 "조감도 파일명"·"이미지 출처"를 적음 (조감도만 적는 줄. 이미 그런 줄이 있으면 고침)
 *    출처가 없으면 "출처 확인 필요"로 적고 끝에 목록으로 알려 줌
 *  - 넣은 파일은 to-add/에서 지움 (건너뛴 파일은 남겨 둠). 끝나면 아직 지도로 남은 단지 수를 알려 줌
 * 이미지 우선순위(image-overrides.json > complexes.csv 조감도 > 자동 수집 > 지도)는 그대로입니다.
 * image-overrides.json에 직접 지정이 있는 단지는 그 값이 먼저라, 넣어도 화면에는 바뀌지 않는다고 알려 줍니다.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import sharp from "sharp";
import { loadImageTargets, readJson, type ImageTarget } from "./image-targets";

const ROOT = process.cwd();
const INBOX = path.join(ROOT, "to-add");
const IMAGE_DIR_FS = path.join(ROOT, "public", "images", "complexes");
const CSV_FILE = path.join(ROOT, "data", "complexes.csv");
const EXT = /\.(jpe?g|png|webp|avif|gif|tiff?|bmp)$/i;
const MAX_WIDTH = 1200;
const NO_SOURCE = "출처 확인 필요";

/** 비교용: 띄어쓰기·괄호 안 글자·[정정공고] 같은 머리말을 빼고 소문자로 */
const loose = (s: string) =>
  s
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();

/** 두 글자씩 끊어 겹치는 비율 (0~1) */
function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let hit = 0;
  for (const [g, n] of ga) hit += Math.min(n, gb.get(g) ?? 0);
  const total = Math.max(a.length - 1, 0) + Math.max(b.length - 1, 0);
  const dice = total ? (2 * hit) / total : 0;
  return a.includes(b) || b.includes(a) ? Math.max(dice, 0.75) : dice;
}

/** CSV 한 칸 (쉼표·따옴표가 있으면 따옴표로 감쌈) */
const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

async function main() {
  mkdirSync(INBOX, { recursive: true });
  const files = readdirSync(INBOX).filter((f) => EXT.test(f));
  if (!files.length) {
    console.log("to-add/ 폴더에 이미지가 없습니다. 단지명으로 이름을 붙인 이미지를 넣고 다시 실행해 주세요.\n예: to-add/광교 자연앤 센트레빌__GH 모집공고.jpg");
    return;
  }

  const loaded = await loadImageTargets();
  if (!loaded.ok) {
    console.log(`!! 단지 목록을 받지 못했습니다: ${loaded.reason}\n   .env.local에 APPLYHOME_API_KEY가 있는지 확인해 주세요. 파일은 그대로 두었습니다.`);
    process.exit(1);
  }
  const targets = loaded.targets;
  const { imageKey } = await import("../lib/complexImage");
  const { resolveImage } = await import("../lib/image-resolve");
  const overrides = readJson<Record<string, unknown>>(path.join(ROOT, "data", "image-overrides.json"), {});
  const overrideKeys = new Set(Object.keys(overrides).filter((k) => !k.startsWith("_")).map(imageKey));

  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const done: { file: string; target: ImageTarget; saved: string; source: string; overridden: boolean }[] = [];
  const skipped: { file: string; why: string }[] = [];

  for (const file of files) {
    const base = file.replace(EXT, "");
    const [rawName, ...rest] = base.split("__");
    const typed = rawName.trim();
    const source = rest.join("__").trim() || NO_SOURCE;

    // 1) 단지 맞추기: 띄어쓰기 무시 → 괄호·머리말까지 무시 → 비슷한 이름 고르기
    let target = targets.find((t) => imageKey(t.name) === imageKey(typed)) ?? null;
    if (!target) {
      const same = targets.filter((t) => loose(t.name) === loose(typed));
      if (same.length === 1) target = same[0];
    }
    if (!target) {
      const ranked = targets
        .map((t) => ({ t, score: similarity(loose(typed), loose(t.name)) }))
        .filter((x) => x.score >= 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      if (!ranked.length) {
        skipped.push({ file, why: "비슷한 이름의 단지가 없음 (docs/missing-images.md의 단지명을 확인해 주세요)" });
        continue;
      }
      console.log(`\n"${typed}"와 딱 맞는 단지가 없어요. 비슷한 단지:`);
      ranked.forEach((x, i) => console.log(`  ${i + 1}) ${x.t.name}  (${x.t.region}, ${x.t.group})`));
      if (!rl) {
        skipped.push({ file, why: "이름이 딱 맞지 않음 (터미널에서 직접 실행하면 번호로 고를 수 있어요)" });
        continue;
      }
      const answer = (await rl.question("  어느 단지인가요? 번호 (0 또는 Enter = 건너뛰기): ")).trim();
      const pick = Number(answer);
      if (!answer || !Number.isInteger(pick) || pick < 1 || pick > ranked.length) {
        skipped.push({ file, why: "건너뜀" });
        continue;
      }
      target = ranked[pick - 1].t;
    }

    // 2) 줄여서 webp로 저장 (주택관리번호로 이름을 붙여 한글·띄어쓰기 없는 주소로)
    const saved = `add-${target.no || createHash("sha1").update(imageKey(target.name)).digest("hex").slice(0, 10)}.webp`;
    try {
      const buf = await sharp(readFileSync(path.join(INBOX, file)))
        .rotate() // 휴대폰 사진의 회전 정보 반영
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      mkdirSync(IMAGE_DIR_FS, { recursive: true });
      writeFileSync(path.join(IMAGE_DIR_FS, saved), buf);
    } catch (e) {
      skipped.push({ file, why: `이미지를 읽지 못함 (${String(e).slice(0, 80)})` });
      continue;
    }
    done.push({ file, target, saved, source, overridden: overrideKeys.has(imageKey(target.name)) });
    console.log(`  ✓ ${file} → ${target.name} (${saved})`);
  }
  rl?.close();

  // 3) complexes.csv: 조감도만 적는 줄을 고치거나 덧붙임 (BOM·줄바꿈 방식은 그대로)
  if (done.length) {
    const raw = readFileSync(CSV_FILE, "utf8");
    const nl = raw.includes("\r\n") ? "\r\n" : "\n";
    const lines = raw.replace(/\s*$/, "").split(/\r?\n/);
    const header = lines[0].replace(/^﻿/, "").split(",");
    const iImage = header.indexOf("조감도 파일명");
    const iSource = header.indexOf("이미지 출처");
    if (iImage < 0 || iSource < 0) throw new Error("complexes.csv에 '조감도 파일명'·'이미지 출처' 열이 없습니다.");
    for (const d of done) {
      const cells = Array(header.length).fill("");
      cells[0] = csvCell(d.target.name);
      cells[iImage] = csvCell(d.saved);
      cells[iSource] = csvCell(d.source);
      const row = cells.join(",");
      // 같은 단지의 "조감도만 적은 줄"(주택형 칸이 빈 줄)이 있으면 그 줄을 바꿈. 따옴표 없는 단순한 줄만 비교
      const at = lines.findIndex((l, i) => {
        if (i === 0) return false;
        const c = l.split(",");
        return c.length === header.length && imageKey(c[0]) === imageKey(d.target.name) && !c[3] && !!c[iImage];
      });
      if (at > 0) lines[at] = row;
      else lines.push(row);
    }
    writeFileSync(CSV_FILE, `${lines.join(nl)}${nl}`, "utf8");
  }

  // 4) 넣은 파일만 to-add/에서 지움
  for (const d of done) rmSync(path.join(INBOX, d.file), { force: true });

  // 5) 결과
  const remaining = targets.filter((t) => !resolveImage(t.name).image);
  console.log(`\n넣음 ${done.length}개 · 건너뜀 ${skipped.length}개`);
  for (const s of skipped) console.log(`  - ${s.file}: ${s.why} (to-add/에 남겨 둠)`);
  const noSource = done.filter((d) => d.source === NO_SOURCE);
  if (noSource.length) {
    console.log(`\n출처를 "${NO_SOURCE}"로 넣은 단지 ${noSource.length}곳 (data/complexes.csv의 "이미지 출처" 칸을 채워 주세요):`);
    for (const d of noSource) console.log(`  - ${d.target.name}`);
  }
  const hidden = done.filter((d) => d.overridden);
  if (hidden.length) {
    console.log(`\n아래 단지는 data/image-overrides.json의 직접 지정이 먼저라 화면에는 그 값이 나옵니다. 새 이미지를 쓰려면 /admin/images에서 "지정 해제"하세요:`);
    for (const d of hidden) console.log(`  - ${d.target.name}`);
  }
  console.log(`\n아직 지도로 남은 단지: ${remaining.length}곳 / 전체 ${targets.length}곳 (목록 다시 만들기: npm run missing-images)`);
  if (existsSync(INBOX) && readdirSync(INBOX).filter((f) => EXT.test(f)).length === 0) console.log("to-add/ 폴더를 비웠습니다.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
