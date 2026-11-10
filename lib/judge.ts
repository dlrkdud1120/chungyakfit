/**
 * 당첨 가능성 판정 규칙
 *
 * 판정 기준을 바꾸고 싶으면 이 파일의 THRESHOLDS와 judge()만 고치면 됩니다.
 *   안정: 내 점수 ≥ 과거 평균
 *   도전: 과거 최저 ≤ 내 점수 < 과거 평균
 *   어려움: 내 점수 < 과거 최저
 */

import type { ScoreStats } from "./complexes";

export type Verdict = "안정" | "도전" | "어려움";

/** 판정에 쓰는 기준값 이름. 예: 안정 기준을 평균 대신 최고로 바꾸려면 stable을 "max"로 */
export const THRESHOLDS = {
  stable: "avg", // 이 값 이상이면 안정
  challenge: "min", // 이 값 이상이면 도전
} as const satisfies Record<string, keyof ScoreStats>;

export const VERDICTS: Verdict[] = ["안정", "도전", "어려움"];

/** 정렬할 때 쓰는 순서 (안정이 위) */
export const VERDICT_ORDER: Record<Verdict, number> = { 안정: 0, 도전: 1, 어려움: 2 };

export type Judgement = {
  verdict: Verdict;
  reason: string; // 한 줄 근거
};

/** score가 null(가점제 물량 없음)이면 판정하지 않고 null을 돌려줍니다 */
export function judge(myScore: number, stats: ScoreStats | null): Judgement | null {
  if (!stats) return null;
  const stableLine = stats[THRESHOLDS.stable];
  const challengeLine = stats[THRESHOLDS.challenge];

  if (myScore >= stableLine) {
    const reason =
      myScore === stableLine
        ? `평균 ${stableLine}점과 같음`
        : `평균 ${stableLine}점보다 ${diff(myScore - stableLine)} 높음`;
    return { verdict: "안정", reason };
  }
  if (myScore >= challengeLine) {
    return { verdict: "도전", reason: `최저 ${challengeLine}점 이상, 평균까지 ${diff(stableLine - myScore)} 부족` };
  }
  return { verdict: "어려움", reason: `최저 ${challengeLine}점까지 ${diff(challengeLine - myScore)} 부족` };
}

function diff(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}점`;
}
