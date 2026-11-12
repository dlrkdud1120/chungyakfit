/**
 * 부적격 위험 점검 규칙 (화면 공용, 파일 읽기·저장 없음)
 *
 * 당첨이 취소되는 흔한 실수를 질문으로 점검합니다. 입력값은 화면 안에서만 계산하고 어디에도 저장하지 않습니다.
 * 점수 계산(lib/score.ts)은 바꾸지 않고, 무주택 기산 나이만 같은 값을 읽어 씁니다.
 * 결과는 "확인됨 / 다시 확인 필요" 두 단계입니다.
 */

import { RULES } from "./score";
import type { HouseHistory } from "./score";

export type CheckStatus = "ok" | "recheck";

export type CheckResult = {
  id: "homeless" | "household" | "reside" | "dependents";
  title: string;
  status: CheckStatus;
  summary: string; // 한 줄 결과 (확인됨이어도 보여줌)
  reason?: string; // 다시 확인이 필요한 이유
  how?: string; // 청약홈에서 확인하는 방법
};

export type Answer = "" | "yes" | "no" | "unknown";

// ───────────────────────── 공통 안내 문구 ─────────────────────────

export const TOP_NOTICE = "부적격 당첨은 취소되고 일정 기간 청약이 제한될 수 있어요.";
export const BOTTOM_NOTICE = "최종 자격은 입주자모집공고와 청약홈에서 확인하세요.";

/** 청약홈에서 확인하는 곳 (메뉴 이름은 청약홈 화면 기준) */
const HOW = {
  houseOwn: "청약홈 → 청약자격확인 → 주택소유확인에서 본인·세대원의 주택 소유 이력과 처분일을 조회할 수 있어요.",
  household: "청약홈 → 청약자격확인 → 세대구성원 등록·조회로 세대원을 맞춘 뒤, 주택소유확인으로 주택·분양권 소유를 함께 조회하세요.",
  reside: "입주자모집공고문의 '신청자격' 중 거주지역·거주기간 항목과, 청약홈 공고 상세의 접수 일정(해당지역/기타지역)을 확인하세요.",
  dependents: "청약 신청 화면에서 부양가족 수를 넣을 때 주민등록등본 기준으로 다시 세어 보세요. 배우자와 세대가 나뉘어 있으면 배우자 등본의 세대원도 확인하세요.",
};

// ───────────────────────── 1. 무주택기간 ─────────────────────────

export type HomelessInput = {
  birthDate: string;
  married: boolean;
  marriageDate: string;
  houseHistory: HouseHistory;
  soldDate: string;
  myStart: string; // 사용자가 생각한 기산일 (비우면 "")
};

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function addYears(s: string, years: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y + years, m - 1, d));
  if (t.getUTCMonth() !== m - 1) t.setUTCDate(0); // 2월 29일생
  return t.toISOString().slice(0, 10);
}

export const dot = (s: string) => s.replaceAll("-", ".");

function monthsBetween(a: string, b: string): number {
  const [y1, m1] = a.split("-").map(Number);
  const [y2, m2] = b.split("-").map(Number);
  return Math.abs((y2 - y1) * 12 + (m2 - m1));
}

/** 앱이 계산하는 무주택 기산일 (lib/score.ts의 무주택기간 계산과 같은 순서) */
export function homelessStart(i: Omit<HomelessInput, "myStart">): { start: string; basis: string } | null {
  if (!isDate(i.birthDate)) return null;
  const age30 = addYears(i.birthDate, RULES.homeless.startAge);
  let start = age30;
  let basis = `만 ${RULES.homeless.startAge}세가 되는 날`;
  if (i.married && isDate(i.marriageDate) && i.marriageDate < age30) {
    start = i.marriageDate;
    basis = `만 ${RULES.homeless.startAge}세 전 혼인신고일`;
  }
  if (i.houseHistory === "sold" && isDate(i.soldDate) && i.soldDate > start) {
    start = i.soldDate;
    basis = "마지막 주택 처분일";
  }
  return { start, basis };
}

