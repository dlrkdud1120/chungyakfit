/**
 * 청약 가점 계산 규칙 (84점 만점)
 *
 * 제도가 바뀌면 이 파일만 고치면 됩니다.
 * - 점수표(구간·상한)는 맨 위 RULES 상수에 모여 있습니다.
 * - 화면(components/Calculator.tsx)은 여기서 돌려준 점수와 근거 문장을 보여주기만 합니다.
 *
 * 날짜는 모두 "YYYY-MM-DD" 문자열로 주고받습니다.
 */

// ───────────────────────── 점수표 ─────────────────────────

export const RULES = {
  homeless: {
    max: 32,
    base: 2, // 1년 미만
    perYear: 2, // 1년마다 추가
    startAge: 30, // 만 30세부터 기산 (그 전에 혼인하면 혼인신고일부터)
  },
  dependents: {
    max: 35,
    base: 5, // 0명
    perPerson: 5, // 1명당 추가
    parentSameHouseholdYears: 3, // 직계존속: 3년 이상 같은 주민등록 세대
    adultChildAge: 30, // 만 30세 이상 미혼 자녀는
    adultChildSameHouseholdYears: 1, // 1년 이상 같은 세대여야 인정
  },
  account: {
    max: 17,
    under6Months: 1,
    under1Year: 2,
    base1Year: 3, // 1년 이상 2년 미만
    perYear: 1,
    spouseRatio: 0.5, // 배우자 기간 점수의 50%
    spouseMax: 3, // 배우자 합산 최대 3점
  },
} as const;

export const TOTAL_MAX =
  RULES.homeless.max + RULES.dependents.max + RULES.account.max; // 84

// ───────────────────────── 입력 형태 ─────────────────────────

export type HouseHistory = "never" | "sold" | "owning";

export type Child = {
  married: boolean; // 기혼이면 불인정
  over30: boolean; // 만 30세 이상인지
  sameHousehold1Year: boolean; // 만 30세 이상일 때만 확인
};

export type ParentRelation = "본인 부모" | "배우자 부모" | "조부모";

export type Parent = {
  relation: ParentRelation;
  sameHousehold3Years: boolean;
  ownsHouse: boolean; // 주택을 소유한 직계존속은 불인정
};

export type ScoreInput = {
  baseDate: string; // 계산 기준일 (보통 입주자모집공고일)
  birthDate: string;
  married: boolean;
  marriageDate: string; // 혼인신고일 (미혼이면 "")
  houseHistory: HouseHistory;
  soldDate: string; // 처분일 ("sold"일 때만)
  children: Child[];
  parents: Parent[];
  hasAccount: boolean;
  accountJoinDate: string;
  spouseHasAccount: boolean;
  spouseAccountJoinDate: string;
};

export type Line = { ok: boolean; text: string };

export type ItemResult = {
  score: number;
  max: number;
  lines: Line[]; // "왜 이 점수인지" 한 줄씩
};

export type ScoreResult = {
  homeless: ItemResult;
  dependents: ItemResult;
  account: ItemResult;
  total: number;
  errors: string[]; // 입력이 부족하거나 앞뒤가 안 맞을 때
};

// ───────────────────────── 날짜 도우미 ─────────────────────────

type YMD = { y: number; m: number; d: number };

function parse(s: string): YMD | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function toStr({ y, m, d }: YMD): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 만 N세가 되는 날 (2월 29일생은 평년에 3월 1일로 처리) */
function addYears(s: string, years: number): string {
  const p = parse(s)!;
  const y = p.y + years;
  if (p.m === 2 && p.d === 29) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return leap ? toStr({ y, m: 2, d: 29 }) : toStr({ y, m: 3, d: 1 });
  }
  return toStr({ y, m: p.m, d: p.d });
}

/** from부터 to까지 꽉 찬 개월 수 */
function fullMonths(from: string, to: string): number {
  const a = parse(from)!;
  const b = parse(to)!;
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1;
  return Math.max(0, months);
}

