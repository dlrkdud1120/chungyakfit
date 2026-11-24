/**
 * 단지 대표 이미지 모으기 (우리 컴퓨터에서 가끔 한 번 실행하는 도구. 앱 실행·배포와는 무관)
 *
 * 실행:  npm run collect-images            새 공고와 오래된 결과만 다시 확인
 *        npm run collect-images -- --all    전부 다시 확인
 *        npm run collect-images -- --only=스위첸   이름에 이 글자가 들어간 단지만
 *        npm run collect-images -- --new-only --nos=2026000560,…   (주간 자동화용) 이 공고 중 처음 보는 단지만
 *        npm run collect-images -- --scope=current   최근 분양 공고만 (기본은 무순위·지난 공고까지 모두)
 *        npm run collect-images -- --no-pdf          입주자모집공고 PDF는 건너뜀
 *
 * 하는 일
 *  1) 청약홈 분양정보에서 공고 목록과 홈페이지 주소를 받음 (.env.local의 APPLYHOME_API_KEY 사용)
 *  2) 실제 브라우저(내 컴퓨터의 Edge 또는 Chrome)로 홈페이지를 열고, 3초 기다린 뒤 끝까지 천천히 스크롤해서
 *     실제로 불러온 이미지(img 태그, CSS 배경, 네트워크로 받은 이미지)를 모음
 *  3) lib/image-pick.ts 기준으로 거름: 크기 → 복잡도(entropy) → 한 가지 색 비율 → 넓이가 가장 큰 것
 *  3-1) 홈페이지 주소가 LH·SH·GH 공용 사이트인 공공분양은 그 기관의 해당 공고 페이지에서 찾음 (lib/public-source.ts)
 *  2-1) 첫 화면에서 "조감도", "투시도", "단지정보", "단지배치", "단지안내", "location", "complex" 링크를 최대 3개까지 따라가 같은 방법으로 모음
 *  4) 확신이 있는 단지만 data/auto-images.json에 { 단지명, 이미지 주소, 홈페이지 주소, 확인 날짜 }로 적음
 *     1단계 기준으로 못 찾으면 2단계(가로 600px, 비율 1.1~2.5)로 다시 고르고 review(확인 필요)로 표시
 *  5) 그래도 없으면 청약홈 공고에 첨부된 입주자모집공고 PDF 앞쪽 5쪽의 이미지를 같은 기준으로 골라
 *     public/images/complexes/pdf-주택관리번호.jpg로 저장하고 complexes.csv에 조감도로 적음 (PDF 안 이미지는 주소가 없어서)
 *  6) 같은 지구·블록의 다른 공고는 하나만 찾아도 같이 씀
 *  7) 단지마다 상위 후보 6개를 data/image-candidates.json에 적음 (고르기 화면 /admin/images용)
 *  대상: 최근 분양 공고 + 무순위·잔여세대 공고 + 단지 비교에 나오는 지난 공고 (--scope=current면 최근 분양 공고만)
 *
 * 지키는 것
 *  - 이미지 파일은 저장하지 않습니다. 분석은 메모리에서만 하고 주소만 적습니다.
 *  - robots.txt가 막은 사이트는 건너뜁니다. 사이트 사이에 2초 쉬고, 한 사이트는 20초 안에 끝냅니다.
 *  - 직접 넣은 조감도(complexes.csv)나 image-overrides.json이 있는 단지는 건드리지 않습니다.
 *  - 홈페이지 제목에 단지명이 없으면(LH·SH 같은 공용 사이트) 엉뚱한 사진이 걸리므로 건너뜁니다.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import sharp from "sharp";
import { imageKey } from "../lib/complexImage";
import { CSV_PATH, loadComplexes } from "../lib/complexes";
import { dominantShare, lookProblem, pickBest, PICK_RULES, RELAXED_RULES, robotsBlocks, siteMatchesName, sizeProblem, type Measured } from "../lib/image-pick";
import { PDF_SOURCE } from "../lib/image-resolve";
import { pdfImages } from "../lib/pdf-images";
import { AGENCIES, agencyOf, complexKey, PUBLIC_SETTINGS, sameComplex, type Agency } from "../lib/public-source";

const SETTINGS = {
  waitAfterOpenMs: 3000, // 홈페이지를 열고 기다리는 시간
  scrollStepPx: 600,
  scrollPauseMs: 250, // 천천히 스크롤
  siteLimitMs: 20_000, // 한 사이트 제한 시간
  betweenSitesMs: 2000, // 사이트 사이에 쉬는 시간
  recheckDays: 30, // 이 기간 안에 확인한 단지는 다시 열지 않음 (--all 이면 무시)
  maxImageBytes: 20_000_000,
  innerPages: 3, // 안쪽 페이지를 몇 개까지 따라갈지
  innerPageMs: 8000, // 안쪽 페이지 하나마다 더 주는 시간
  candidatesMax: 6, // 고르기 화면에 남길 후보 수
  pdfPages: 5, // 모집공고 PDF 앞쪽 몇 쪽까지 볼지
  pdfMaxBytes: 40_000_000,
  betweenPdfMs: 1000, // PDF 사이에 쉬는 시간
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 chungyakfit-bot/1.0",
};

const OUT = path.join(process.cwd(), "data", "auto-images.json");
const OVERRIDES = path.join(process.cwd(), "data", "image-overrides.json");
const CANDIDATES = path.join(process.cwd(), "data", "image-candidates.json");
const IMAGE_DIR_FS = path.join(process.cwd(), "public", "images", "complexes");
const AGENCY_SITES = new Set(Object.values(AGENCIES).map((a) => a.site));

const HOMEPAGE_SOURCE = "분양 홈페이지";
// source: 출처 이름 ("분양 홈페이지" 또는 "LH청약플러스" 같은 기관 사이트 이름). homepage: 누르면 열리는 출처 주소
// review: 2단계(낮춘) 기준으로 고름 → 고르기 화면에서 "확인 필요"
type Item = { name: string; image: string; homepage: string; checkedAt: string; source?: string; review?: boolean };
// agency: 공공기관 공고 페이지까지 찾아본 경우 그 기관 (LH, SH, GH)
type Skipped = { name: string; homepage: string | null; reason: string; checkedAt: string; agency?: string };

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const ONLY = args.find((a) => a.startsWith("--only="))?.slice(7) ?? "";
// 주간 자동화(scripts/weekly-data.ts)용: --nos=주택관리번호,… 이 공고만 / --new-only 한 번도 확인하지 않은 단지만 (30일 재확인 안 함)
const NOS = new Set((args.find((a) => a.startsWith("--nos="))?.slice(6) ?? "").split(",").filter(Boolean));
const NEW_ONLY = args.includes("--new-only");
const NO_PDF = args.includes("--no-pdf");
// 주간 자동화처럼 공고 번호를 주면 최근 분양 공고만 봄
const SCOPE = NOS.size ? "current" : (args.find((a) => a.startsWith("--scope="))?.slice(8) ?? "all");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────── 준비: 환경변수, 기존 결과 ─────────────────────────

/** .env.local의 값을 읽어 둠 (Next.js 밖에서 실행하므로 직접 읽음) */
function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
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