export function checkHomeless(i: HomelessInput): CheckResult {
  const base = { id: "homeless" as const, title: "무주택기간 기산일", how: HOW.houseOwn };
  if (i.houseHistory === "owning") {
    return {
      ...base,
      status: "recheck",
      summary: "지금 주택을 가지고 있어요",
      reason:
        "주택을 가진 채 가점제로 당첨되면 부적격이 될 수 있어요. 소형·저가주택처럼 무주택으로 보는 예외가 있으니 공고문의 주택 소유 판정 기준을 확인하세요.",
    };
  }
  if (i.houseHistory === "sold" && !isDate(i.soldDate)) {
    return { ...base, status: "recheck", summary: "처분일이 비어 있어요", reason: "주택을 처분했다면 처분일(등기일)부터 다시 세요. 처분일을 넣어 주세요." };
  }
  const app = homelessStart(i);
  if (!app) return { ...base, status: "recheck", summary: "생년월일이 필요해요", reason: "생년월일을 넣어야 기산일을 계산할 수 있어요." };

  const appText = `앱 계산 ${dot(app.start)} (${app.basis})`;
  if (!isDate(i.myStart)) {
    return {
      ...base,
      status: "recheck",
      summary: appText,
      reason: "내가 알고 있던 기산일을 넣어 앱 계산과 같은지 비교해 보세요.",
    };
  }
  if (i.myStart !== app.start) {
    const gap = monthsBetween(i.myStart, app.start);
    return {
      ...base,
      status: "recheck",
      summary: `${appText} · 내가 생각한 날 ${dot(i.myStart)}`,
      reason: `두 날짜가 달라요${gap > 0 ? ` (약 ${gap}개월)` : ""}. 만 ${RULES.homeless.startAge}세 전에 혼인신고를 했는지, 주택을 판 날이 언제인지 다시 보세요. 기산일이 틀리면 무주택기간 점수가 달라져 부적격이 될 수 있어요.`,
    };
  }
  return { ...base, status: "ok", summary: `${appText}과 내가 생각한 날이 같아요` };
}

// ───────────────────────── 2. 세대원 주택 소유 ─────────────────────────

export type HouseholdInput = { married: boolean; spouse: Answer; family: Answer };

export function checkHousehold(i: HouseholdInput): CheckResult {
  const base = { id: "household" as const, title: "세대원 주택·분양권 소유", how: HOW.household };
  const reasons: string[] = [];
  if (i.married && i.spouse !== "no") {
    reasons.push(
      i.spouse === "yes"
        ? "배우자가 주택·분양권을 가지고 있으면 세대가 따로여도 유주택으로 봐요."
        : "배우자의 주택·분양권 소유 여부를 확인해 주세요. 세대가 따로여도 포함돼요.",
    );
  }
  if (i.family !== "no") {
    reasons.push(
      i.family === "yes"
        ? "같은 세대 직계존비속이 주택·분양권을 가지고 있으면 세대 전체가 유주택이 될 수 있어요. 만 60세 이상 직계존속의 주택은 민영주택 일반공급에서 무주택으로 보는 예외가 있지만, 그 부모는 부양가족에서 빠져요."
        : "같은 세대 부모·자녀 등 직계존비속의 주택·분양권 소유 여부를 확인해 주세요.",
    );
  }
  if (reasons.length) {
    return { ...base, status: "recheck", summary: "주택·분양권을 가진 세대원이 있거나 확인 전이에요", reason: reasons.join(" ") };
  }
  return { ...base, status: "ok", summary: i.married ? "배우자와 세대원 모두 없음" : "세대원 모두 없음" };
}

// ───────────────────────── 3. 거주지역 선택 ─────────────────────────

/** 시·도 전체가 하나의 해당지역인 곳 (특별시·광역시·특별자치시) */
const CITY_SIDO = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종"];

export type ResideInput = {
  home: { sido: string; unit: string };
  notice: { sido: string; unit: string; name: string } | null;
  flags: RegulationFlags | null; // 공고의 규제 조건 (API 값, 없으면 null)
  meetsPeriod: Answer; // 공고문의 거주기간 요건을 채웠는지
};

const norm = (s: string) => s.replace(/\s+/g, "");
/** "해당지역으로", "기타경기로" */
const ro = (w: string) => (w.endsWith("역") ? `${w}으로` : `${w}로`);

/** 신청해야 할 거주 구분 */
export function applyArea(home: ResideInput["home"], notice: NonNullable<ResideInput["notice"]>, flags: RegulationFlags | null) {
  if (home.sido !== notice.sido) return "기타지역";
  if (CITY_SIDO.includes(notice.sido)) return "해당지역";
  if (norm(home.unit) && norm(home.unit) === norm(notice.unit)) return "해당지역";
  // 경기도 대규모 택지개발지구만 같은 도(경기) 거주자를 따로 뽑음
  return notice.sido === "경기" && flags?.["대규모택지개발지구"] === true ? "기타경기" : "기타지역";
}

/** 거주기간 요건이 붙을 수 있는 공고인지 (규제지역·대규모택지) */
export function mayNeedPeriod(flags: RegulationFlags | null): string[] {
  if (!flags) return [];
  return (["투기과열지구", "조정대상지역", "대규모택지개발지구"] as const).filter((k) => flags[k] === true);
}