function periodText(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}개월`;
  return m === 0 ? `${y}년` : `${y}년 ${m}개월`;
}

function korDate(s: string): string {
  const p = parse(s)!;
  return `${p.y}.${String(p.m).padStart(2, "0")}.${String(p.d).padStart(2, "0")}`;
}

const isDate = (s: string) => parse(s) !== null;

// ───────────────────────── 1. 무주택기간 ─────────────────────────

export function calcHomeless(input: ScoreInput): ItemResult {
  const R = RULES.homeless;
  const lines: Line[] = [];
  const { baseDate, birthDate, married, marriageDate, houseHistory, soldDate } =
    input;

  if (houseHistory === "owning") {
    lines.push({ ok: false, text: "현재 주택을 소유하고 있어 무주택기간은 0점입니다." });
    return { score: 0, max: R.max, lines };
  }

  const age30 = addYears(birthDate, R.startAge);
  let start = age30;
  if (married && isDate(marriageDate) && marriageDate < age30) {
    start = marriageDate;
    lines.push({
      ok: true,
      text: `만 30세(${korDate(age30)}) 전에 혼인신고(${korDate(marriageDate)})를 해서 혼인신고일부터 셉니다.`,
    });
  } else {
    lines.push({
      ok: true,
      text: `만 30세가 되는 날(${korDate(age30)})부터 셉니다.`,
    });
  }

  if (houseHistory === "sold" && isDate(soldDate) && soldDate > start) {
    lines.push({
      ok: true,
      text: `주택 처분일(${korDate(soldDate)})이 더 늦어서 처분일부터 다시 셉니다.`,
    });
    start = soldDate;
  }

  if (start > baseDate) {
    lines.push({
      ok: false,
      text: `기준일(${korDate(baseDate)})에 아직 기산일이 오지 않았습니다. 만 30세 전 미혼이면 0점입니다.`,
    });
    return { score: 0, max: R.max, lines };
  }

  const months = fullMonths(start, baseDate);
  const years = Math.floor(months / 12);
  const score = Math.min(R.base + years * R.perYear, R.max);
  lines.push({
    ok: true,
    text:
      score === R.max
        ? `무주택기간 ${periodText(months)} → 15년 이상이라 만점 ${R.max}점`
        : `무주택기간 ${periodText(months)} → ${years === 0 ? "1년 미만 2점" : `2점 + ${years}년 × 2점`} = ${score}점`,
  });
  return { score, max: R.max, lines };
}

// ───────────────────────── 2. 부양가족 ─────────────────────────

export function calcDependents(input: ScoreInput): ItemResult {
  const R = RULES.dependents;
  const lines: Line[] = [];
  let count = 0;

  if (input.married) {
    count += 1;
    lines.push({ ok: true, text: "배우자 1명 인정 (세대가 분리돼 있어도 인정)" });
  }

  input.children.forEach((c, i) => {
    const name = `자녀 ${i + 1}`;
    if (c.married) {
      lines.push({ ok: false, text: `${name} 불인정 — 혼인한 자녀는 부양가족이 아닙니다.` });
    } else if (c.over30 && !c.sameHousehold1Year) {
      lines.push({
        ok: false,
        text: `${name} 불인정 — 만 ${R.adultChildAge}세 이상 미혼 자녀는 ${R.adultChildSameHouseholdYears}년 이상 같은 세대여야 합니다.`,
      });
    } else {
      count += 1;
      lines.push({ ok: true, text: `${name} 인정 (미혼 자녀)` });
    }
  });

  input.parents.forEach((p, i) => {
    const name = `직계존속 ${i + 1}(${p.relation})`;
    if (p.ownsHouse) {
      lines.push({ ok: false, text: `${name} 불인정 — 주택을 소유한 직계존속은 부양가족이 아닙니다.` });
    } else if (!p.sameHousehold3Years) {
      lines.push({
        ok: false,
        text: `${name} 불인정 — ${R.parentSameHouseholdYears}년 이상 같은 주민등록 세대여야 합니다.`,
      });
    } else {
      count += 1;
      lines.push({ ok: true, text: `${name} 인정 (${R.parentSameHouseholdYears}년 이상 같은 세대)` });
    }
  });

  const score = Math.min(R.base + count * R.perPerson, R.max);
  lines.push({
    ok: true,
    text:
      score === R.max
        ? `부양가족 ${count}명 → 6명 이상이라 만점 ${R.max}점`
        : `부양가족 ${count}명 (본인 제외) → 5점 + ${count}명 × 5점 = ${score}점`,
  });
  return { score, max: R.max, lines };
}

// ───────────────────────── 3. 청약통장 ─────────────────────────

/** 가입 개월 수 → 기간 점수 (본인·배우자 공통 표) */
export function accountPeriodScore(months: number): number {
  const R = RULES.account;
  if (months < 6) return R.under6Months;
  if (months < 12) return R.under1Year;
  const years = Math.floor(months / 12);
  return Math.min(R.base1Year + (years - 1) * R.perYear, R.max);
}

export function calcAccount(input: ScoreInput): ItemResult {
  const R = RULES.account;
  const lines: Line[] = [];
  let own = 0;

  if (input.hasAccount && isDate(input.accountJoinDate)) {
    const months = fullMonths(input.accountJoinDate, input.baseDate);
    own = accountPeriodScore(months);
    lines.push({ ok: true, text: `본인 가입기간 ${periodText(months)} → ${own}점` });
  } else {
    lines.push({ ok: false, text: "본인 청약통장이 없어 본인 기간 점수는 0점입니다." });
  }

  let spouse = 0;
  if (input.married && input.spouseHasAccount && isDate(input.spouseAccountJoinDate)) {
    const months = fullMonths(input.spouseAccountJoinDate, input.baseDate);
    const raw = accountPeriodScore(months);
    spouse = Math.min(raw * R.spouseRatio, R.spouseMax);
    lines.push({
      ok: true,
      text: `배우자 가입기간 ${periodText(months)} → ${raw}점의 50% = ${fmt(raw * R.spouseRatio)}점${raw * R.spouseRatio > R.spouseMax ? ` → 최대 ${R.spouseMax}점까지만 합산` : ""}`,
    });
  }

  const sum = own + spouse;
  const score = Math.min(sum, R.max);
  if (spouse > 0) {
    lines.push({
      ok: true,
      text:
        sum > R.max
          ? `${fmt(own)}점 + ${fmt(spouse)}점 = ${fmt(sum)}점이지만 상한 ${R.max}점 적용`
          : `${fmt(own)}점 + ${fmt(spouse)}점 = ${fmt(score)}점`,
    });
  }
  return { score, max: R.max, lines };
}

// ───────────────────────── 합계 ─────────────────────────

export function validate(input: ScoreInput): string[] {
  const e: string[] = [];
  if (!isDate(input.baseDate)) e.push("계산 기준일을 입력해 주세요.");
  if (!isDate(input.birthDate)) e.push("생년월일을 입력해 주세요.");
  if (input.married && !isDate(input.marriageDate))
    e.push("혼인신고일을 입력해 주세요.");
  if (input.houseHistory === "sold" && !isDate(input.soldDate))
    e.push("주택 처분일을 입력해 주세요.");
  if (input.hasAccount && !isDate(input.accountJoinDate))
    e.push("청약통장 가입일을 입력해 주세요.");
  if (input.married && input.spouseHasAccount && !isDate(input.spouseAccountJoinDate))
    e.push("배우자 청약통장 가입일을 입력해 주세요.");

  const dates: [string, string][] = [
    [input.birthDate, "생년월일"],
    [input.married ? input.marriageDate : "", "혼인신고일"],
    [input.houseHistory === "sold" ? input.soldDate : "", "주택 처분일"],
    [input.hasAccount ? input.accountJoinDate : "", "청약통장 가입일"],
  ];
  if (isDate(input.baseDate)) {
    for (const [d, label] of dates) {
      if (isDate(d) && d > input.baseDate)
        e.push(`${label}이 기준일보다 늦습니다.`);
    }
  }
  return e;
}

export function calcScore(input: ScoreInput): ScoreResult {
  const errors = validate(input);
  const empty = (max: number): ItemResult => ({ score: 0, max, lines: [] });
  if (errors.length > 0) {
    return {
      homeless: empty(RULES.homeless.max),
      dependents: empty(RULES.dependents.max),
      account: empty(RULES.account.max),
      total: 0,
      errors,
    };
  }
  const homeless = calcHomeless(input);
  const dependents = calcDependents(input);
  const account = calcAccount(input);
  return {
    homeless,
    dependents,
    account,
    total: homeless.score + dependents.score + account.score,
    errors,
  };
}

// ───────────────────────── 미래 점수 ─────────────────────────

/** 미래 예측에서 보여줄 시점 (년). 5년 뒤도 보고 싶으면 [1, 3, 5]로 */
export const FUTURE_YEARS = [1, 3] as const;

/** 예측의 전제. 화면에 그대로 보여줍니다 */
export const FUTURE_ASSUMPTIONS = [
  "부양가족 수는 지금과 같다고 가정합니다.",
  "무주택 상태와 청약통장(배우자 통장 포함)을 계속 유지한다고 가정합니다.",
  "가점 제도가 바뀌지 않는다고 가정합니다.",
];

export type FutureScore = {
  years: number;
  baseDate: string;
  homeless: number;
  dependents: number;
  account: number;
  total: number;
};

/**
 * 지금 입력값 그대로 기준일만 N년 뒤로 미뤄 다시 계산합니다.
 * 무주택기간·통장 가입기간은 날짜로 계산하므로 자연히 늘어나고,
 * 부양가족은 날짜와 상관없이 지금 체크한 그대로 셉니다.
 */
export function projectScores(input: ScoreInput, years: readonly number[] = FUTURE_YEARS): FutureScore[] {
  if (validate(input).length > 0) return [];
  return years.map((y) => {
    const baseDate = addYears(input.baseDate, y);
    const r = calcScore({ ...input, baseDate });
    return {
      years: y,
      baseDate,
      homeless: r.homeless.score,
      dependents: r.dependents.score,
      account: r.account.score,
      total: r.total,
    };
  });
}

/** 0.5점 단위가 생길 수 있어 소수점은 필요할 때만 표시 */
export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
