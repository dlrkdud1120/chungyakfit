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
import { chromium, type Browser } from "playwright";
import sharp from "sharp";
import { imageFor, imageKey } from "../lib/complexImage";
import { loadComplexes } from "../lib/complexes";
import { dominantShare, lookProblem, pickBest, PICK_RULES, robotsBlocks, siteMatchesName, sizeProblem, type Measured } from "../lib/image-pick";

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

type Item = { name: string; image: string; homepage: string; checkedAt: string };
type Skipped = { name: string; homepage: string | null; reason: string; checkedAt: string };

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

async function measure(url: string, buf: Buffer): Promise<Row | null> {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    const base = { url, width: meta.width, height: meta.height, entropy: 0, dominant: 1 };
    const size = sizeProblem(meta.width, meta.height);
    if (size) return { ...base, problem: size };

    // 작게 줄여서 분석 (메모리에서만. 파일로 저장하지 않음)
    const S = PICK_RULES.sampleSize;
    const small = await sharp(buf).flatten({ background: "#ffffff" }).resize(S, S, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const entropy = (await sharp(small.data, { raw: small.info }).stats()).entropy;
    const dominant = dominantShare(new Uint8Array(small.data), small.info.channels);
    return { ...base, entropy, dominant, problem: lookProblem(entropy, dominant) };
  } catch {
    return null; // 이미지가 아니거나 읽을 수 없는 형식
  }
}

async function collect(browser: Browser, homepage: string, names: string[]): Promise<SiteResult> {
  const deadline = Date.now() + SETTINGS.siteLimitMs;
  const left = () => deadline - Date.now();
  const home = new URL(homepage);

  // robots.txt가 막고 있으면 열지 않음 (없거나 못 읽으면 막지 않은 것으로 봄)
  const robots = await fetch(`${home.origin}/robots.txt`, { headers: { "User-Agent": SETTINGS.userAgent }, signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? r.text() : ""))
    .catch(() => "");
  if (robots && robotsBlocks(robots, home.pathname + home.search)) return { ok: false, reason: "robots.txt가 접근을 막음" };

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: SETTINGS.userAgent, ignoreHTTPSErrors: true });
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

// ───────────────────────── 실행 ─────────────────────────

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
    if (!ALL && !ONLY && (fresh(items.get(key)?.checkedAt) || fresh(skipped.get(key)?.checkedAt))) continue;
    if (!n.homepage || !/^https?:\/\//i.test(n.homepage)) {
      items.delete(key);
      skipped.set(key, { name: n.name, homepage: null, reason: "홈페이지 주소 없음", checkedAt: today });
      continue;
    }
    sites.set(n.homepage, [...(sites.get(n.homepage) ?? []), n.name]);
  }

  console.log(`공고 ${res.notices.length}건 · 직접 넣은 조감도/직접 지정 ${untouched}건 제외 · 이번에 열어 볼 홈페이지 ${sites.size}곳`);
  console.log(
    `기준: 가로 ${PICK_RULES.minWidth}px 이상, 비율 ${PICK_RULES.minRatio}~${PICK_RULES.maxRatio}, entropy ${PICK_RULES.minEntropy} 이상, 한 색 ${Math.round(PICK_RULES.maxDominant * 100)}% 이하\n`,
  );

  if (sites.size > 0) {
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
        // 넓이 큰 순으로 위에서 12개만 표로 (크기 기준에서 떨어진 작은 이미지는 수만 표시)
        const big = r.rows.filter((x) => !x.problem || !/^(가로|비율)/.test(x.problem));
        if (big.length > 0) console.table(
          big.slice(0, 12).map((x) => ({
            크기: `${x.width}×${x.height}`,
            entropy: x.entropy.toFixed(2),
            "한 색 비율": `${Math.round(x.dominant * 100)}%`,
            결과: x.problem ?? (r.best?.url === x.url ? "★ 선택" : "통과"),
            주소: x.url.length > 70 ? `…${x.url.slice(-68)}` : x.url,
          })),
        );
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
          items.set(key, { name, image, homepage, checkedAt: today });
          skipped.delete(key);
        } else {
          items.delete(key);
          skipped.set(key, { name, homepage, reason: reason || "홈페이지 제목에 단지명이 없음", checkedAt: today });
        }
      }
      console.log(image ? `  → ${image}\n` : `  → 지도 썸네일 (${reason})\n`);
    }
    await browser.close();
  }

  const byName = <T extends { name: string }>(list: Iterable<T>) => [...list].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const out = {
    _설명: "npm run collect-images 가 만드는 파일입니다. 직접 고치지 말고, 고칠 것이 있으면 image-overrides.json에 적으세요.",
    items: byName(items.values()),
    skipped: byName(skipped.values()),
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, "utf8");

  console.log("───────── 결과 ─────────");
  console.table([
    ...out.items.map((x) => ({ 단지: x.name, 결과: "자동 이미지", 비고: x.image.length > 60 ? `…${x.image.slice(-58)}` : x.image })),
    ...out.skipped.map((x) => ({ 단지: x.name, 결과: "지도", 비고: x.reason })),
  ]);
  console.log(`data/auto-images.json 에 저장했습니다. 자동 이미지 ${out.items.length}건, 지도 ${out.skipped.length}건.`);
  console.log("화면에서 확인: npm run dev 실행 후 http://localhost:3000/admin/images");
}

void main();