export function checkReside(i: ResideInput): CheckResult {
  const base = { id: "reside" as const, title: "거주지역 선택", how: HOW.reside };
  if (!i.home.sido) return { ...base, status: "recheck", summary: "내 거주지가 비어 있어요", reason: "거주지 시·도와 시·군·구를 골라 주세요." };
  if (!i.notice) {
    return { ...base, status: "recheck", summary: "공고를 고르지 않았어요", reason: "공고를 고르면 해당지역과 기타지역 중 무엇으로 신청할지 알려 드려요." };
  }
  const area = applyArea(i.home, i.notice, i.flags);
  const where = `${i.notice.sido} ${i.notice.unit}`.trim();
  const summary = `${where} 공고 → ${ro(area)} 신청 (입주자모집공고일에 주민등록상 거주 기준)`;
  if (area === "기타지역") return { ...base, status: "ok", summary };

  const need = mayNeedPeriod(i.flags);
  const needText = need.length
    ? `이 공고는 ${need.join("·")}라 ${area} 우선공급에 거주기간 요건이 붙을 수 있어요.`
    : "공고에 따라 해당지역 우선공급에 거주기간 요건이 붙기도 해요.";
  if (i.meetsPeriod === "yes") return { ...base, status: "ok", summary: `${summary} · 거주기간 요건 충족` };
  return {
    ...base,
    status: "recheck",
    summary,
    reason: `${needText} 기간을 못 채웠다면 ${area}가 아니라 ${ro(area === "해당지역" && i.notice.sido === "경기" && i.flags?.["대규모택지개발지구"] ? "기타경기" : "기타지역")} 신청해야 해요.`,
  };
}

// ───────────────────────── 4. 부양가족에 본인 포함 ─────────────────────────

export type DependentsInput = { count: number | null; selfExcluded: boolean };

export function checkDependents(i: DependentsInput): CheckResult {
  const base = { id: "dependents" as const, title: "부양가족 수에 본인 제외", how: HOW.dependents };
  const countText = i.count === null ? "" : `부양가족 ${i.count >= 6 ? "6명 이상" : `${i.count}명`} · `;
  if (i.selfExcluded) return { ...base, status: "ok", summary: `${countText}본인은 빼고 셌어요` };
  return {
    ...base,
    status: "recheck",
    summary: `${countText}본인 제외 여부 확인 전`,
    reason: "부양가족 수에는 본인을 넣지 않아요. 본인을 넣으면 5점이 높게 잡혀 부적격이 될 수 있어요.",
  };
}

// ───────────────────────── 공고 규제 조건 (분양정보 API) ─────────────────────────

export type RegulationName =
  | "투기과열지구"
  | "조정대상지역"
  | "분양가상한제"
  | "정비사업"
  | "공공주택지구"
  | "대규모택지개발지구"
  | "수도권내민영공공주택지구";

export type RegulationFlags = Partial<Record<RegulationName, boolean>>;

/**
 * 분양정보(getAPTLttotPblancDetail) 응답의 규제 항목과 쉬운 설명
 * code는 공공데이터포털 활용가이드의 항목 이름입니다. 응답에 그 필드가 없으면 화면에 표시하지 않습니다.
 * (실제 응답 필드는 check-detail.mjs로 확인)
 */
export const REGULATIONS: { code: string; name: RegulationName; plain: string }[] = [
  {
    code: "SPECLT_RDN_EARTH_AT",
    name: "투기과열지구",
    plain: "1순위는 세대주만 되고, 최근 5년 안에 세대원 누구라도 당첨된 적이 있으면 1순위가 안 돼요. 당첨되면 재당첨 제한이 붙어요.",
  },
  {
    code: "MDAT_TRGET_AREA_SECD",
    name: "조정대상지역",
    plain: "1순위는 세대주만 되고, 최근 5년 안에 세대원 당첨 이력이 있으면 1순위가 안 돼요. 당첨되면 재당첨 제한이 붙어요.",
  },
  {
    code: "PARCPRC_ULS_AT",
    name: "분양가상한제",
    plain: "분양가가 정해진 한도 안에서 나오는 대신, 전매제한이나 실거주 의무가 붙을 수 있고 재당첨 제한이 길어요.",
  },
  { code: "IMPRMN_BSNS_AT", name: "정비사업", plain: "재개발·재건축 단지의 일반분양 물량이에요." },
  { code: "PUBLIC_HOUSE_EARTH_AT", name: "공공주택지구", plain: "공공택지에 짓는 단지예요. 전매제한·거주의무가 더 길 수 있어요." },
  {
    code: "LRSCL_BLDLND_AT",
    name: "대규모택지개발지구",
    plain: "대규모 택지라 해당지역, 같은 도(경기 등), 기타지역 순으로 나눠 공급해요.",
  },
  {
    code: "NPLN_PRVOPR_PUBLIC_HOUSE_AT",
    name: "수도권내민영공공주택지구",
    plain: "수도권 공공택지에 짓는 민영주택이에요. 거주의무 기간이 있을 수 있어요.",
  },
];

/** API 원본 값("Y"/"N") → 규제 조건. 응답에 없는 항목은 빠집니다. */
export function readRegulations(raw: Record<string, string | null | undefined>): RegulationFlags | null {
  const flags: RegulationFlags = {};
  for (const r of REGULATIONS) {
    const v = raw[r.code]?.trim().toUpperCase();
    if (v === "Y") flags[r.name] = true;
    else if (v === "N") flags[r.name] = false;
  }
  return Object.keys(flags).length ? flags : null;
}
