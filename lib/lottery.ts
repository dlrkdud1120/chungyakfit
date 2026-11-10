/**
 * 추첨제 물량 안내 규칙
 *
 * - 추첨 비율은 CSV에 공고별로 적은 가점제·추첨제 세대수로 계산합니다.
 *   (추첨제 세대수 ÷ (가점제 + 추첨제)). 둘 중 하나라도 비어 있으면 비율을 계산하지 않습니다.
 * - "어려움이 많다"의 기준과 추천 순서를 바꾸려면 이 파일만 고치면 됩니다.
 */

import type { Complex, HouseType } from "./complexes";
import type { Verdict } from "./judge";

export const LOTTERY_RULES = {
  /** 판정이 나온 주택형 중 '어려움' 비율이 이 값 이상이면 안내를 띄웁니다 (0.5 = 절반 이상) */
  manyHardShare: 0.5,
} as const;

/** 추첨 비율 (0~1). 세대수가 비어 있으면 null */
export function lotteryRatio(t: HouseType): number | null {
  const g = t.gajeomSupply;
  const l = t.lotterySupply;
  if (g === null || l === null || g + l === 0) return null;
  return l / (g + l);
}

export function percent(r: number): string {
  return `${Math.round(r * 100)}%`;
}

export type JudgedRow = { complex: Complex; type: HouseType; verdict: Verdict | null };

/** 어려움이 많은지 판단 */
export function hasManyHard(rows: JudgedRow[]): { hard: number; judged: number; many: boolean } {
  const judged = rows.filter((r) => r.verdict !== null).length;
  const hard = rows.filter((r) => r.verdict === "어려움").length;
  return { hard, judged, many: judged > 0 && hard / judged >= LOTTERY_RULES.manyHardShare };
}

export type TypeOption = { type: HouseType; verdict: Verdict | null; ratio: number | null };

export type LotteryPick = {
  complex: Complex;
  options: TypeOption[]; // 추첨 비율 높은 순
  best: TypeOption | null; // 추천 타입 (비율을 계산할 수 있는 타입이 없으면 null)
  hardTypes: string[]; // 이 단지에서 '어려움'인 타입
};

/**
 * '어려움' 타입이 하나라도 있는 단지마다, 같은 단지 안에서 추첨 비율이 가장 높은 타입을 고릅니다.
 * 비율이 같으면 추첨 세대수가 많은 타입을 먼저 둡니다.
 */
export function recommendLotteryTypes(rows: JudgedRow[]): LotteryPick[] {
  const byComplex = new Map<string, JudgedRow[]>();
  for (const r of rows) {
    const list = byComplex.get(r.complex.id) ?? [];
    list.push(r);
    byComplex.set(r.complex.id, list);
  }

  const picks: LotteryPick[] = [];
  for (const list of byComplex.values()) {
    const hardTypes = list.filter((r) => r.verdict === "어려움").map((r) => r.type.type);
    if (hardTypes.length === 0) continue;

    const options: TypeOption[] = list
      .map((r) => ({ type: r.type, verdict: r.verdict, ratio: lotteryRatio(r.type) }))
      .sort((a, b) => {
        if (a.ratio === null || b.ratio === null) return a.ratio === null ? (b.ratio === null ? 0 : 1) : -1;
        return b.ratio - a.ratio || (b.type.lotterySupply ?? 0) - (a.type.lotterySupply ?? 0);
      });
    const best = options[0]?.ratio !== null && options[0]?.ratio !== undefined ? options[0] : null;
    picks.push({ complex: list[0].complex, options, best, hardTypes });
  }

  // 추천 타입의 추첨 비율이 높은 단지부터
  return picks.sort((a, b) => (b.best?.ratio ?? -1) - (a.best?.ratio ?? -1));
}