/** 내 컴퓨터에 이미 깔린 Edge → Chrome → Playwright용 브라우저 순서로 엶 */
async function openBrowser(): Promise<Browser> {
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH });
  for (const channel of ["msedge", "chrome"]) {
    try {
      return await chromium.launch({ channel });
    } catch {
      // 다음 브라우저로
    }
  }
  try {
    return await chromium.launch();
  } catch {
    console.log("\n!! 브라우저를 열지 못했습니다. Edge나 Chrome이 없다면  npx playwright install chromium  을 한 번 실행해 주세요.");
    process.exit(1);
  }
}

// ───────────────────────── 한 사이트에서 이미지 모으기 ─────────────────────────

// problem: 1단계(기본) 기준에서 걸린 이유, relaxed: 2단계(낮춘) 기준에서 걸린 이유 (둘 다 null이면 통과)
type Row = Measured & { problem: string | null; relaxed: string | null };
type SiteResult =
  | { ok: false; reason: string; title?: string }
  | { ok: true; title: string; found: number; rows: Row[]; best: Measured | null; review: boolean; timedOut: boolean; inner: number };

/** 페이지 안에서 실행: 제목, 화면에 쓰인 이미지 주소(img 태그 + CSS 배경), 안쪽 페이지 후보 링크 */
const IN_PAGE = `(() => {
  const urls = new Set();
  for (const i of document.images) { const u = i.currentSrc || i.src; if (u) urls.add(u); }
  for (const el of document.querySelectorAll("*")) {
    const b = getComputedStyle(el).backgroundImage;
    if (b && b !== "none") for (const m of b.matchAll(/url\\(["']?([^"')]+)["']?\\)/g)) { try { urls.add(new URL(m[1], location.href).href); } catch {} }
  }
  const links = [...document.querySelectorAll("a[href]")].map((a) => ({
    href: a.href,
    text: [a.innerText, a.title, a.getAttribute("aria-label"), a.querySelector("img")?.alt].filter(Boolean).join(" ").replace(/\\s+/g, " ").trim().slice(0, 60),
  }));
  const meta = (p) => document.querySelector('meta[property="' + p + '"]')?.getAttribute("content") || "";
  return { title: [document.title, meta("og:title"), meta("og:site_name")].join(" "), urls: [...urls], links, height: document.documentElement.scrollHeight };
})()`;

type Dom = { title: string; urls: string[]; links: { href: string; text: string }[] };

/** 안쪽 페이지로 따라갈 링크: 글자나 주소에 이 낱말이 들어간 같은 사이트 링크 */
const INNER_WORDS = /조감도|투시도|단지\s*정보|단지\s*배치|단지\s*안내|location|complex/i;

function innerLinks(dom: Dom, home: URL, robots: string): string[] {
  const seen = new Set<string>([home.href.replace(/#.*$/, "")]);
  const out: string[] = [];
  for (const { href, text } of dom.links) {
    let u: URL;
    try {
      u = new URL(href);
    } catch {
      continue;
    }
    const clean = u.href.replace(/#.*$/, "");
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== home.hostname.replace(/^www\./, "") || seen.has(clean)) continue;
    if (!INNER_WORDS.test(text) && !INNER_WORDS.test(decodeURIComponent(u.pathname + u.search))) continue;
    if (robots && robotsBlocks(robots, u.pathname + u.search)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= SETTINGS.innerPages) break;
  }
  return out;
}

async function measure(url: string, buf: Buffer, labeled = false): Promise<Row | null> {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    const base = { url, width: meta.width, height: meta.height, entropy: 0, dominant: 1 };
    const size = sizeProblem(meta.width, meta.height, labeled);
    const sizeRelaxed = sizeProblem(meta.width, meta.height, labeled, RELAXED_RULES);
    if (size && sizeRelaxed) return { ...base, problem: size, relaxed: sizeRelaxed };

    // 작게 줄여서 분석 (메모리에서만. 파일로 저장하지 않음)
    const S = PICK_RULES.sampleSize;
    // 투명한 부분의 비율 (사진 위에 덮는 반투명 그림자 이미지를 거르기 위해)
    let transparent = 0;
    if (meta.hasAlpha) {
      const a = await sharp(buf).ensureAlpha().resize(S, S, { fit: "fill" }).extractChannel(3).raw().toBuffer();
      transparent = a.filter((v) => v < 250).length / a.length;
    }
    const small = await sharp(buf).flatten({ background: "#ffffff" }).resize(S, S, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const entropy = (await sharp(small.data, { raw: small.info }).stats()).entropy;
    const dominant = dominantShare(new Uint8Array(small.data), small.info.channels);
    const look = lookProblem(entropy, dominant, transparent);
    return { ...base, entropy, dominant, problem: size ?? look, relaxed: sizeRelaxed ?? look };
  } catch {
    return null; // 이미지가 아니거나 읽을 수 없는 형식
  }
}

/** 1단계 기준으로 고르고, 하나도 없으면 2단계(낮춘) 기준으로 고름 → review(확인 필요) */
function choose(rows: Row[]): { best: Measured | null; review: boolean } {
  const strict = pickBest(rows.filter((r) => r.problem === null));
  if (strict) return { best: strict, review: false };
  const relaxed = pickBest(rows.filter((r) => r.relaxed === null));
  return { best: relaxed, review: relaxed !== null };
}

/** 고르기 화면(/admin/images)에 보여줄 상위 후보 (2단계 크기 기준을 넘는 것 중 넓은 순) */
const topCandidates = (rows: Row[]) =>
  rows
    .filter((r) => r.width >= RELAXED_RULES.minWidth && r.url.startsWith("http"))
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, SETTINGS.candidatesMax)
    .map((r) => ({ url: r.url, width: r.width, height: r.height, note: r.problem ?? undefined }));

const readRobots = (origin: string) =>
  fetch(`${origin}/robots.txt`, { headers: { "User-Agent": SETTINGS.userAgent }, signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? r.text() : ""))
    .catch(() => "");

const newContext = (browser: Browser) => browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: SETTINGS.userAgent, ignoreHTTPSErrors: true });

