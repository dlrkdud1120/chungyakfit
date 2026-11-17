/**
 * 단지 대표 이미지 고르기 규칙 (화면·서버 공용, 파일 읽기·접속 없음)
 *
 * 분양 홈페이지 HTML에서 후보 이미지를 모아 점수를 매기고 순서를 정합니다.
 * 실제 접속(HTML 읽기, 이미지 크기 확인)은 lib/ogImage.ts가 하고, 이 파일은 규칙만 담습니다.
 * 키워드와 기준값은 맨 위 PICK_RULES만 고치면 됩니다.
 * 규칙을 바꿨다면 version 숫자를 올리세요. 보관해 둔 예전 결과를 버리고 새 규칙으로 다시 고릅니다.
 */

export const PICK_RULES = {
  version: 2,

  // 후보가 어디서 나왔는지에 따른 기본 점수
  base: { "og:image": 2, "twitter:image": 1.5, img: 0, background: 0 },

  // 가산점: 파일 이름, alt, class, id에 들어 있으면
  good: ["조감도", "투시도", "bird", "perspective", "aerial", "exterior", "main_visual", "mainvisual", "visual", "danji", "complex"],
  goodScore: 5, // 이미지 자신의 이름·alt·class·id에 있을 때
  goodNearScore: 2, // 이미지 바로 앞 HTML(감싸는 칸의 class 등)에만 있을 때
  nearChars: 300,

  // 감점: 로고·버튼·배너처럼 조감도가 아닐 가능성이 큰 이름
  bad: ["logo", "icon", "btn", "banner", "popup", "favicon"], // 글자 일부로 들어 있어도 감점
  badWords: ["ci", "bi", "tel", "call", "qr"], // 짧은 말이라 낱말로 떨어져 있을 때만 감점 (city, mobile 등은 제외)
  badScore: -6,

  // 제외: 이 확장자는 후보에서 뺌
  skipExt: ["svg", "gif"],

  minScore: 1, // 이 점수 미만은 쓰지 않음 (아무 단서 없는 일반 <img>는 0점)
  checkTop: 3, // 점수 상위 몇 개까지 실제 크기를 확인할지

  // 크기 기준: 로고는 작거나 정사각형, 배너는 너무 납작한 경우가 많음
  minWidth: 600,
  minRatio: 1.2, // 가로 ÷ 세로
  maxRatio: 2.2,
};

export type CandidateSource = keyof typeof PICK_RULES.base;

export type Candidate = {
  url: string;
  source: CandidateSource;
  hint: string; // 파일 이름 + alt + class + id (점수 계산에 쓴 글자)
  score: number;
  good: boolean; // 조감도 키워드가 이미지 자신에게 있었는지
  why: string[]; // 점수가 붙은 이유 (확인용 화면에 표시)
};

/** 화면에 보여줄 "어떤 종류로 골랐는지" */
export type PickKind = "조감도 후보" | "og:image" | "직접 지정" | "지도" | "숨김";

export function kindOf(c: Candidate): PickKind {
  return c.good ? "조감도 후보" : c.source === "og:image" || c.source === "twitter:image" ? "og:image" : "조감도 후보";
}

// ───────────────────────── 후보 모으기 ─────────────────────────

const attrOf = (tag: string, name: string): string | null =>
  new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
    .exec(tag)
    ?.slice(1)
    .find((v) => v !== undefined) ?? null;

function absolute(raw: string, base: URL): string | null {
  const s = raw.replace(/&amp;/g, "&").trim();
  if (!s || s.startsWith("data:") || s.startsWith("javascript:")) return null;
  try {
    const u = new URL(s, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function fileName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).slice(-2).join("/"));
  } catch {
    return url;
  }
}

function extOf(url: string): string {
  try {
    return (/\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)?.[1] ?? "").toLowerCase();
  } catch {
    return "";
  }
}

