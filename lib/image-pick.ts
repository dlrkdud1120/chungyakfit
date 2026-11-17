/**
 * 단지 대표 이미지 고르기 규칙 (접속·파일 읽기 없음. scripts/collect-images.ts가 사용)
 *
 * 이름(키워드)으로 추측하지 않고 이미지 자체를 봅니다.
 *   1) 크기: 너무 작거나, 정사각형(로고)·너무 납작한(배너) 이미지는 제외
 *   2) 복잡도(entropy): 단색 배경 위 로고처럼 단순한 이미지는 제외
 *   3) 가장 많은 한 가지 색의 비율: 로고·단색 배너는 한 색이 화면을 거의 다 차지함
 *   4) 남은 것 중 넓이가 가장 큰 이미지. 넓이가 비슷하면 더 복잡한(사진에 가까운) 이미지
 * 기준값은 아래 PICK_RULES만 고치면 됩니다.
 *
 * 기준값을 맞춘 근거 (2026-11-17, 실제 분양 홈페이지 5곳에서 잰 값):
 *   조감도·투시도   entropy 7.03 ~ 7.84, 한 색 비율 0.10 ~ 0.37
 *   로고·단색 배경  entropy 0 ~ 6.54,   한 색 비율 0.39 ~ 1.00
 *   (회색 질감 위 로고가 entropy 6.54 / 0.39로 가장 사진에 가까웠고, 가장 단순한 조감도가 7.03 / 0.37)
 */

export const PICK_RULES = {
  // 1) 크기
  minWidth: 800,
  minRatio: 1.2, // 가로 ÷ 세로
  maxRatio: 2.2,

  // 2) 복잡도: sharp의 stats().entropy (0 ~ 8). 이 값보다 낮으면 제외
  minEntropy: 6.8,

  // 3) 한 가지 색 비율: 작게 줄인 이미지에서 가장 많은 색이 이 비율을 넘으면 제외
  maxDominant: 0.4,
  sampleSize: 64, // 분석할 때 줄이는 크기 (가로·세로 픽셀)
  colorLevels: 8, // 색을 채널당 몇 단계로 묶어서 "같은 색"으로 볼지

  // 4) 넓이가 가장 큰 것의 이 비율 이상이면 "비슷한 넓이"로 보고 복잡도로 정함
  sameAreaRatio: 0.9,
};

export type Measured = {
  url: string;
  width: number;
  height: number;
  entropy: number;
  dominant: number; // 0 ~ 1
};

/** 크기 기준에 안 맞으면 이유, 맞으면 null */
export function sizeProblem(width: number, height: number): string | null {
  const R = PICK_RULES;
  if (width < R.minWidth) return `가로 ${width}px (${R.minWidth}px 미만)`;
  const ratio = width / height;
  if (ratio < R.minRatio || ratio > R.maxRatio) return `비율 ${ratio.toFixed(2)} (${R.minRatio}~${R.maxRatio} 밖)`;
  return null;
}

/** 이미지 내용이 로고·단색 배너처럼 보이면 이유, 아니면 null */
export function lookProblem(entropy: number, dominant: number): string | null {
  const R = PICK_RULES;
  if (entropy < R.minEntropy) return `단순함 (entropy ${entropy.toFixed(2)} < ${R.minEntropy})`;
  if (dominant > R.maxDominant) return `한 색이 ${Math.round(dominant * 100)}% (${Math.round(R.maxDominant * 100)}% 초과)`;
  return null;
}

/**
 * 가장 많은 한 가지 색이 차지하는 비율
 * pixels: 줄인 이미지의 RGB 값이 차례로 들어 있는 배열 (channels = 한 픽셀당 값 개수, 3 또는 4)
 */
export function dominantShare(pixels: Uint8Array, channels: number): number {
  const shift = 8 - Math.log2(PICK_RULES.colorLevels);
  const counts = new Map<number, number>();
  let n = 0;
  let max = 0;
  for (let i = 0; i + 2 < pixels.length; i += channels) {
    const key = ((pixels[i] >> shift) << 16) | ((pixels[i + 1] >> shift) << 8) | (pixels[i + 2] >> shift);
    const c = (counts.get(key) ?? 0) + 1;
    counts.set(key, c);
    if (c > max) max = c;
    n += 1;
  }
  return n ? max / n : 1;
}

/** 통과한 후보 중 하나 고르기: 넓이가 가장 큰 것, 넓이가 비슷하면 더 복잡한 것 */
export function pickBest(passed: Measured[]): Measured | null {
  if (passed.length === 0) return null;
  const area = (m: Measured) => m.width * m.height;
  const top = Math.max(...passed.map(area));
  return passed.filter((m) => area(m) >= top * PICK_RULES.sameAreaRatio).sort((a, b) => b.entropy - a.entropy)[0];
}

// ───────────────────────── 이 홈페이지가 그 단지의 홈페이지가 맞는지 ─────────────────────────

/**
 * 홈페이지 제목에 단지명의 앞 낱말이 들어 있는지.
 * LH·SH처럼 여러 단지가 함께 쓰는 공용 사이트는 엉뚱한 사진이 걸리므로 건너뜁니다.
 */
export function siteMatchesName(complexName: string, siteTitle: string): boolean {
  const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const title = squash(siteTitle);
  const words = complexName
    .replace(/\([^)]*\)/g, " ") // 괄호 안(블록 이름, 본청약 등)은 빼고
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w))
    .slice(0, 2);
  return words.some((w) => title.includes(squash(w)));
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
