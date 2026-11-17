/**
 * 단지 대표 이미지 찾기 (서버에서만 사용)
 *
 * 청약홈 분양정보의 홈페이지 주소(HMPG_ADRES)에서 HTML만 한 번 읽어
 * <meta property="og:image"> (없으면 twitter:image) 주소를 찾습니다.
 * - 이미지 파일은 내려받지 않고, 찾은 이미지 주소와 홈페이지 주소만 Supabase(og_images 표)에 보관합니다.
 * - 홈페이지의 robots.txt가 막고 있으면 가져오지 않습니다.
 * - 한 홈페이지에는 보관 기간 동안 한 번만 접속합니다. 제한 시간은 5초입니다.
 * Supabase가 설정되지 않았거나 표가 없으면 서버 메모리에만 잠시 보관합니다.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const OG_SETTINGS = {
  cacheDays: 7, // 찾은 결과(없음 포함)를 다시 확인하기까지
  retryFailDays: 1, // 접속 실패·시간 초과는 하루 뒤 다시 시도
  timeoutMs: 5000,
  maxHtmlBytes: 400_000, // <head>만 필요하므로 앞부분만 읽음
  userAgent: "chungyakfit-bot/1.0 (+https://chungyakfit.vercel.app)",
};

export type OgResult = { image: string | null; homepage: string; note: string };
type Stored = OgResult & { fetchedAt: number };

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

// ───────────────────────── HTML에서 이미지 주소 찾기 ─────────────────────────

export function findOgImage(html: string, base: URL): string | null {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(1).find((v) => v !== undefined) ?? null;
  const pick = (keys: string[]) => {
    for (const tag of metas) {
      const key = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
      const content = attr(tag, "content");
      if (keys.includes(key) && content) return content;
    }
    return null;
  };
  const found = pick(["og:image", "og:image:url", "og:image:secure_url"]) ?? pick(["twitter:image", "twitter:image:src"]);
  if (!found) return null;
  try {
    const u = new URL(found.replace(/&amp;/g, "&").trim(), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// ───────────────────────── 홈페이지 한 번 읽기 ─────────────────────────

async function get(url: string, signal: AbortSignal): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": OG_SETTINGS.userAgent, Accept: "text/html,*/*;q=0.5" },
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

async function scrape(home: URL): Promise<OgResult & { failed: boolean }> {
  const homepage = home.toString();
  // robots.txt와 홈페이지를 합쳐서 5초 안에 끝냄
  const signal = AbortSignal.timeout(OG_SETTINGS.timeoutMs);
  try {
    // 1) robots.txt (없거나 못 읽으면 막지 않은 것으로 봄)
    const robots = await get(`${home.origin}/robots.txt`, signal)
      .then((r) => (r.ok ? head(r) : ""))
      .catch(() => "");
    if (robots && robotsBlocks(robots, home.pathname + home.search)) return { image: null, homepage, note: "robots.txt가 접근을 막음", failed: false };

    // 2) 홈페이지 HTML
    const res = await get(homepage, signal);
    if (!res.ok) return { image: null, homepage, note: `홈페이지 응답 ${res.status}`, failed: true };
    const image = findOgImage(await head(res), new URL(res.url || homepage));
    return { image, homepage, note: image ? "og:image" : "og:image 없음", failed: false };
  } catch (e) {
    return { image: null, homepage, note: e instanceof Error && e.name === "TimeoutError" ? "시간 초과(5초)" : "접속 실패", failed: true };
  }
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
  return { image: row.image_url, homepage, note: row.note ?? "", fetchedAt: Date.parse(row.fetched_at) };
}

async function writeStored(s: Stored) {
  memory.set(s.homepage, s);
  const d = db();
  if (!d) return;
  // 표가 없거나 저장에 실패해도 화면은 그대로 동작 (메모리 보관으로 대신함)
  await d
    .from("og_images")
    .upsert({ homepage: s.homepage, image_url: s.image, note: s.note, fetched_at: new Date(s.fetchedAt).toISOString() }, { onConflict: "homepage" })
    .then(
      () => null,
      () => null,
    );
}

const DAY = 86_400_000;
const FAIL_NOTES = /시간 초과|접속 실패|홈페이지 응답/;

/** 홈페이지 주소 → 대표 이미지 주소 (보관된 값이 있으면 홈페이지에 접속하지 않음) */
export async function getOgImage(rawHomepage: string | null | undefined): Promise<OgResult | null> {
  const home = cleanHomepage(rawHomepage);
  if (!home) return null;
  const homepage = home.toString();

  const stored = await readStored(homepage).catch(() => null);
  if (stored) {
    const days = FAIL_NOTES.test(stored.note) ? OG_SETTINGS.retryFailDays : OG_SETTINGS.cacheDays;
    if (Date.now() - stored.fetchedAt < days * DAY) return stored;
  }

  // 같은 홈페이지를 동시에 여러 번 읽지 않도록 묶음
  let job = running.get(homepage);
  if (!job) {
    job = scrape(home)
      .then(async ({ image, note }) => {
        const result: Stored = { image, homepage, note, fetchedAt: Date.now() };
        await writeStored(result);
        return result;
      })
      .finally(() => running.delete(homepage));
    running.set(homepage, job);
  }
  return job;
}
