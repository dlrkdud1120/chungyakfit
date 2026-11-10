/**
 * 당첨 가능성 판정 규칙
 *
 * 판정 기준을 바꾸고 싶으면 이 파일만 고치면 됩니다.
 *   안정: 내 점수 ≥ 과거 평균
 *   도전: 과거 최저 ≤ 내 점수 < 과거 평균
 *   어려움: 내 점수 < 과거 최저
 * 기준값(최저·평균)이 하나라도 비어 있으면 "데이터 없음"으로 판정에서 뺍니다.
 */

export type Verdict = "안정" | "도전" | "어려움";

export type ScoreStats = { min: number | null; avg: number | null; max: number | null };

/** 판정에 쓰는 기준값. 예: 안정 기준을 평균 대신 최고로 바꾸려면 stable을 "max"로 */
export const THRESHOLDS = {
  stable: "avg", // 이 값 이상이면 안정
  challenge: "min", // 이 값 이상이면 도전
} as const satisfies Record<string, keyof ScoreStats>;

const LABEL: Record<keyof ScoreStats, string> = { min: "최저", avg: "평균", max: "최고" };

export const VERDICTS: Verdict[] = ["안정", "도전", "어려움"];

/** 정렬할 때 쓰는 순서 (안정이 위) */
export const VERDICT_ORDER: Record<Verdict, number> = { 안정: 0, 도전: 1, 어려움: 2 };

export type Judgement = { verdict: Verdict; reason: string };

/** 판정에 필요한 값이 없으면 null (= 데이터 없음) */
export function judge(myScore: number, stats: ScoreStats): Judgement | null {
  const stableLine = stats[THRESHOLDS.stable];
  const challengeLine = stats[THRESHOLDS.challenge];
  if (stableLine === null || challengeLine === null) return null;

  const s = LABEL[THRESHOLDS.stable];
  const c = LABEL[THRESHOLDS.challenge];

  if (myScore >= stableLine) {
    return {
      verdict: "안정",
      reason:
        myScore === stableLine ? `${s} ${n(stableLine)}점과 같음` : `${s} ${n(stableLine)}점보다 ${n(myScore - stableLine)}점 높음`,
    };
  }
  if (myScore >= challengeLine) {
    return { verdict: "도전", reason: `${c} ${n(challengeLine)}점 이상, ${s}까지 ${n(stableLine - myScore)}점 부족` };
  }
  return { verdict: "어려움", reason: `${c} ${n(challengeLine)}점까지 ${n(challengeLine - myScore)}점 부족` };
}

function n(x: number): string {
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
}
