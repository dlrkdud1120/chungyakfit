/**
 * 단지 대표 이미지 모으기 (우리 컴퓨터에서 가끔 한 번 실행하는 도구. 앱 실행·배포와는 무관)
 *
 * 실행:  npm run collect-images            새 공고와 오래된 결과만 다시 확인
 *        npm run collect-images -- --all    전부 다시 확인
 *        npm run collect-images -- --only=스위첸   이름에 이 글자가 들어간 단지만
 *
 * 하는 일
 *  1) 청약홈 분양정보에서 공고 목록과 홈페이지 주소를 받음 (.env.local의 APPLYHOME_API_KEY 사용)
 *  2) 실제 브라우저(내 컴퓨터의 Edge 또는 Chrome)로 홈페이지를 열고, 3초 기다린 뒤 끝까지 천천히 스크롤해서
 *     실제로 불러온 이미지(img 태그, CSS 배경, 네트워크로 받은 이미지)를 모음
 *  3) lib/image-pick.ts 기준으로 거름: 크기 → 복잡도(entropy) → 한 가지 색 비율 → 넓이가 가장 큰 것
 *  3-1) 홈페이지 주소가 LH·SH·GH 공용 사이트인 공공분양은 그 기관의 해당 공고 페이지에서 찾음 (lib/public-source.ts)
 *  4) 확신이 있는 단지만 data/auto-images.json에 { 단지명, 이미지 주소, 홈페이지 주소, 확인 날짜 }로 적음
 *
 * 지키는 것
 *  - 이미지 파일은 저장하지 않습니다. 분석은 메모리에서만 하고 주소만 적습니다.
 *  - robots.txt가 막은 사이트는 건너뜁니다. 사이트 사이에 2초 쉬고, 한 사이트는 20초 안에 끝냅니다.
 *  - 직접 넣은 조감도(complexes.csv)나 image-overrides.json이 있는 단지는 건드리지 않습니다.
 *  - 홈페이지 제목에 단지명이 없으면(LH·SH 같은 공용 사이트) 엉뚱한 사진이 걸리므로 건너뜁니다.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import sharp from "sharp";
import { imageFor, imageKey } from "../lib/complexImage";
import { loadComplexes } from "../lib/complexes";
import { dominantShare, lookProblem, pickBest, PICK_RULES, robotsBlocks, siteMatchesName, sizeProblem, type Measured } from "../lib/image-pick";
import { AGENCIES, agencyOf, complexKey, PUBLIC_SETTINGS, sameComplex, type Agency } from "../lib/public-source";

const SETTINGS = {
  waitAfterOpenMs: 3000, // 홈페이지를 열고 기다리는 시간
  scrollStepPx: 600,
  scrollPauseMs: 250, // 천천히 스크롤
  siteLimitMs: 20_000, // 한 사이트 제한 시간
  betweenSitesMs: 2000, // 사이트 사이에 쉬는 시간
  recheckDays: 30, // 이 기간 안에 확인한 단지는 다시 열지 않음 (--all 이면 무시)
  maxImageBytes: 20_000_000,
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 chungyakfit-bot/1.0",
};

const OUT = path.join(process.cwd(), "data", "auto-images.json");
const OVERRIDES = path.join(process.cwd(), "data", "image-overrides.json");

const HOMEPAGE_SOURCE = "분양 홈페이지";
// source: 출처 이름 ("분양 홈페이지" 또는 "LH청약플러스" 같은 기관 사이트 이름). homepage: 누르면 열리는 출처 주소
type Item = { name: string; image: string; homepage: string; checkedAt: string; source?: string };
// agency: 공공기관 공고 페이지까지 찾아본 경우 그 기관 (LH, SH, GH)
type Skipped = { name: string; homepage: string | null; reason: string; checkedAt: string; agency?: string };

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const ONLY = args.find((a) => a.startsWith("--only="))?.slice(7) ?? "";
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

type Row = Measured & { problem: string | null };
type SiteResult =
  | { ok: false; reason: string; title?: string }
  | { ok: true; title: string; found: number; rows: Row[]; best: Measured | null; timedOut: boolean };

/** 페이지 안에서 실행: 제목과, 화면에 쓰인 이미지 주소(img 태그 + CSS 배경) */
const IN_PAGE = `(() => {
  const urls = new Set();
  for (const i of document.images) { const u = i.currentSrc || i.src; if (u) urls.add(u); }
  for (const el of document.querySelectorAll("*")) {
    const b = getComputedStyle(el).backgroundImage;
    if (b && b !== "none") for (const m of b.matchAll(/url\\(["']?([^"')]+)["']?\\)/g)) { try { urls.add(new URL(m[1], location.href).href); } catch {} }
  }
  const meta = (p) => document.querySelector('meta[property="' + p + '"]')?.getAttribute("content") || "";
  return { title: [document.title, meta("og:title"), meta("og:site_name")].join(" "), urls: [...urls], height: document.documentElement.scrollHeight };
})()`;