/** 지금 페이지를 끝까지 천천히 스크롤한 뒤 이미지 주소·링크를 읽음 */
async function readPage(page: Page, left: () => number, reserveMs: number): Promise<Dom | null> {
  for (let y = 0; left() > reserveMs; y += SETTINGS.scrollStepPx) {
    const height = (await page.evaluate("document.documentElement.scrollHeight").catch(() => 0)) as number;
    if (y > height) break;
    await page.evaluate(`window.scrollTo(0, ${y})`).catch(() => undefined);
    await page.waitForTimeout(SETTINGS.scrollPauseMs);
  }
  return (await page.evaluate(IN_PAGE).catch(() => null)) as Dom | null;
}

async function collect(browser: Browser, homepage: string, names: string[]): Promise<SiteResult> {
  let deadline = Date.now() + SETTINGS.siteLimitMs;
  const left = () => deadline - Date.now();
  const home = new URL(homepage);

  // robots.txt가 막고 있으면 열지 않음 (없거나 못 읽으면 막지 않은 것으로 봄)
  const robots = await readRobots(home.origin);
  if (robots && robotsBlocks(robots, home.pathname + home.search)) return { ok: false, reason: "robots.txt가 접근을 막음" };

  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    // 네트워크로 받은 이미지 응답을 메모리에 잠깐 들고 있음
    const bodies = new Map<string, Buffer>();
    const pending: Promise<void>[] = [];
    page.on("response", (res) => {
      const type = res.headers()["content-type"] ?? "";
      if (res.request().resourceType() !== "image" && !type.startsWith("image/")) return;
      pending.push(
        res
          .body()
          .then((b) => {
            if (b.length <= SETTINGS.maxImageBytes) bodies.set(res.url(), b);
          })
          .catch(() => undefined),
      );
    });

    try {
      await page.goto(homepage, { waitUntil: "domcontentloaded", timeout: Math.min(12_000, left()) });
    } catch {
      return { ok: false, reason: "홈페이지가 열리지 않음 (접속 실패·시간 초과)" };
    }
    await page.waitForTimeout(SETTINGS.waitAfterOpenMs);

    const dom = await readPage(page, left, 6000);
    if (!dom) return { ok: false, reason: "페이지를 읽지 못함" };
    if (!names.some((n) => siteMatchesName(n, dom.title))) {
      return { ok: false, reason: `공용 홈페이지로 보임 (제목 "${dom.title.trim().slice(0, 30)}"에 단지명이 없음)`, title: dom.title };
    }
    const found = new Set(dom.urls);

    // 안쪽 페이지: "조감도", "단지정보" 같은 링크를 최대 3개까지 따라가 같은 방법으로 모음 (페이지마다 시간을 조금 더 줌)
    const inner = innerLinks(dom, home, robots);
    for (const link of inner) {
      deadline = Math.max(deadline, Date.now()) + SETTINGS.innerPageMs;
      try {
        await page.goto(link, { waitUntil: "domcontentloaded", timeout: Math.min(10_000, left()) });
      } catch {
        continue;
      }
      await page.waitForTimeout(1500);
      const d = await readPage(page, left, 4000);
      d?.urls.forEach((u) => found.add(u));
    }
    await Promise.race([Promise.all(pending), sleep(1500)]);

    const urls = [...new Set([...found, ...bodies.keys()])].filter((u) => {
      if (!/^https?:\/\//.test(u) || /\.(svg|gif)(\?|#|$)/i.test(u)) return false;
      const x = new URL(u);
      return !(robots && x.origin === home.origin && robotsBlocks(robots, x.pathname + x.search));
    });

    const rows: Row[] = [];
    let timedOut = false;
    for (const url of urls) {
      if (left() <= 0) {
        timedOut = true;
        break;
      }
      // 이미 받은 응답이 있으면 그것을 쓰고, 없으면 같은 브라우저로 한 번 받음
      const buf =
        bodies.get(url) ??
        (await context.request
          .get(url, { timeout: Math.max(1000, Math.min(6000, left())) })
          .then((r) => (r.ok() ? r.body() : null))
          .catch(() => null));
      if (!buf || buf.length > SETTINGS.maxImageBytes) continue;
      const row = await measure(url, buf);
      if (row) rows.push(row);
    }
    rows.sort((a, b) => b.width * b.height - a.width * a.height);
    const pick = choose(rows);
    return { ok: true, title: dom.title, found: urls.length, rows, best: pick.best, review: pick.review, timedOut, inner: inner.length };
  } finally {
    await context.close();
  }
}

// ───────────────────────── 입주자모집공고 PDF (청약홈 공고 첨부) ─────────────────────────

type PdfPick = { ok: true; file: string; review: boolean; width: number; height: number; page: number; pdfName: string } | { ok: false; reason: string };

/**
 * 청약홈 공고 페이지의 첨부(getAtchmnfl.do) 중 입주자모집공고문 PDF를 받아 앞쪽 5쪽 안의 이미지를 같은 기준으로 고름.
 * LH·GH·SH 공공분양도 청약홈에 같은 모집공고문이 올라오므로 청약홈 첨부 하나로 찾습니다 (GH 사이트는 robots.txt가 막음).
 * 고른 이미지는 public/images/complexes/에 저장하고(PDF 안 이미지는 주소가 없어서), CSV에 조감도로 적습니다.
 */
