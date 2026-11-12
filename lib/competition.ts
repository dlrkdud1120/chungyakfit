/**
 * 청약 경쟁률 (화면·서버 공용, 파일 읽기 없음)
 *
 * 청약홈 "경쟁률 및 특별공급 신청현황" API(getAPTLttotPblancCmpet)의 실제 응답 필드
 *   SUBSCRPT_RANK_CODE  순위 (숫자 1, 2)
 *   RESIDE_SENM         거주 구분 (해당지역, 기타지역 …)
 *   SUPLY_HSHLDCO       공급세대수 (숫자)
 *   REQ_CNT             접수건수 (문자 "149")
 *   CMPET_RATE          경쟁률 (문자 "2.16" / 미달이면 "(△20)" = 20세대 부족 / 계산 안 한 칸은 "-")
 * 판정 로직(lib/judge.ts)과는 무관하게, 참고 정보로만 보여줍니다.
 */

export type CmpetRow = {
  rank: number | null;
  reside: string;
  supply: number | null;
  req: number | null;
  rate: number | null; // 숫자 경쟁률
  shortage: number | null; // 미달 세대수 (△n)
};

/** CMPET_RATE 문자 → 경쟁률 숫자 또는 미달 세대수 */
export function parseRate(raw: string | null): { rate: number | null; shortage: number | null } {
  const s = (raw ?? "").trim();
  const short = /△\s*(\d+)/.exec(s);
  if (short) return { rate: null, shortage: Number(short[1]) };
  const n = Number(s.replace(/,/g, ""));
  return { rate: s !== "" && s !== "-" && Number.isFinite(n) ? n : null, shortage: null };
}

const hasInfo = (r: CmpetRow) => r.rate !== null || r.shortage !== null;

/**
 * 한 주택형의 대표 경쟁률 고르기
 * 1순위 중에서 내 거주 구분 값 → 없으면 1순위 해당지역 → 그 밖에 값이 있는 줄
 * (해당지역에서 이미 마감되면 기타지역 경쟁률은 "-"로 오기 때문)
 */
export function pickCmpet(rows: CmpetRow[] | null | undefined, reside?: string | null): CmpetRow | null {
  if (!rows || rows.length === 0) return null;
  const rank1 = rows.filter((r) => r.rank === 1);
  const order = reside === "기타경기" ? ["기타경기", "기타지역"] : reside ? [reside] : [];
  for (const w of order) {
    const hit = rank1.find((r) => r.reside === w && hasInfo(r));
    if (hit) return hit;
  }
  return rank1.find((r) => r.reside === "해당지역" && hasInfo(r)) ?? rank1.find(hasInfo) ?? rows.find(hasInfo) ?? null;
}

export const isShort = (c: CmpetRow | null) => c !== null && c.shortage !== null;

/** "12.3 : 1" 또는 "미달 (△1)" */
export function rateText(c: CmpetRow): string {
  if (c.shortage !== null) return `미달 (△${c.shortage})`;
  return `${fmtRate(c.rate!)} : 1`;
}

/** "1순위 해당지역" */
export function rankText(c: CmpetRow): string {
  return `${c.rank ?? "?"}순위 ${c.reside}`.trim();
}

/** 표처럼 좁은 칸용: "12.3:1" / "미달" */
export function rateShort(c: CmpetRow | null): string {
  if (!c) return "–";
  return c.shortage !== null ? "미달" : `${fmtRate(c.rate!)}:1`;
}

function fmtRate(n: number): string {
  return n >= 100 ? String(Math.round(n)) : String(Math.round(n * 100) / 100);
}

export const NO_CMPET = "경쟁률 정보 없음";
