/**
 * "비슷한 과거 사례" 기준과 계산 (화면·서버 공용, 파일 읽기 없음)
 *
 * 원하는 단지와 비슷한 과거 사례 = 아래 SIMILAR_RULES를 모두 만족하는 과거 공고의 주택형
 *   1) 같은 지역 (서울은 같은 구, 그 밖은 같은 시·군) — 사례가 모자라면 같은 시·도로 넓힘
 *   2) 같은 면적대 (전용 60㎡ 이하 / 60~85㎡ / 85㎡ 초과)
 *   3) 최근 N년 안에 공고
 *   4) 내 거주지 기준 해당지역·기타지역 구분에 맞는 당첨가점
 * 판정 자체는 lib/judge.ts를 그대로 씁니다. 여기서는 판정에 넣을 최저·평균을 만듭니다.
 */

export const SIMILAR_RULES = {
  yearsBack: 2, // 최근 몇 년 공고까지 볼지
  minCases: 3, // 사례가 이보다 적으면 지역을 넓히고, 그래도 적으면 판정하지 않음
  bands: [
    { id: "s", label: "전용 60㎡ 이하", upTo: 60 },
    { id: "m", label: "전용 60~85㎡", upTo: 85 },
    { id: "l", label: "전용 85㎡ 초과", upTo: Infinity },
  ],
} as const;

export type BandId = (typeof SIMILAR_RULES.bands)[number]["id"];
export type Reside = "해당지역" | "기타경기" | "기타지역";
export type Level = "unit" | "sido";

/** 과거 공고의 주택형 × 거주구분 한 줄 (청약홈 당첨가점 + 분양정보를 이어 붙인 것) */
export type PastRow = {
  no: string; // 주택관리번호
  name: string;
  sido: string; // 서울, 경기 …
  unit: string; // 강남구, 수원시 …
  noticeDate: string; // 모집공고일
  url: string | null; // 청약홈 공고 링크
  houseTy: string; // 084.8860A
  band: BandId;
  reside: string; // 해당지역, 기타경기, 기타지역 (청약홈 표기 그대로)
  min: number | null;
  avg: number | null;
  max: number | null;
};

/** 판정에 쓰인 사례 한 건 (주택형 하나) */
export type PickedCase = Omit<PastRow, "reside"> & { reside: string };

export type Target = { sido: string; unit: string; band: BandId; excludeNo?: string };
export type Home = { sido: string; unit: string };

export type SimilarResult = {
  level: Level | null; // 어느 범위에서 사례를 찾았는지 (null = 부족)
  cases: PickedCase[];
  stats: { min: number; avg: number; max: number } | null; // judge()에 넣을 값
  complexCount: number;
};

// ───────────────────────── 작은 도우미 ─────────────────────────

/** "084.8860A" → 84.886 */
export function areaOf(houseTy: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(houseTy);
  return m ? Number(m[1]) : null;
}

export function bandOf(area: number): BandId {
  return SIMILAR_RULES.bands.find((b) => area <= b.upTo)!.id;
}

export function bandLabel(id: BandId): string {
  return SIMILAR_RULES.bands.find((b) => b.id === id)!.label;
}

/** "084.8860A" → "84A" (화면 표시용) */
export function shortType(houseTy: string): string {
  const m = /^\s*0*(\d+)(?:\.\d+)?\s*([A-Za-z가-힣]*)/.exec(houseTy);
  return m ? `${m[1]}${m[2]}` : houseTy.trim();
}

/** 공급 주소에서 시·군·구 한 단계 ("경기도 광주시 탄벌동…" → "광주시") */
export function unitFromAddress(address: string): string {
  return address.trim().split(/\s+/)[1] ?? "";
}

/** "서울특별시" → "서울", "경기도" → "경기" (입력 형태를 맞추기 위함) */
export function shortSido(s: string): string {
  const t = s.trim();
  const map: Record<string, string> = {
    서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 인천광역시: "인천", 광주광역시: "광주",
    대전광역시: "대전", 울산광역시: "울산", 세종특별자치시: "세종", 경기도: "경기", 강원도: "강원",
    강원특별자치도: "강원", 충청북도: "충북", 충청남도: "충남", 전라북도: "전북", 전북특별자치도: "전북",
    전라남도: "전남", 경상북도: "경북", 경상남도: "경남", 제주특별자치도: "제주",
  };
  return map[t] ?? t;
}