async function fromPdf(noticeUrl: string, no: string): Promise<PdfPick> {
  const ua = { "User-Agent": SETTINGS.userAgent };
  const html = await fetch(noticeUrl, { headers: ua, signal: AbortSignal.timeout(15_000) })
    .then((r) => (r.ok ? r.text() : ""))
    .catch(() => "");
  if (!html) return { ok: false, reason: "청약홈 공고 페이지가 열리지 않음" };
  const links = [...new Set([...html.matchAll(/https?:\/\/[^"'\s<>]*getAtchmnfl\.do\?[^"'\s<>]+/g)].map((m) => m[0].replace(/&amp;/g, "&")))].slice(0, 4);
  if (!links.length) return { ok: false, reason: "청약홈 공고에 첨부 파일이 없음" };

  let pdf: { buf: Buffer; name: string } | null = null;
  for (const link of links) {
    const res = await fetch(link, { headers: ua, signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (!res?.ok) continue;
    const size = Number(res.headers.get("content-length") ?? 0);
    if (size > SETTINGS.pdfMaxBytes) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.subarray(0, 5).toString() !== "%PDF-") continue;
    const cd = res.headers.get("content-disposition") ?? "";
    const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="?([^";]+)/i.exec(cd)?.[1] ?? "첨부.pdf");
    if (!pdf || /모집공고/.test(name)) pdf = { buf, name };
    if (/모집공고/.test(name)) break;
  }
  if (!pdf) return { ok: false, reason: "모집공고 PDF를 받지 못함" };

  const images = await pdfImages(pdf.buf, { maxPages: SETTINGS.pdfPages, minSide: 300 }).catch(() => []);
  if (!images.length) return { ok: false, reason: `모집공고 PDF 앞쪽 ${SETTINGS.pdfPages}쪽에 이미지가 없음` };
  const rows: Row[] = [];
  const byUrl = new Map<string, (typeof images)[number]>();
  for (const [i, img] of images.entries()) {
    const key = `pdf:${img.page}:${i}`;
    byUrl.set(key, img);
    const row = await measure(key, img.jpeg);
    if (row) rows.push(row);
  }
  const { best, review } = choose(rows);
  if (!best) {
    const top = rows.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { ok: false, reason: `모집공고 PDF 이미지가 기준에 맞지 않음${top ? ` (가장 큰 것 ${top.width}×${top.height}: ${top.relaxed})` : ""}` };
  }
  const img = byUrl.get(best.url)!;
  const file = `pdf-${no}.jpg`;
  writeFileSync(path.join(IMAGE_DIR_FS, file), img.jpeg);
  return { ok: true, file, review, width: img.width, height: img.height, page: img.page, pdfName: pdf.name };
}

/** 우리 사이트는 https라서 http 이미지는 보이지 않을 수 있음. https로도 열리면 그 주소를 씀 */
async function httpsUrl(url: string): Promise<string | null> {
  if (url.startsWith("https://")) return url;
  if (process.env.COLLECT_ALLOW_HTTP === "1") return url; // 내 컴퓨터의 시험용 사이트로 점검할 때만
  const secure = url.replace(/^http:\/\//, "https://");
  const ok = await fetch(secure, { headers: { "User-Agent": SETTINGS.userAgent, Range: "bytes=0-1023" }, signal: AbortSignal.timeout(6000) })
    .then((r) => r.ok && (r.headers.get("content-type") ?? "").startsWith("image/"))
    .catch(() => false);
  return ok ? secure : null;
}

// ───────────────────────── 공공분양: 기관의 해당 공고 페이지에서 찾기 ─────────────────────────

type PublicResult = { rows: Row[]; best: Measured | null; found: string } | { reason: string };

// 시험할 때만 목록 주소를 바꿔 끼움 (평소에는 lib/public-source.ts의 주소)
const LH_LIST = process.env.COLLECT_LH_LIST ?? AGENCIES.LH.listUrl;
const SH_LIST = process.env.COLLECT_SH_LIST ?? AGENCIES.SH.listUrl;

/** 페이지 안에서 실행한 뒤 페이지가 넘어가기를 기다림 (검색, 글 열기) */
async function runAndWait(page: Page, script: string, timeoutMs: number): Promise<boolean> {
  const moved = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: Math.max(1000, timeoutMs) }).then(
    () => true,
    () => false,
  );
  await page.evaluate(script).catch(() => undefined); // 넘어가는 중에 끊겨도 괜찮음
  return moved;
}

/** 이미지 주소들을 받아서 재고(메모리에서만) 기준에 맞는지 봄 */
async function measureAll(context: BrowserContext, urls: string[], robots: string, labeled: boolean, left: () => number): Promise<Row[]> {
  const rows: Row[] = [];
  for (const url of urls) {
    if (left() <= 0) break;
    const x = new URL(url);
    if (/\.(svg|gif)(\?|#|$)/i.test(url) || (robots && robotsBlocks(robots, x.pathname + x.search))) continue;
    const buf = await context.request
      .get(url, { timeout: Math.max(1000, Math.min(8000, left())) })
      .then((r) => (r.ok() ? r.body() : null))
      .catch(() => null);
    if (!buf || buf.length > SETTINGS.maxImageBytes) continue;
    const row = await measure(url, buf, labeled);
    if (row) rows.push(row);
  }
  return rows.sort((a, b) => b.width * b.height - a.width * a.height);
}

/**
 * LH청약플러스: 분양주택 공고 목록에서 같은 지구·블록의 공고를 찾아 열고, "단지조감도" 탭의 이미지를 봄
 * (사람이 화면에서 하는 것과 같은 순서로 검색 → 공고 누르기 → 탭 누르기)
 */
async function fromLh(browser: Browser, name: string): Promise<PublicResult> {
  const deadline = Date.now() + SETTINGS.siteLimitMs;
  const left = () => deadline - Date.now();
  const list = new URL(LH_LIST);
  const robots = await readRobots(list.origin);
  if (robots && robotsBlocks(robots, list.pathname + list.search)) return { reason: "LH청약플러스의 robots.txt가 접근을 막음" };

  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    try {
      await page.goto(LH_LIST, { waitUntil: "domcontentloaded", timeout: Math.min(12_000, left()) });
      await page.waitForSelector("#srchForm", { state: "attached", timeout: Math.min(8000, Math.max(1000, left())) });
    } catch {
      return { reason: "LH청약플러스 공고 목록이 열리지 않음" };
    }
    // 공고 상태 "전체", 기간을 넓히고 한 번에 많이 보이게 한 뒤 검색
    const start = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(Date.now() - PUBLIC_SETTINGS.lhDaysBack * 86_400_000));
    await runAndWait(
      page,
      `(() => {
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
        set("panSs", ""); set("startDt", ${JSON.stringify(start)});
        const n = document.getElementById("listWt"); if (n && n.options.length) n.value = n.options[n.options.length - 1].value;
        doSearch();
      })()`,
      Math.min(10_000, left()),
    );
    const posts = ((await page
      .evaluate(
        `[...document.querySelectorAll("a.wrtancInfoBtn")].map((a) => ({ id: a.getAttribute("data-id1") || "", title: (a.querySelector("span")?.childNodes[0]?.textContent || a.textContent || "").replace(/\\s+/g, " ").trim() }))`,
      )
      .catch(() => [])) ?? []) as { id: string; title: string }[];
    const post = posts.find((p) => p.id && sameComplex(name, p.title)); // 목록은 최신순이라 정정공고가 있으면 그게 먼저
    if (!post) return { reason: `LH청약플러스 공고 목록(${posts.length}건)에서 같은 지구·블록의 공고를 찾지 못함` };

    const opened = await runAndWait(page, `document.querySelector('a.wrtancInfoBtn[data-id1="${post.id}"]').click()`, Math.min(12_000, left()));
    if (!opened) return { reason: "LH청약플러스 공고 페이지가 열리지 않음" };
    await page.waitForTimeout(1500);

    // "단지조감도" 탭을 눌러 그 탭의 이미지 주소를 읽음 (단지가 여러 개면 탭도 여러 개)
    const tabs = ((await page
      .evaluate(`[...document.querySelectorAll('li[id^="tabPlanli"] > a')].map((a) => ({ id: a.id, text: a.textContent.trim() }))`)
      .catch(() => [])) ?? []) as { id: string; text: string }[];
    const urls: string[] = [];
    for (const tab of tabs.filter((t) => t.id && t.text.includes(PUBLIC_SETTINGS.imageTabLabel))) {
      if (left() < 4000) break;
      const box = (await page
        .evaluate(
          `(() => { const a = document.getElementById(${JSON.stringify(tab.id)}); const m = /onchangeImageTab\\('(\\d+)','(\\d+)'\\)/.exec(a.getAttribute("href") || ""); if (!m) return null; onchangeImageTab(m[1], m[2]); return m[1]; })()`,
        )
        .catch(() => null)) as string | null;
      if (box === null) continue;
      await page.waitForTimeout(1200);
      const src = (await page.evaluate(`document.getElementById("image_${box}")?.src || ""`).catch(() => "")) as string;
      if (/^https?:\/\//.test(src) && !/noimg/i.test(src) && !urls.includes(src)) urls.push(src);
    }
    if (urls.length === 0) return { reason: `LH청약플러스 공고 "${post.title.slice(0, 30)}"에 조감도 이미지가 없음` };
    const rows = await measureAll(context, urls, robots, true, left);
    return { rows, best: pickBest(rows.filter((r) => r.problem === null)), found: post.title };
  } finally {
    await context.close();
  }
}

/**
 * SH: 주택분양 게시판에서 지구 이름으로 검색해 같은 단지의 입주자모집공고 글을 열고, 글에만 있는 이미지를 봄
 * (목록 화면에도 나오는 이미지는 사이트 장식이므로 뺌)
 */
async function fromSh(browser: Browser, name: string): Promise<PublicResult> {
  const deadline = Date.now() + SETTINGS.siteLimitMs;
  const left = () => deadline - Date.now();
  const list = new URL(SH_LIST);
  const robots = await readRobots(list.origin);
  if (robots && robotsBlocks(robots, list.pathname + list.search)) return { reason: "SH 홈페이지의 robots.txt가 접근을 막음" };
  const district = (complexKey(name) ?? "").split("|")[0];
  if (!district) return { reason: "공고명에서 지구·단지를 읽지 못함" };

  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    try {
      await page.goto(SH_LIST, { waitUntil: "domcontentloaded", timeout: Math.min(12_000, left()) });
      await page.waitForSelector("#srchWord", { state: "attached", timeout: Math.min(8000, Math.max(1000, left())) });
    } catch {
      return { reason: "SH 주택분양 게시판이 열리지 않음" };
    }
    await runAndWait(page, `(() => { document.getElementById("srchWord").value = ${JSON.stringify(district)}; appendSearch(); })()`, Math.min(10_000, left()));
    await page.waitForTimeout(1000);
    const chrome = ((await page.evaluate(IN_PAGE).catch(() => null)) as { urls: string[] } | null)?.urls ?? [];
    const posts = ((await page
      .evaluate(
        `[...document.querySelectorAll('a[onclick*="getDetailView"]')].map((a) => ({ id: (/'(\\d+)'/.exec(a.getAttribute("onclick") || "") || [])[1] || "", title: a.textContent.replace(/\\s+/g, " ").trim() }))`,
      )
      .catch(() => [])) ?? []) as { id: string; title: string }[];
    const post = posts.find((p) => p.id && p.title.includes(PUBLIC_SETTINGS.noticeWord) && sameComplex(name, p.title));
    if (!post) return { reason: `SH 주택분양 게시판에서 "${district}" 입주자모집공고 글을 찾지 못함` };

    const opened = await runAndWait(page, `document.querySelector('a[onclick*="getDetailView(\\'${post.id}\\')"]').click()`, Math.min(12_000, left()));
    if (!opened) return { reason: "SH 공고 글이 열리지 않음" };
    await page.waitForTimeout(SETTINGS.waitAfterOpenMs);
    for (let y = 0; left() > 8000; y += SETTINGS.scrollStepPx) {
      const height = (await page.evaluate("document.documentElement.scrollHeight").catch(() => 0)) as number;
      if (y > height) break;
      await page.evaluate(`window.scrollTo(0, ${y})`).catch(() => undefined);
      await page.waitForTimeout(SETTINGS.scrollPauseMs);
    }
    const inPost = ((await page.evaluate(IN_PAGE).catch(() => null)) as { urls: string[] } | null)?.urls ?? [];
    const urls = inPost.filter((u) => /^https?:\/\//.test(u) && !chrome.includes(u));
    const rows = await measureAll(context, urls, robots, false, left);
    if (rows.length === 0) return { reason: `SH 공고 글 "${post.title.slice(0, 30)}"에 이미지가 없음 (첨부 파일만 있음)` };
    return { rows, best: pickBest(rows.filter((r) => r.problem === null)), found: post.title };
  } finally {
    await context.close();
  }
}

/** GH: 분양 공고가 있는 사이트가 robots.txt로 막혀 있으면 열지 않음 */
async function fromGh(): Promise<PublicResult> {
  const home = new URL(AGENCIES.GH.listUrl);
  const robots = await readRobots(home.origin);
  if (robots && robotsBlocks(robots, "/")) return { reason: "GH 홈페이지(gh.or.kr)의 robots.txt가 모든 접근을 막음" };
  return { reason: "GH 분양 공고 페이지에서 찾는 방법이 아직 없음" };
}

const fromAgency = (browser: Browser, agency: Agency, name: string): Promise<PublicResult> =>
  agency.key === "LH" ? fromLh(browser, name) : agency.key === "SH" ? fromSh(browser, name) : fromGh();

// ───────────────────────── 실행 ─────────────────────────

/** 후보 표 출력: 넓이 큰 순으로 12개 (크기 기준에서 떨어진 작은 이미지는 수만 알려줌) */
function printRows(rows: Row[], best: Measured | null): Row[] {
  const big = rows.filter((x) => !x.problem || !/^가로/.test(x.problem));
  if (big.length > 0) {
    console.table(
      big.slice(0, 12).map((x) => ({
        크기: `${x.width}×${x.height}`,
        entropy: x.entropy.toFixed(2),
        "한 색 비율": `${Math.round(x.dominant * 100)}%`,
        결과: best?.url === x.url ? (x.problem ? "★ 선택 (확인 필요)" : "★ 선택") : (x.problem ?? "통과"),
        주소: x.url.length > 70 ? `…${x.url.slice(-68)}` : x.url,
      })),
    );
  }
  return big;
}

type Target = { no: string; name: string; homepage: string | null; noticeUrl: string | null; group: "분양 공고" | "무순위" | "지난 공고" };
type Candidate = { url: string; width: number; height: number; note?: string };
type CandidateEntry = { checkedAt: string; homepage: string | null; candidates: Candidate[]; review?: boolean; pdf?: string };

/** CSV 한 칸 (쉼표·따옴표가 있으면 따옴표로 감쌈) */
const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

async function main() {
  loadEnv();
  const { fetchHistory, fetchNoticeEntries, fetchNotices, fetchRemndrNotices } = await import("../lib/applyhome");
  const { SIMILAR_RULES } = await import("../lib/similar");
  const res = await fetchNotices();
  if (!res.ok) {
    console.log(`!! 공고 목록을 받지 못했습니다: ${res.reason}\n   프로젝트 폴더에서 실행했는지, .env.local에 APPLYHOME_API_KEY가 있는지 확인해 주세요.`);
    process.exit(1);
  }

  // ── 수집 대상: 분양 공고 + (scope=all이면) 무순위·잔여세대 + 단지 비교에 나오는 지난 공고 ──
  const targets: Target[] = res.notices.map((n) => ({ no: n.houseManageNo, name: n.name, homepage: n.homepage, noticeUrl: n.url, group: "분양 공고" }));
  if (SCOPE === "all") {
    const rem = await fetchRemndrNotices(30);
    if (rem.ok) for (const n of rem.notices) targets.push({ no: n.houseManageNo, name: n.name, homepage: n.homepage ?? null, noticeUrl: n.url, group: "무순위" });
    const hist = await fetchHistory(SIMILAR_RULES.yearsBack);
    if (hist.ok) {
      // 단지 비교 화면과 같은 기준: 평균 당첨가점이 있는 공고만 (lib/applyhome.ts historyToComplexes)
      const pastNos = new Set(hist.rows.filter((r) => r.avg !== null).map((r) => r.no));
      const entries = await fetchNoticeEntries(Math.ceil(SIMILAR_RULES.yearsBack * 365.25) + 31).catch(() => []);
      for (const e of entries) if (pastNos.has(e.houseManageNo)) targets.push({ no: e.houseManageNo, name: e.name, homepage: e.homepage, noticeUrl: e.url, group: "지난 공고" });
    }
  }
  const seenKeys = new Set<string>();
  const all = targets.filter((t) => {
    const k = imageKey(t.name);
    if (seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });

  const csvImages = loadComplexes().images; // 직접 넣은 조감도 (모집공고 PDF에서 저장한 것 포함)
  const manualKeys = new Set(Object.keys(csvImages));
  const overridesRaw = readJson<Record<string, unknown>>(OVERRIDES, {});
  const overrides = new Map(Object.entries(overridesRaw).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [imageKey(k), v]));
  const old = readJson<{ items?: Item[]; skipped?: Skipped[] }>(OUT, {});
  const items = new Map((old.items ?? []).map((x) => [imageKey(x.name), x]));
  const skipped = new Map((old.skipped ?? []).map((x) => [imageKey(x.name), x]));
  const candFile = readJson<{ byName?: Record<string, CandidateEntry> }>(CANDIDATES, {});
  const candidates = new Map(Object.entries(candFile.byName ?? {}).map(([k, v]) => [imageKey(k), { name: k, ...v }]));
  const fresh = (date: string | undefined) => !!date && (Date.parse(today) - Date.parse(date)) / 86_400_000 < SETTINGS.recheckDays;

  /** 출처별 개수 (수집 전후 비교용) */
  const tally = () => {
    const c: Record<string, number> = { "직접 지정": 0, "조감도 직접": 0, "모집공고 PDF": 0, "분양 홈페이지": 0, 공공기관: 0, 지도: 0 };
    for (const t of all) {
      const k = imageKey(t.name);
      const o = overrides.get(k);
      if (o) c[o === "hide" ? "지도" : "직접 지정"] += 1;
      else if (manualKeys.has(k)) c[(csvImages[k]?.source ?? "").startsWith(PDF_SOURCE) ? "모집공고 PDF" : "조감도 직접"] += 1;
      else if (items.has(k)) c[AGENCY_SITES.has(items.get(k)!.source ?? "") ? "공공기관" : "분양 홈페이지"] += 1;
      else c["지도"] += 1;
    }
    return c;
  };
  const before = tally();
  const csvRows: string[] = []; // 끝에 complexes.csv에 덧붙일 줄 (모집공고 PDF, 같은 지구)

  // ── 저장 (중간 저장은 CSV를 건드리지 않음) ──
  const persist = (final: boolean) => {
    if (final && csvRows.length) {
      const csv = readFileSync(CSV_PATH, "utf8");
      writeFileSync(CSV_PATH, `${csv.replace(/\s*$/, "")}\n${csvRows.join("\n")}\n`, "utf8");
    }
    const byName = <T extends { name: string }>(list: Iterable<T>) => [...list].sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const out = {
      _설명: "npm run collect-images 가 만드는 파일입니다. 직접 고치지 말고, 고칠 것이 있으면 image-overrides.json에 적으세요 (/admin/images에서 고를 수 있음).",
      items: byName([...items.values()].map((x) => ({ ...x, source: x.source ?? HOMEPAGE_SOURCE }))),
      skipped: byName(skipped.values()),
    };
    writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, "utf8");
    const candOut = {
      _설명: "npm run collect-images 가 만드는 고르기 화면(/admin/images)용 후보 목록입니다. 사이트에서는 쓰지 않습니다.",
      byName: Object.fromEntries(byName(candidates.values()).map(({ name, ...rest }) => [name, rest])),
    };
    writeFileSync(CANDIDATES, `${JSON.stringify(candOut, null, 2)}\n`, "utf8");
  };

  // 확인할 단지를 홈페이지별로 묶음 (같은 홈페이지는 한 번만 엶)
  const sites = new Map<string, string[]>();
  const publics: { name: string; agency: Agency }[] = [];
  let untouched = 0;
  for (const t of all) {
    const key = imageKey(t.name);
    if (ONLY && !t.name.includes(ONLY)) continue;
    if (NOS.size && !NOS.has(t.no)) continue;
    if (NEW_ONLY && (items.has(key) || skipped.has(key))) continue;
    if (manualKeys.has(key) || overrides.has(key)) {
      untouched += 1; // 직접 넣은 조감도나 직접 지정이 먼저라 자동 이미지가 필요 없음
      continue;
    }
    const agency = agencyOf(t.homepage);
    const skippedBefore = skipped.get(key);
    const skippedFresh = fresh(skippedBefore?.checkedAt) && (!agency || skippedBefore?.agency === agency.key);
    if (!ALL && !ONLY && (fresh(items.get(key)?.checkedAt) || skippedFresh)) continue;
    if (agency) {
      publics.push({ name: t.name, agency });
      continue;
    }
    if (!t.homepage || !/^https?:\/\//i.test(t.homepage)) {
      items.delete(key);
      skipped.set(key, { name: t.name, homepage: null, reason: "홈페이지 주소 없음", checkedAt: today });
      continue;
    }
    sites.set(t.homepage, [...(sites.get(t.homepage) ?? []), t.name]);
  }

  const groups = all.reduce<Record<string, number>>((a, t) => ((a[t.group] = (a[t.group] ?? 0) + 1), a), {});
  console.log(`대상 ${all.length}곳 (${Object.entries(groups).map(([g, n]) => `${g} ${n}`).join(", ")}) · 직접 지정·조감도 ${untouched}곳 제외`);
  console.log(`이번에 열어 볼 홈페이지 ${sites.size}곳 · 공공기관 공고 ${publics.length}건`);
  console.log(`기준 1단계: 가로 ${PICK_RULES.minWidth}px 이상, 비율 ${PICK_RULES.minRatio}~${PICK_RULES.maxRatio} / 2단계(확인 필요): 가로 ${RELAXED_RULES.minWidth}px, 비율 ${RELAXED_RULES.minRatio}~${RELAXED_RULES.maxRatio}\n`);

  if (sites.size > 0 || publics.length > 0) {
    const browser = await openBrowser();
    let first = true;
    let done = 0;
    for (const [homepage, names] of sites) {
      if (!first) await sleep(SETTINGS.betweenSitesMs);
      first = false;
      console.log(`■ ${names.join(", ")}\n  ${homepage}`);
      const r = await collect(browser, homepage, names).catch((e): SiteResult => ({ ok: false, reason: `오류: ${e instanceof Error ? e.message.split("\n")[0] : e}` }));

      let image: string | null = null;
      let reason = "";
      if (!r.ok) reason = r.reason;
      else {
        const big = printRows(r.rows.filter((x) => !x.problem || !/^비율/.test(x.problem)), r.best);
        console.log(`  찾은 이미지 ${r.found}개 (안쪽 페이지 ${r.inner}곳 포함) · 크기 기준 탈락 ${r.rows.length - big.length}개${r.timedOut ? " · 시간 제한으로 일부만 확인" : ""}`);
        if (!r.best) {
          const top = r.rows[0];
          reason = r.rows.length ? `후보는 있었으나 기준에 걸려 제외 (가장 큰 것 ${top.width}×${top.height}: ${top.relaxed})` : "후보 자체가 없음";
        } else {
          image = await httpsUrl(r.best.url);
          if (!image) reason = "이미지를 https로 불러올 수 없음";
        }
      }

      for (const name of names) {
        const key = imageKey(name);
        if (r.ok) candidates.set(key, { name, checkedAt: today, homepage, candidates: topCandidates(r.rows), review: r.review || undefined });
        // 같은 홈페이지를 쓰는 단지라도 제목에 그 단지명이 있어야 함
        if (image && r.ok && siteMatchesName(name, r.title)) {
          items.set(key, { name, image, homepage, checkedAt: today, source: HOMEPAGE_SOURCE, ...(r.review ? { review: true } : {}) });
          skipped.delete(key);
        } else {
          items.delete(key);
          skipped.set(key, { name, homepage, reason: reason || "홈페이지 제목에 단지명이 없음", checkedAt: today });
        }
      }
      console.log(image ? `  → ${image}${r.ok && r.review ? " (확인 필요)" : ""}\n` : `  → 지도 썸네일 (${reason})\n`);
      if (++done % 15 === 0) persist(false); // 중간에 멈춰도 여기까지는 남도록
    }

    // 공공분양: 기관의 해당 공고 페이지 (같은 지구·블록의 공고는 한 번만 찾아서 같이 씀)
    const found = new Map<string, { image: string | null; reason: string; review: boolean }>();
    for (const { name, agency } of publics) {
      const key = imageKey(name);
      const same = `${agency.key}|${complexKey(name) ?? name}`;
      let got = found.get(same);
      if (!got) {
        if (!first) await sleep(SETTINGS.betweenSitesMs);
        first = false;
        console.log(`■ ${name}\n  ${agency.site} 공고 페이지`);
        const r = await fromAgency(browser, agency, name).catch((e): PublicResult => ({ reason: `오류: ${e instanceof Error ? e.message.split("\n")[0] : e}` }));
        got = { image: null, reason: "", review: false };
        if ("reason" in r) got.reason = r.reason;
        else {
          const pick = r.best ? { best: r.best, review: false } : choose(r.rows);
          console.log(`  찾은 공고: ${r.found}`);
          printRows(r.rows, pick.best);
          if (!pick.best) got.reason = `${agency.site} 공고 페이지의 이미지가 기준에 맞지 않음`;
          else {
            got.image = await httpsUrl(pick.best.url);
            got.review = pick.review;
            if (!got.image) got.reason = "이미지를 https로 불러올 수 없음";
          }
          candidates.set(key, { name, checkedAt: today, homepage: agency.listUrl, candidates: topCandidates(r.rows), review: pick.review || undefined });
        }
        found.set(same, got);
        console.log(got.image ? `  → ${got.image}${got.review ? " (확인 필요)" : ""}\n` : `  → 지도 썸네일 (${got.reason})\n`);
      }
      if (got.image) {
        items.set(key, { name, image: got.image, homepage: agency.listUrl, checkedAt: today, source: agency.site, ...(got.review ? { review: true } : {}) });
        skipped.delete(key);
      } else {
        items.delete(key);
        skipped.set(key, { name, homepage: agency.listUrl, reason: got.reason, checkedAt: today, agency: agency.key });
      }
    }
    await browser.close();
  }

  // ── 입주자모집공고 PDF: 아직 이미지가 없는 단지만 (청약홈 공고 첨부) ──
  if (!NO_PDF) {
    const need = all.filter((t) => {
      const k = imageKey(t.name);
      if (ONLY && !t.name.includes(ONLY)) return false;
      if (NOS.size && !NOS.has(t.no)) return false;
      return !overrides.has(k) && !manualKeys.has(k) && !items.has(k) && !!t.noticeUrl && !(candidates.get(k)?.pdf && fresh(candidates.get(k)?.checkedAt));
    });
    if (need.length) console.log(`\n───────── 입주자모집공고 PDF: ${need.length}곳 ─────────`);
    mkdirSync(IMAGE_DIR_FS, { recursive: true });
    for (const t of need) {
      await sleep(SETTINGS.betweenPdfMs);
      const k = imageKey(t.name);
      const r = await fromPdf(t.noticeUrl!, t.no).catch((e): PdfPick => ({ ok: false, reason: `오류: ${e instanceof Error ? e.message.split("\n")[0] : e}` }));
      const prev = candidates.get(k);
      if (r.ok) {
        const source = `${PDF_SOURCE}(청약홈)`;
        csvRows.push(`${csvCell(t.name)}${",".repeat(11)}${r.file},${source}`);
        csvImages[k] = { src: `/images/complexes/${r.file}`, source };
        manualKeys.add(k);
        skipped.delete(k);
        candidates.set(k, { name: t.name, checkedAt: today, homepage: prev?.homepage ?? null, candidates: prev?.candidates ?? [], review: r.review || undefined, pdf: r.pdfName });
        console.log(`■ ${t.name} → ${r.file} (${r.width}×${r.height}, ${r.page}쪽${r.review ? ", 확인 필요" : ""})`);
      } else {
        candidates.set(k, { name: t.name, checkedAt: today, homepage: prev?.homepage ?? null, candidates: prev?.candidates ?? [], review: prev?.review, pdf: `없음: ${r.reason}` });
        const s = skipped.get(k);
        skipped.set(k, { name: t.name, homepage: s?.homepage ?? t.homepage, reason: s ? `${s.reason} · ${r.reason}` : r.reason, checkedAt: today, ...(s?.agency ? { agency: s.agency } : {}) });
        console.log(`· ${t.name}: ${r.reason}`);
      }
    }
  }

  // ── 같은 지구·블록의 다른 공고(예: 공공분양과 지분적립형)는 하나만 찾아도 같이 씀 ──
  for (const t of all) {
    const k = imageKey(t.name);
    if (overrides.has(k) || manualKeys.has(k) || items.has(k)) continue;
    const ck = complexKey(t.name);
    if (!ck) continue;
    const twin = all.find((x) => x !== t && complexKey(x.name) === ck && (items.has(imageKey(x.name)) || manualKeys.has(imageKey(x.name))));
    if (!twin) continue;
    const tk = imageKey(twin.name);
    if (items.has(tk)) items.set(k, { ...items.get(tk)!, name: t.name, checkedAt: today });
    else {
      const img = csvImages[tk]!;
      const file = decodeURIComponent(img.src.split("/").pop()!);
      csvRows.push(`${csvCell(t.name)}${",".repeat(11)}${file},${img.source ?? ""}`);
      csvImages[k] = img;
      manualKeys.add(k);
    }
    skipped.delete(k);
    console.log(`· ${t.name}: 같은 지구·블록인 "${twin.name}"의 이미지를 같이 씀`);
  }

  persist(true);

  const after = tally();
  console.log("\n───────── 출처별 개수 (수집 전 → 후) ─────────");
  console.table(Object.keys(before).map((k) => ({ 출처: k, 전: before[k], 후: after[k], 변화: after[k] - before[k] })));
  console.log(`대상 ${all.length}곳. data/auto-images.json, data/image-candidates.json${csvRows.length ? `, data/complexes.csv(+${csvRows.length}줄)` : ""} 에 저장했습니다.`);
  console.log("고르기 화면: npm run dev 실행 후 http://localhost:3000/admin/images");
}

void main();