async function measure(url: string, buf: Buffer, labeled = false): Promise<Row | null> {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    const base = { url, width: meta.width, height: meta.height, entropy: 0, dominant: 1 };
    const size = sizeProblem(meta.width, meta.height, labeled);
    if (size) return { ...base, problem: size };

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
    return { ...base, entropy, dominant, problem: lookProblem(entropy, dominant, transparent) };
  } catch {
    return null; // 이미지가 아니거나 읽을 수 없는 형식
  }
}

const readRobots = (origin: string) =>
  fetch(`${origin}/robots.txt`, { headers: { "User-Agent": SETTINGS.userAgent }, signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? r.text() : ""))
    .catch(() => "");

const newContext = (browser: Browser) => browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: SETTINGS.userAgent, ignoreHTTPSErrors: true });

async function collect(browser: Browser, homepage: string, names: string[]): Promise<SiteResult> {
  const deadline = Date.now() + SETTINGS.siteLimitMs;
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
      return { ok: false, reason: "홈페이지가 열리지 않음" };
    }
    await page.waitForTimeout(SETTINGS.waitAfterOpenMs);

    // 끝까지 천천히 스크롤 (늦게 불러오는 이미지까지). 분석할 시간 6초는 남겨 둠
    for (let y = 0; left() > 6000; y += SETTINGS.scrollStepPx) {
      const height = (await page.evaluate("document.documentElement.scrollHeight").catch(() => 0)) as number;
      if (y > height) break;
      await page.evaluate(`window.scrollTo(0, ${y})`).catch(() => undefined);
      await page.waitForTimeout(SETTINGS.scrollPauseMs);
    }

    const dom = (await page.evaluate(IN_PAGE).catch(() => null)) as { title: string; urls: string[] } | null;
    if (!dom) return { ok: false, reason: "페이지를 읽지 못함" };
    if (!names.some((n) => siteMatchesName(n, dom.title))) {
      return { ok: false, reason: `공용 홈페이지로 보임 (제목 "${dom.title.trim().slice(0, 30)}"에 단지명이 없음)`, title: dom.title };
    }
    await Promise.race([Promise.all(pending), sleep(1500)]);

    const urls = [...new Set([...dom.urls, ...bodies.keys()])].filter((u) => {
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
    return { ok: true, title: dom.title, found: urls.length, rows, best: pickBest(rows.filter((r) => r.problem === null)), timedOut };
  } finally {
    await context.close();
  }
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
        결과: x.problem ?? (best?.url === x.url ? "★ 선택" : "통과"),
        주소: x.url.length > 70 ? `…${x.url.slice(-68)}` : x.url,
      })),
    );
  }
  return big;
}

