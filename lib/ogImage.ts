/**
 * 단지 대표 이미지 찾기 (서버에서만 사용)
 *
 * 청약홈 분양정보의 홈페이지 주소(HMPG_ADRES)에서 HTML을 한 번 읽어 후보 이미지를 모으고,
 * lib/image-pick.ts 규칙으로 점수를 매겨 상위 후보의 실제 크기를 확인한 뒤 하나를 고릅니다.
 * - 이미지 파일은 저장하지 않습니다. 크기 확인도 파일 앞부분만 잠깐 읽고 버립니다.
 *   고른 이미지 주소와 홈페이지 주소, 고른 이유만 Supabase(og_images 표)에 보관합니다.
 * - 홈페이지의 robots.txt가 막고 있으면 가져오지 않습니다.
 * - 한 홈페이지에는 보관 기간 동안 한 번만 접속합니다. HTML 읽기 제한 시간은 5초입니다.
 * - 고르는 규칙(PICK_RULES.version)이 바뀌면 보관해 둔 결과를 버리고 다시 고릅니다.
 * Supabase가 설정되지 않았거나 표가 없으면 서버 메모리에만 잠시 보관합니다.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { collectCandidates, kindOf, PICK_RULES, readImageSize, shortlist, sizeProblem, type PickKind } from "./image-pick";

export const OG_SETTINGS = {
  cacheDays: 7, // 찾은 결과(없음 포함)를 다시 확인하기까지
  retryFailDays: 1, // 접속 실패·시간 초과는 하루 뒤 다시 시도
  timeoutMs: 5000,
  maxHtmlBytes: 900_000, // 본문의 <img>까지 보려고 넉넉히 읽음
  probeTimeoutMs: 4000, // 후보 이미지 크기 확인(상위 몇 개를 한꺼번에)에 쓰는 시간
  probeBytes: 262_144, // 크기를 읽으려고 이미지 파일 앞부분만 받는 양
  refreshMinMinutes: 10, // "다시 가져오기"를 연달아 눌러도 이 시간 안에는 홈페이지에 다시 접속하지 않음
  userAgent: "chungyakfit-bot/1.0 (+https://chungyakfit.vercel.app)",
};

/** 확인용 화면(/admin/images)에 보여줄 "왜 이렇게 골랐는지" */
export type PickDetail = {
  v: number; // 고를 때 쓴 규칙 버전
  msg: string; // 한 줄 설명
  score?: number;
  size?: string; // "1200×630"
  top?: { url: string; score: number; why: string; size: string; problem: string | null }[]; // 크기를 확인한 후보들
  count?: number; // 찾은 후보 수
};
export type OgResult = { image: string | null; homepage: string; kind: PickKind; detail: PickDetail; fetchedAt: number };
type Stored = OgResult;

// ───────────────────────── 주소 다듬기 ─────────────────────────

/** http(s) 공개 주소만 허용. 내부망·localhost는 거름 (시험할 때만 OG_IMAGE_ALLOW_LOCAL=1) */
export function cleanHomepage(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `http://${raw.trim()}`);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  const local =
    host === "localhost" ||
    host.endsWith(".local") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) ||
    host.includes(":") || // IPv6 글자 주소
    !host.includes(".");
  if (local && process.env.OG_IMAGE_ALLOW_LOCAL !== "1") return null;
  u.hash = "";
  return u;
}

// ───────────────────────── robots.txt ─────────────────────────

