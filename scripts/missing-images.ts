/**
 * 지도 썸네일로 나오는 단지 목록 만들기 → docs/missing-images.md (우리 컴퓨터에서 실행. 앱 실행과는 무관)
 *
 * 실행:  npm run missing-images
 *
 * - 대상은 npm run collect-images와 같은 범위 (scripts/image-targets.ts)
 * - 화면과 똑같이 lib/image-resolve.ts로 이미지를 정해 보고, 결과가 "지도"·"숨김"인 단지만 적습니다.
 * - 단지마다: 지역, 공급기관(사업주체), 분양 홈페이지, 청약홈 공고, 모집공고 PDF(청약홈 첨부), 자동 수집이 실패한 이유,
 *   /admin/images 고르기 화면에 후보 이미지가 있는지, 같은 지구·블록의 다른 공고와 이미지를 같이 쓸 수 있는지.
 * - 모집공고 PDF 링크는 청약홈 공고 페이지의 첨부 주소만 읽어 적습니다 (PDF 내용은 받지 않음, 파일 이름 확인용 응답 머리만 봄).
 * 우선순위 규칙이나 데이터 파일은 바꾸지 않습니다.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadImageTargets, readJson, type ImageTarget } from "./image-targets";

const OUT = path.join(process.cwd(), "docs", "missing-images.md");
const CANDIDATES = path.join(process.cwd(), "data", "image-candidates.json");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 chungyakfit-bot/1.0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = ImageTarget & {
  kind: string;
  reason: string;
  candidates: number;
  pdf: string | null;
  key: string | null; // 같은 지구·블록 열쇠
  twinWithImage: string | null; // 같은 지구·블록에서 이미지가 있는 다른 공고
};

/** 청약홈 공고 페이지의 첨부 중 입주자모집공고 PDF 주소 (이름에 "모집공고"가 있으면 그것, 없으면 첫 PDF) */
async function pdfLink(noticeUrl: string | null): Promise<string | null> {
  if (!noticeUrl) return null;
  const html = await fetch(noticeUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) })
    .then((r) => (r.ok ? r.text() : ""))
    .catch(() => "");
  const links = [...new Set([...html.matchAll(/https?:\/\/[^"'\s<>]*getAtchmnfl\.do\?[^"'\s<>]+/g)].map((m) => m[0].replace(/&amp;/g, "&")))].slice(0, 4);
  let first: string | null = null;
  for (const link of links) {
    const res = await fetch(link, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!res?.ok) continue;
    const cd = res.headers.get("content-disposition") ?? "";
    await res.body?.cancel().catch(() => {}); // 내용은 받지 않음
    const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="?([^";]+)/i.exec(cd)?.[1] ?? "");
    if (!/\.pdf$/i.test(name) && !/pdf/i.test(res.headers.get("content-type") ?? "")) continue;
    if (/모집공고/.test(name)) return link;
    first ??= link;
  }
  return first;
}

const cell = (s: string | null | undefined) => (s ? s.replace(/\|/g, "\\|").replace(/\n/g, " ") : "–");
const link = (label: string, url: string | null) => (url ? `[${label}](${url})` : "–");

async function main() {
  const loaded = await loadImageTargets();
  if (!loaded.ok) {
    console.log(`!! 공고 목록을 받지 못했습니다: ${loaded.reason}\n   .env.local에 APPLYHOME_API_KEY가 있는지 확인해 주세요.`);
    process.exit(1);
  }
  const { resolveImage } = await import("../lib/image-resolve");
  const { imageKey } = await import("../lib/complexImage");
  const { complexKey } = await import("../lib/public-source");
  const cand = readJson<{ byName?: Record<string, { candidates?: unknown[] }> }>(CANDIDATES, {}).byName ?? {};
  const candCount = new Map(Object.entries(cand).map(([k, v]) => [imageKey(k), v.candidates?.length ?? 0]));

  const all = loaded.targets.map((t) => ({ t, r: resolveImage(t.name), key: complexKey(t.name) }));
  // 같은 지구·블록 공고 중 이미지가 있는 것
  const withImage = new Map<string, string>();
  for (const { t, r, key } of all) if (key && r.image && !withImage.has(key)) withImage.set(key, t.name);

  const missing = all.filter(({ r }) => !r.image);
  const groups = loaded.targets.reduce<Record<string, number>>((a, t) => ((a[t.group] = (a[t.group] ?? 0) + 1), a), {});
  console.log(`대상: ${Object.entries(groups).map(([g, n]) => `${g} ${n}`).join(", ")}`);
  console.log(`대상 ${all.length}곳 중 지도 썸네일 ${missing.length}곳. 모집공고 PDF 링크를 찾는 중…`);

  const rows: Row[] = [];
  let i = 0;
  for (const { t, r, key } of missing) {
    i += 1;
    const pdf = await pdfLink(t.noticeUrl);
    if (i % 10 === 0) console.log(`  ${i}/${missing.length}`);
    await sleep(300);
    rows.push({
      ...t,
      kind: r.kind,
      reason: r.kind === "숨김" ? "image-overrides.json에서 지도 사용(hide)으로 지정" : (r.note ?? "–"),
      candidates: candCount.get(imageKey(t.name)) ?? 0,
      pdf,
      key,
      twinWithImage: key ? (withImage.get(key) ?? null) : null,
    });
  }

  // 같은 지구·블록끼리 붙여 놓고, 묶음 이름을 붙임 (공고가 둘 이상이거나 이미지 있는 공고가 있을 때만)
  const keyCount = new Map<string, number>();
  for (const x of rows) if (x.key) keyCount.set(x.key, (keyCount.get(x.key) ?? 0) + 1);
  const groupOf = (x: Row) => (x.key && ((keyCount.get(x.key) ?? 0) > 1 || x.twinWithImage) ? x.key.replace("|", " ") : null);
  const sortRows = (list: Row[]) => [...list].sort((a, b) => (groupOf(a) ?? "~").localeCompare(groupOf(b) ?? "~", "ko") || a.name.localeCompare(b.name, "ko"));

  const share = rows.filter((x) => x.twinWithImage);
  const pick = rows.filter((x) => !x.twinWithImage && x.candidates > 0);
  const manual = rows.filter((x) => !x.twinWithImage && x.candidates === 0);

  const head = "| 묶음(같은 지구) | 단지명 | 지역 | 공급기관 | 분양 홈페이지 | 청약홈 공고 | 모집공고 PDF | 자동 수집이 실패한 이유 |\n|---|---|---|---|---|---|---|---|";
  const line = (x: Row, extra = "") =>
    `| ${cell(groupOf(x))} | ${cell(x.name)}${extra} | ${cell(x.region)} | ${cell(x.developer)} | ${link("열기", x.homepage && /^https?:/i.test(x.homepage) ? x.homepage : null)} | ${link("청약홈", x.noticeUrl)} | ${link("PDF", x.pdf)} | ${cell(x.reason)} |`;
  const table = (list: Row[], extra: (x: Row) => string = () => "") => (list.length ? `${head}\n${sortRows(list).map((x) => line(x, extra(x))).join("\n")}` : "없음");

  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const md = `# 지도 썸네일로 나오는 단지 (${today} 기준)

\`npm run missing-images\`로 만든 목록입니다. 다시 만들면 이 파일을 덮어씁니다.

- 대상: 최근 분양 공고 + 무순위·잔여세대 + 단지 비교에 나오는 지난 공고 **${all.length}곳**
- 지금 지도 썸네일: **${rows.length}곳** (이미지 우선순위: image-overrides.json > complexes.csv 조감도 > 자동 수집 > 지도)
  - 같은 지구의 다른 공고 이미지를 같이 쓸 수 있음: ${share.length}곳
  - /admin/images에 후보 이미지가 있음 (클릭으로 고르기): ${pick.length}곳
  - 후보 없음 (직접 넣기, \`to-add/\` → \`npm run add-images\`): ${manual.length}곳
- 묶음(같은 지구) 칸은 공고명에서 읽은 "지구 블록"입니다. 같은 묶음끼리는 한 장을 같이 써도 됩니다.
- 모집공고 PDF는 청약홈 공고의 첨부 주소입니다. 링크가 오래되면 청약홈 공고에서 다시 받으세요.

## 1. 같은 지구 공고의 이미지를 같이 쓸 수 있는 단지 (${share.length})

같은 지구·블록의 다른 공고에 이미 이미지가 있습니다. 그 이미지를 /admin/images에서 이 단지에도 지정하거나, 같은 파일로 \`to-add/\`에 넣으면 됩니다.

${table(share, (x) => ` (이미지 있음: ${x.twinWithImage})`)}

## 2. /admin/images에 후보 이미지가 있는 단지 (${pick.length})

\`npm run dev\` 후 http://localhost:3000/admin/images 에서 **"지도 · 후보 있음"**을 누르면 이 단지들만 보입니다. 후보를 누르면 바로 지정돼요.

${table(pick, (x) => ` (후보 ${x.candidates}개)`)}

## 3. 후보가 없는 단지 — 직접 넣기 (${manual.length})

\`to-add/\` 폴더에 **단지명 그대로** 이미지를 넣고 \`npm run add-images\`를 실행하세요. 출처는 \`단지명__출처.jpg\`처럼 붙입니다.

${table(manual)}
`;
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, md, "utf8");
  console.log(`\n저장: docs/missing-images.md`);
  console.log(`지도 썸네일 ${rows.length}곳 = 같은 지구 공유 가능 ${share.length} + 후보 있음 ${pick.length} + 직접 넣기 ${manual.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