async function main() {
  loadEnv();
  const { fetchNotices } = await import("../lib/applyhome");
  const res = await fetchNotices();
  if (!res.ok) {
    console.log(`!! 공고 목록을 받지 못했습니다: ${res.reason}\n   프로젝트 폴더에서 실행했는지, .env.local에 APPLYHOME_API_KEY가 있는지 확인해 주세요.`);
    process.exit(1);
  }

  const manual = loadComplexes().images;
  const overrides = new Set(
    Object.keys(readJson<Record<string, unknown>>(OVERRIDES, {}))
      .filter((k) => !k.startsWith("_"))
      .map(imageKey),
  );
  const old = readJson<{ items?: Item[]; skipped?: Skipped[] }>(OUT, {});
  const items = new Map((old.items ?? []).map((x) => [imageKey(x.name), x]));
  const skipped = new Map((old.skipped ?? []).map((x) => [imageKey(x.name), x]));
  const fresh = (date: string | undefined) => !!date && (Date.parse(today) - Date.parse(date)) / 86_400_000 < SETTINGS.recheckDays;

  // 확인할 단지를 홈페이지별로 묶음 (같은 홈페이지는 한 번만 엶)
  const sites = new Map<string, string[]>();
  // 홈페이지 주소가 LH·SH·GH 공용 사이트인 공공분양은 그 기관의 해당 공고 페이지에서 찾음
  const publics: { name: string; agency: Agency }[] = [];
  let untouched = 0;
  for (const n of res.notices) {
    const key = imageKey(n.name);
    if (ONLY && !n.name.includes(ONLY)) continue;
    if (imageFor(manual, n.name) || overrides.has(key)) {
      untouched += 1; // 직접 넣은 조감도나 직접 지정이 먼저라 자동 이미지가 필요 없음
      items.delete(key);
      skipped.delete(key);
      continue;
    }
    const agency = agencyOf(n.homepage);
    // 예전 방식(공용 홈페이지라 건너뜀)으로만 확인한 공공분양은 기간이 안 지났어도 다시 봄
    const skippedBefore = skipped.get(key);
    const skippedFresh = fresh(skippedBefore?.checkedAt) && (!agency || skippedBefore?.agency === agency.key);
    if (!ALL && !ONLY && (fresh(items.get(key)?.checkedAt) || skippedFresh)) continue;
    if (agency) {
      publics.push({ name: n.name, agency });
      continue;
    }
    if (!n.homepage || !/^https?:\/\//i.test(n.homepage)) {
      items.delete(key);
      skipped.set(key, { name: n.name, homepage: null, reason: "홈페이지 주소 없음", checkedAt: today });
      continue;
    }
    sites.set(n.homepage, [...(sites.get(n.homepage) ?? []), n.name]);
  }

  console.log(`공고 ${res.notices.length}건 · 직접 넣은 조감도/직접 지정 ${untouched}건 제외 · 이번에 열어 볼 홈페이지 ${sites.size}곳 · 공공기관 공고 ${publics.length}건`);
  console.log(
    `기준: 가로 ${PICK_RULES.minWidth}px 이상, 비율 ${PICK_RULES.minRatio}~${PICK_RULES.maxRatio}, entropy ${PICK_RULES.minEntropy} 이상, 한 색 ${Math.round(PICK_RULES.maxDominant * 100)}% 이하\n`,
  );

  if (sites.size > 0 || publics.length > 0) {
    const browser = await openBrowser();
    let first = true;
    for (const [homepage, names] of sites) {
      if (!first) await sleep(SETTINGS.betweenSitesMs);
      first = false;
      console.log(`■ ${names.join(", ")}\n  ${homepage}`);
      const r = await collect(browser, homepage, names).catch((e): SiteResult => ({ ok: false, reason: `오류: ${e instanceof Error ? e.message.split("\n")[0] : e}` }));

      let image: string | null = null;
      let reason = "";
      if (!r.ok) {
        reason = r.reason;
      } else {
        const big = printRows(r.rows.filter((x) => !x.problem || !/^비율/.test(x.problem)), r.best);
        console.log(`  찾은 이미지 ${r.found}개 · 크기 기준 탈락 ${r.rows.length - big.length}개${r.timedOut ? " · 20초 제한으로 일부만 확인" : ""}`);
        if (!r.best) reason = big.length ? "남은 후보가 모두 로고·단색 배경으로 보임" : "크기 기준에 맞는 이미지가 없음";
        else {
          image = await httpsUrl(r.best.url);
          if (!image) reason = "이미지를 https로 불러올 수 없음";
        }
      }

      for (const name of names) {
        const key = imageKey(name);
        // 같은 홈페이지를 쓰는 단지라도 제목에 그 단지명이 있어야 함
        if (image && r.ok && siteMatchesName(name, r.title)) {
          items.set(key, { name, image, homepage, checkedAt: today, source: HOMEPAGE_SOURCE });
          skipped.delete(key);
        } else {
          items.delete(key);
          skipped.set(key, { name, homepage, reason: reason || "홈페이지 제목에 단지명이 없음", checkedAt: today });
        }
      }
      console.log(image ? `  → ${image}\n` : `  → 지도 썸네일 (${reason})\n`);
    }

    // 공공분양: 기관의 해당 공고 페이지 (같은 지구·블록의 공고는 한 번만 찾아서 같이 씀)
    const found = new Map<string, { image: string | null; reason: string }>();
    for (const { name, agency } of publics) {
      const key = imageKey(name);
      const same = `${agency.key}|${complexKey(name) ?? name}`;
      let got = found.get(same);
      if (!got) {
        if (!first) await sleep(SETTINGS.betweenSitesMs);
        first = false;
        console.log(`■ ${name}\n  ${agency.site} 공고 페이지`);
        const r = await fromAgency(browser, agency, name).catch((e): PublicResult => ({ reason: `오류: ${e instanceof Error ? e.message.split("\n")[0] : e}` }));
        got = { image: null, reason: "" };
        if ("reason" in r) got.reason = r.reason;
        else {
          console.log(`  찾은 공고: ${r.found}`);
          printRows(r.rows, r.best);
          if (!r.best) got.reason = `${agency.site} 공고 페이지의 이미지가 기준에 맞지 않음`;
          else {
            got.image = await httpsUrl(r.best.url);
            if (!got.image) got.reason = "이미지를 https로 불러올 수 없음";
          }
        }
        found.set(same, got);
        console.log(got.image ? `  → ${got.image}\n` : `  → 지도 썸네일 (${got.reason})\n`);
      }
      if (got.image) {
        items.set(key, { name, image: got.image, homepage: agency.listUrl, checkedAt: today, source: agency.site });
        skipped.delete(key);
      } else {
        items.delete(key);
        skipped.set(key, { name, homepage: agency.listUrl, reason: got.reason, checkedAt: today, agency: agency.key });
      }
    }
    await browser.close();
  }

  // 같은 지구·블록의 다른 공고(예: 공공분양과 지분적립형)에 이미지가 있으면 같이 씀
  for (const [key, s] of [...skipped]) {
    const k = complexKey(s.name);
    const twin = k ? [...items.values()].find((x) => complexKey(x.name) === k) : null;
    if (!twin) continue;
    items.set(key, { ...twin, name: s.name, checkedAt: today });
    skipped.delete(key);
    console.log(`· ${s.name}: 같은 지구·블록인 "${twin.name}"의 이미지를 같이 씀`);
  }

  const byName = <T extends { name: string }>(list: Iterable<T>) => [...list].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const out = {
    _설명: "npm run collect-images 가 만드는 파일입니다. 직접 고치지 말고, 고칠 것이 있으면 image-overrides.json에 적으세요.",
    items: byName([...items.values()].map((x) => ({ ...x, source: x.source ?? HOMEPAGE_SOURCE }))),
    skipped: byName(skipped.values()),
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, "utf8");

  console.log("───────── 결과 ─────────");
  console.table([
    ...out.items.map((x) => ({ 단지: x.name, 결과: x.source, 비고: x.image.length > 60 ? `…${x.image.slice(-58)}` : x.image })),
    ...out.skipped.map((x) => ({ 단지: x.name, 결과: "지도", 비고: x.reason })),
  ]);
  console.log(`data/auto-images.json 에 저장했습니다. 자동 이미지 ${out.items.length}건, 지도 ${out.skipped.length}건.`);
  console.log("화면에서 확인: npm run dev 실행 후 http://localhost:3000/admin/images");
}

void main();