/** HTML에서 후보를 모아 점수 높은 순으로 (같은 주소는 점수 높은 것 하나만) */
export function collectCandidates(html: string, base: URL): Candidate[] {
  const R = PICK_RULES;
  const found: { url: string; source: CandidateSource; hint: string; near: string }[] = [];
  const add = (raw: string | null, source: CandidateSource, hint: string, near: string) => {
    const url = raw ? absolute(raw, base) : null;
    if (url) found.push({ url, source, hint: `${fileName(url)} ${hint}`, near });
  };

  // 1) og:image, twitter:image
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attrOf(m[0], "property") ?? attrOf(m[0], "name") ?? "").toLowerCase();
    const content = attrOf(m[0], "content");
    if (["og:image", "og:image:url", "og:image:secure_url"].includes(key)) add(content, "og:image", "", "");
    else if (["twitter:image", "twitter:image:src"].includes(key)) add(content, "twitter:image", "", "");
  }

  // 2) <img> (늦게 불러오는 data-src 계열 포함)
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attrOf(tag, "data-src") ?? attrOf(tag, "data-original") ?? attrOf(tag, "data-lazy") ?? attrOf(tag, "src");
    const hint = [attrOf(tag, "alt"), attrOf(tag, "class"), attrOf(tag, "id"), attrOf(tag, "title")].filter(Boolean).join(" ");
    add(src, "img", hint, html.slice(Math.max(0, m.index - R.nearChars), m.index));
  }

  // 3) CSS background-image (태그의 style 속성과 <style> 안)
  for (const m of html.matchAll(/background(?:-image)?\s*:[^;{}"']*url\(\s*(?:&quot;|["'])?([^"')]+?)(?:&quot;|["'])?\s*\)/gi)) {
    const before = html.slice(Math.max(0, m.index - R.nearChars), m.index);
    const tagStart = before.lastIndexOf("<");
    const own = tagStart >= 0 && !before.slice(tagStart).includes(">") ? before.slice(tagStart) : ""; // style 속성이 달린 태그
    const selector = own ? "" : (/([^{}]*)\{[^{}]*$/.exec(before)?.[1] ?? ""); // <style> 안이면 선택자
    const hint = own ? [attrOf(own, "class"), attrOf(own, "id")].filter(Boolean).join(" ") : selector.trim().slice(-80);
    add(m[1], "background", hint, own ? before.slice(0, tagStart) : "");
  }

  const has = (text: string, word: string) => text.toLowerCase().includes(word.toLowerCase());
  const words = (text: string) => text.toLowerCase().split(/[^a-z0-9가-힣]+/);

  const best = new Map<string, Candidate>();
  for (const f of found) {
    if (R.skipExt.includes(extOf(f.url))) continue;
    const why: string[] = [];
    let score = R.base[f.source];
    if (score) why.push(`${f.source} +${score}`);

    const own = R.good.filter((k) => has(f.hint, k));
    const near = own.length ? [] : R.good.filter((k) => has(f.near, k));
    if (own.length) {
      score += R.goodScore;
      why.push(`${own.join("·")} +${R.goodScore}`);
    } else if (near.length) {
      score += R.goodNearScore;
      why.push(`주변 ${near.join("·")} +${R.goodNearScore}`);
    }

    const w = words(f.hint);
    const bad = [...R.bad.filter((k) => has(f.hint, k)), ...R.badWords.filter((k) => w.includes(k))];
    if (bad.length) {
      score += R.badScore;
      why.push(`${bad.join("·")} ${R.badScore}`);
    }

    const c: Candidate = { url: f.url, source: f.source, hint: f.hint.trim().slice(0, 160), score, good: own.length > 0, why };
    const prev = best.get(f.url);
    if (!prev || c.score > prev.score) best.set(f.url, c);
  }

  // 점수 높은 순. 같은 점수면 HTML에 먼저 나온 것 (Map은 넣은 순서를 지킴)
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/** 크기를 확인해 볼 후보 (기준 점수 이상인 상위 몇 개) */
export function shortlist(candidates: Candidate[]): Candidate[] {
  return candidates.filter((c) => c.score >= PICK_RULES.minScore).slice(0, PICK_RULES.checkTop);
}

/** 가로·세로가 대표 이미지로 쓸 만한지. 안 되면 이유를 돌려줌 */
export function sizeProblem(width: number, height: number): string | null {
  const R = PICK_RULES;
  if (width < R.minWidth) return `가로 ${width}px (${R.minWidth}px 미만)`;
  const ratio = width / height;
  if (ratio < R.minRatio || ratio > R.maxRatio) return `비율 ${ratio.toFixed(2)} (${R.minRatio}~${R.maxRatio} 밖)`;
  return null;
}

// ───────────────────────── 이미지 파일 앞부분에서 크기 읽기 ─────────────────────────

/** PNG·JPEG·WebP 파일의 앞부분 바이트에서 가로·세로를 읽음. 모르는 형식이면 null */
export function readImageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1];
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const text = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

  // PNG
  if (b.length >= 24 && u32(0) === 0x89504e47) return { width: u32(16), height: u32(20) };

  // JPEG: SOF 표식을 찾을 때까지 구간을 건너뜀
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: u16(i + 7), height: u16(i + 5) };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      i += 2 + u16(i + 2);
    }
    return null;
  }

  // WebP
  if (b.length >= 30 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    const kind = text(12, 4);
    if (kind === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (kind === "VP8 ") return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    if (kind === "VP8L") {
      const n = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (n & 0x3fff) + 1, height: ((n >>> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}
