/**
 * 입지 점수 기준표 (100점 만점)
 *
 * 화면(/location)의 기준표는 아래 CRITERIA를 그대로 그려서 보여줍니다.
 * 점수 구간을 바꾸면 계산과 공개된 기준표가 함께 바뀝니다.
 *
 * 구간(band) 읽는 법
 * - 지하철: 거리(m)가 upTo 이하인 첫 구간의 점수
 * - 개수 항목: 개수가 atLeast 이상인 구간 중 가장 높은 점수
 */

export type DistanceBand = { upTo: number; score: number; label: string };
export type CountBand = { atLeast: number; score: number; label: string };

export const CRITERIA = {
  subway: {
    title: "가장 가까운 지하철역까지 거리",
    max: 40,
    bands: [
      { upTo: 300, score: 40, label: "300m 이내" },
      { upTo: 500, score: 32, label: "300m 초과 ~ 500m" },
      { upTo: 800, score: 24, label: "500m 초과 ~ 800m" },
      { upTo: 1000, score: 16, label: "800m 초과 ~ 1km" },
      { upTo: 1500, score: 8, label: "1km 초과 ~ 1.5km" },
      { upTo: Infinity, score: 0, label: "1.5km 초과" },
    ] as DistanceBand[],
  },
  bus: {
    title: "반경 500m 버스정류장 수",
    max: 20,
    bands: [
      { atLeast: 0, score: 0, label: "0곳" },
      { atLeast: 1, score: 8, label: "1~2곳" },
      { atLeast: 3, score: 14, label: "3~4곳" },
      { atLeast: 5, score: 20, label: "5곳 이상" },
    ] as CountBand[],
  },
  /** 생활편의시설은 종류별로 따로 점수를 매겨 더합니다 (한 종류만 많은 곳이 과대평가되지 않게) */
  amenities: {
    title: "반경 1km 생활편의시설 수",
    max: 40,
    kinds: {
      mart: {
        title: "마트",
        max: 15,
        bands: [
          { atLeast: 0, score: 0, label: "0곳" },
          { atLeast: 1, score: 8, label: "1곳" },
          { atLeast: 2, score: 15, label: "2곳 이상" },
        ] as CountBand[],
      },
      hospital: {
        title: "병원",
        max: 15,
        bands: [
          { atLeast: 0, score: 0, label: "0곳" },
          { atLeast: 1, score: 6, label: "1~4곳" },
          { atLeast: 5, score: 11, label: "5~9곳" },
          { atLeast: 10, score: 15, label: "10곳 이상" },
        ] as CountBand[],
      },
      school: {
        title: "학교",
        max: 10,
        bands: [
          { atLeast: 0, score: 0, label: "0곳" },
          { atLeast: 1, score: 5, label: "1곳" },
          { atLeast: 2, score: 10, label: "2곳 이상" },
        ] as CountBand[],
      },
    },
  },
} as const;

export const LOCATION_MAX = CRITERIA.subway.max + CRITERIA.bus.max + CRITERIA.amenities.max; // 100

// ───────────────────────── 입력과 결과 ─────────────────────────

export type LocationInput = {
  stationName: string | null;
  stationDistance: number | null; // m
  busStops: number | null;
  marts: number | null;
  hospitals: number | null;
  schools: number | null;
};

export type LocationItem = {
  title: string;
  score: number | null; // 값이 비어 있으면 null
  max: number;
  reason: string;
};

export type LocationScore = {
  total: number | null; // 한 항목이라도 비어 있으면 null (부분 합계로 오해하지 않게)
  partial: number; // 값이 있는 항목만 더한 점수
  max: number;
  items: LocationItem[];
};

// ───────────────────────── 계산 ─────────────────────────

export function distanceBand(m: number): DistanceBand {
  return CRITERIA.subway.bands.find((b) => m <= b.upTo)!;
}

export function countBand(n: number, bands: readonly CountBand[]): CountBand {
  return [...bands].reverse().find((b) => n >= b.atLeast)!;
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)}km` : `${m}m`);

export function scoreLocation(v: LocationInput): LocationScore {
  const items: LocationItem[] = [];

  // 1) 지하철
  const S = CRITERIA.subway;
  if (v.stationDistance === null) {
    items.push({ title: S.title, score: null, max: S.max, reason: "데이터 없음" });
  } else {
    const b = distanceBand(v.stationDistance);
    items.push({
      title: S.title,
      score: b.score,
      max: S.max,
      reason: `${v.stationName ? `${v.stationName}까지 ` : ""}${km(v.stationDistance)} → '${b.label}' 구간 ${b.score}점`,
    });
  }

  // 2) 버스
  const B = CRITERIA.bus;
  if (v.busStops === null) {
    items.push({ title: B.title, score: null, max: B.max, reason: "데이터 없음" });
  } else {
    const b = countBand(v.busStops, B.bands);
    items.push({ title: B.title, score: b.score, max: B.max, reason: `${v.busStops}곳 → '${b.label}' 구간 ${b.score}점` });
  }

  // 3) 생활편의 (종류별 합)
  const A = CRITERIA.amenities;
  const parts: [keyof typeof A.kinds, number | null][] = [
    ["mart", v.marts],
    ["hospital", v.hospitals],
    ["school", v.schools],
  ];
  if (parts.some(([, n]) => n === null)) {
    const missing = parts.filter(([, n]) => n === null).map(([k]) => A.kinds[k].title);
    items.push({ title: A.title, score: null, max: A.max, reason: `데이터 없음 (${missing.join(", ")} 비어 있음)` });
  } else {
    let sum = 0;
    const text = parts.map(([k, n]) => {
      const kind = A.kinds[k];
      const b = countBand(n!, kind.bands);
      sum += b.score;
      return `${kind.title} ${n}곳 ${b.score}점`;
    });
    items.push({ title: A.title, score: sum, max: A.max, reason: `${text.join(" + ")} = ${sum}점` });
  }

  const partial = items.reduce((s, i) => s + (i.score ?? 0), 0);
  const complete = items.every((i) => i.score !== null);
  return { total: complete ? partial : null, partial, max: LOCATION_MAX, items };
}

// ───────────────────────── 단지 연결용 키 ─────────────────────────

/** 단지명·지역의 띄어쓰기 차이는 같은 단지로 봅니다 (단지 비교 ↔ 입지 점수 연결) */
export function locationKey(name: string, region: string): string {
  return `${name.replace(/\s+/g, "")}|${region.replace(/\s+/g, "")}`;
}

/** 입지 점수 페이지 안에서 단지로 바로 가는 링크용 id */
export function anchorId(key: string): string {
  let h = 5381;
  for (const ch of key) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `loc-${h.toString(36)}`;
}