/** robots.txt 내용에서 우리(또는 *)에게 이 경로가 막혀 있는지 */
export function robotsBlocks(robots: string, path: string, agent = "chungyakfit-bot"): boolean {
  type Group = { agents: string[]; rules: { allow: boolean; path: string }[] };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const line of robots.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*(#.*)?$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2];
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "disallow" || key === "allow") && cur) {
      if (value) cur.rules.push({ allow: key === "allow", path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  // 가장 길게 맞는 규칙이 이김 (같은 길이면 허용)
  let best: { allow: boolean; len: number } | null = null;
  for (const r of use.flatMap((g) => g.rules)) {
    const pattern = new RegExp(
      "^" +
        r.path
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\\\$$/, "$"),
    );
    if (!pattern.test(path)) continue;
    if (!best || r.path.length > best.len || (r.path.length === best.len && r.allow)) best = { allow: r.allow, len: r.path.length };
  }
  return best ? !best.allow : false;
}

// ───────────────────────── 홈페이지 한 번 읽기 ─────────────────────────

async function get(url: string, signal: AbortSignal, extra: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": OG_SETTINGS.userAgent, Accept: "text/html,*/*;q=0.5", ...extra },
    redirect: "follow",
    cache: "no-store",
    signal,
  });
}

/** 응답 앞부분만 글자로 읽기 */
async function head(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < OG_SETTINGS.maxHtmlBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
  }
  void reader.cancel().catch(() => null);
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  // 오래된 분양 홈페이지는 EUC-KR인 경우가 있음 (주소만 필요하므로 깨져도 대부분 무방하지만 맞춰 읽음)
  const type = res.headers.get("content-type") ?? "";
  const sniff = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const charset = (/charset=["']?([\w-]+)/i.exec(type) ?? /charset=["']?([\w-]+)/i.exec(sniff))?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** 응답 앞부분 바이트만 읽기 (이미지 크기 확인용. 읽은 내용은 저장하지 않음) */
async function firstBytes(res: Response, max: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const out = new Uint8Array(max);
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    out.set(value.subarray(0, max - size), size);
    size += Math.min(value.length, max - size);
  }
  void reader.cancel().catch(() => null);
  return out.subarray(0, size);
}

/** 이미지 주소의 가로·세로 (파일 앞부분만 받아서 읽음). 모르면 null */
async function probeSize(url: string, signal: AbortSignal): Promise<{ width: number; height: number } | null> {
  try {
    const res = await get(url, signal, { Accept: "image/*", Range: `bytes=0-${OG_SETTINGS.probeBytes - 1}` });
    if (!res.ok) return null;
    return readImageSize(await firstBytes(res, OG_SETTINGS.probeBytes));
  } catch {
    return null;
  }
}

type Scraped = { image: string | null; kind: PickKind; detail: PickDetail };

async function scrape(home: URL): Promise<Scraped> {
  const v = PICK_RULES.version;
  const none = (msg: string, more: Partial<PickDetail> = {}): Scraped => ({ image: null, kind: "지도", detail: { v, msg, ...more } });
  const homepage = home.toString();
  // robots.txt와 홈페이지를 합쳐서 5초 안에 끝냄
  const signal = AbortSignal.timeout(OG_SETTINGS.timeoutMs);
  let html: string;
  let base: URL;
  let robots: string;
  try {
    // 1) robots.txt (없거나 못 읽으면 막지 않은 것으로 봄)
    robots = await get(`${home.origin}/robots.txt`, signal)
      .then((r) => (r.ok ? head(r) : ""))
      .catch(() => "");
    if (robots && robotsBlocks(robots, home.pathname + home.search)) return none("robots.txt가 접근을 막음");

    // 2) 홈페이지 HTML (한 번만)
    const res = await get(homepage, signal);
    if (!res.ok) return none(`홈페이지 응답 ${res.status}`);
    base = new URL(res.url || homepage);
    html = await head(res);
  } catch (e) {
    return none(e instanceof Error && e.name === "TimeoutError" ? "시간 초과(5초)" : "접속 실패");
  }

  // 3) 후보를 모아 점수를 매기고, 상위 후보만 실제 크기를 확인
  const all = collectCandidates(html, base);
  const short = shortlist(all).filter((c) => {
    const u = new URL(c.url);
    return !(robots && u.origin === base.origin && robotsBlocks(robots, u.pathname + u.search)); // 같은 사이트의 막힌 경로는 건드리지 않음
  });
  if (short.length === 0) return none(all.length ? "쓸 만한 후보 없음 (로고·배너만 있음)" : "이미지 후보 없음", { count: all.length });

  const probeSignal = AbortSignal.timeout(OG_SETTINGS.probeTimeoutMs);
  const sizes = await Promise.all(short.map((c) => probeSize(c.url, probeSignal)));
  const top = short.map((c, i) => {
    const size = sizes[i];
    return {
      url: c.url,
      score: c.score,
      why: c.why.join(", "),
      size: size ? `${size.width}×${size.height}` : "확인 못 함",
      problem: size ? sizeProblem(size.width, size.height) : "크기를 확인하지 못함",
    };
  });
  const win = top.findIndex((t) => t.problem === null); // 점수 높은 순이므로 처음 통과한 것이 가장 좋은 후보
  if (win === -1) return none("상위 후보가 모두 크기 기준에 안 맞음", { top, count: all.length });
  return {
    image: top[win].url,
    kind: kindOf(short[win]),
    detail: { v, msg: top[win].why || "og:image", score: top[win].score, size: top[win].size, top, count: all.length },
  };
}

// ───────────────────────── 보관 (Supabase, 안 되면 메모리) ─────────────────────────

const memory = new Map<string, Stored>();
const running = new Map<string, Promise<OgResult>>();

let client: SupabaseClient | null | undefined;
function db(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return client;
}

async function readStored(homepage: string): Promise<Stored | null> {
  const mem = memory.get(homepage);
  if (mem) return mem;
  const d = db();
  if (!d) return null;
  const { data, error } = await d.from("og_images").select("image_url, note, fetched_at").eq("homepage", homepage).limit(1);
  if (error || !data?.[0]) return null;
  const row = data[0] as { image_url: string | null; note: string | null; fetched_at: string };
  // note 칸에는 고른 이유를 JSON으로 넣어 둠. 예전 형식이면 버리고 다시 가져옴
  let saved: { kind?: PickKind; detail?: PickDetail };
  try {
    saved = JSON.parse(row.note ?? "") as typeof saved;
  } catch {
    return null;
  }
  if (!saved.kind || !saved.detail) return null;
  return { image: row.image_url, homepage, kind: saved.kind, detail: saved.detail, fetchedAt: Date.parse(row.fetched_at) };
}

async function writeStored(s: Stored) {
  memory.set(s.homepage, s);
  const d = db();
  if (!d) return;
  // 표가 없거나 저장에 실패해도 화면은 그대로 동작 (메모리 보관으로 대신함)
  await d
    .from("og_images")
    .upsert(
      { homepage: s.homepage, image_url: s.image, note: JSON.stringify({ kind: s.kind, detail: s.detail }), fetched_at: new Date(s.fetchedAt).toISOString() },
      { onConflict: "homepage" },
    )
    .then(
      () => null,
      () => null,
    );
}

const DAY = 86_400_000;
const FAILED = /시간 초과|접속 실패|홈페이지 응답/;

/**
 * 홈페이지 주소 → 대표 이미지 (보관된 값이 있으면 홈페이지에 접속하지 않음)
 * refresh: 보관된 값을 무시하고 다시 가져옴 (확인용 화면의 "다시 가져오기". 너무 잦은 접속은 막음)
 */
export async function getOgImage(rawHomepage: string | null | undefined, refresh = false): Promise<OgResult | null> {
  const home = cleanHomepage(rawHomepage);
  if (!home) return null;
  const homepage = home.toString();

  const stored = await readStored(homepage).catch(() => null);
  if (stored) {
    const age = Date.now() - stored.fetchedAt;
    const days = FAILED.test(stored.detail.msg) ? OG_SETTINGS.retryFailDays : OG_SETTINGS.cacheDays;
    const fresh = stored.detail.v === PICK_RULES.version && age < days * DAY;
    if (refresh ? age < OG_SETTINGS.refreshMinMinutes * 60_000 && stored.detail.v === PICK_RULES.version : fresh) return stored;
  }

  // 같은 홈페이지를 동시에 여러 번 읽지 않도록 묶음
  let job = running.get(homepage);
  if (!job) {
    job = scrape(home)
      .then(async (r) => {
        const result: Stored = { ...r, homepage, fetchedAt: Date.now() };
        await writeStored(result);
        return result;
      })
      .finally(() => running.delete(homepage));
    running.set(homepage, job);
  }
  return job;
}