export const SIDO_LIST = ["서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산", "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];

/**
 * 그 단지에서 내가 어느 거주 구분인지 (간단한 기준, 정확한 기준은 공고문)
 * - 같은 시·도의 같은 시·군(서울은 서울 전체) → 해당지역
 * - 경기 단지인데 나는 다른 경기 시·군 → 기타경기 (그 단지에 기타경기 구분이 없으면 기타지역)
 * - 그 밖 → 기타지역
 */
export function resideFor(home: Home, sido: string, unit: string): Reside {
  if (home.sido !== sido) return "기타지역";
  if (sido === "서울") return "해당지역";
  if (norm(home.unit) === norm(unit)) return "해당지역";
  return sido === "경기" ? "기타경기" : "기타지역";
}

const norm = (s: string) => s.replace(/\s+/g, "");

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const round1 = (n: number) => Math.round(n * 10) / 10;

// ───────────────────────── 비슷한 사례 고르기 ─────────────────────────

/**
 * rows: 과거 당첨가점 전체, target: 원하는 단지, home: 내 거주지, resideOverride: 사용자가 직접 고른 거주 구분
 * 같은 지역 → 모자라면 같은 시·도 순서로 찾습니다.
 */
export function findSimilar(
  rows: PastRow[],
  target: Target,
  home: Home,
  resideOverride: Reside | null,
  today: string,
): SimilarResult {
  const since = shiftYears(today, -SIMILAR_RULES.yearsBack);
  const pool = rows.filter(
    (r) => r.sido === target.sido && r.band === target.band && r.noticeDate >= since && r.no !== target.excludeNo,
  );

  for (const level of ["unit", "sido"] as Level[]) {
    const inArea = level === "unit" ? pool.filter((r) => norm(r.unit) === norm(target.unit)) : pool;
    const cases = pickCases(inArea, home, resideOverride, target);
    if (cases.length >= SIMILAR_RULES.minCases) return summarize(cases, level);
    if (level === "sido") return { ...summarize(cases, null), stats: null };
  }
  return { level: null, cases: [], stats: null, complexCount: 0 };
}

/** 같은 공고·주택형끼리 묶기 (거주 구분별로 줄이 따로 오기 때문) */
export function groupByType(rows: PastRow[]): PastRow[][] {
  const groups = new Map<string, PastRow[]>();
  for (const r of rows) {
    const k = `${r.no}|${r.houseTy}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()];
}

/**
 * 한 공고·주택형 묶음에서 나에게 해당하는 거주 구분의 줄 고르기
 * want를 주지 않으면 거주지로 판단하고, 거주지가 없으면 해당지역 값을 씁니다.
 */
export function pickRow(group: PastRow[], home: Home | null, want?: Reside): PastRow | null {
  const first = group[0];
  const w = want ?? (home && home.sido ? resideFor(home, first.sido, first.unit) : "해당지역");
  const order: string[] = w === "기타경기" ? ["기타경기", "기타지역"] : [w];
  return order.map((x) => group.find((r) => r.reside === x)).find(Boolean) ?? null;
}

/** 같은 공고·주택형마다, 나에게 해당하는 거주 구분의 당첨가점 한 줄만 고르기 */
function pickCases(rows: PastRow[], home: Home, override: Reside | null, target: Target): PickedCase[] {
  const picked: PickedCase[] = [];
  for (const g of groupByType(rows)) {
    // 직접 고른 구분은 '원하는 단지와 같은 지역' 사례에만 그대로 적용하고, 다른 시·군 사례는 거주지 기준으로 다시 계산
    const sameUnit = norm(g[0].unit) === norm(target.unit);
    const row = pickRow(g, home, override && sameUnit ? override : undefined);
    if (row && row.avg !== null && row.min !== null) picked.push(row);
  }
  return picked.sort((a, b) => b.noticeDate.localeCompare(a.noticeDate));
}

function summarize(cases: PickedCase[], level: Level | null): SimilarResult {
  if (cases.length === 0) return { level, cases, stats: null, complexCount: 0 };
  const mins = cases.map((c) => c.min!);
  const avgs = cases.map((c) => c.avg!);
  const maxs = cases.map((c) => c.max ?? c.avg!);
  return {
    level,
    cases,
    complexCount: new Set(cases.map((c) => c.no)).size,
    // 최저·평균 모두 사례별 값의 중앙값 (사례마다 최저 ≤ 평균이라 중앙값끼리도 순서가 뒤집히지 않음).
    // 한두 단지의 극단적인 값에 덜 흔들리도록 산술평균 대신 중앙값을 씁니다. 최고는 가장 높은 값.
    stats: { min: round1(median(mins)), avg: round1(median(avgs)), max: Math.max(...maxs) },
  };
}

function shiftYears(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y + years}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
