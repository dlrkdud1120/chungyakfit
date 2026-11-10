/**
 * 단지 데이터를 읽어오는 곳
 *
 * 지금은 data/complexes.json 파일을 그대로 읽습니다.
 * 6단계에서 청약홈 API로 바꿀 때도 화면 쪽은 손대지 않고, 이 파일의 getComplexes()만 바꾸면 됩니다.
 */

import raw from "@/data/complexes.json";

export type ScoreStats = { min: number; avg: number; max: number };

export type HouseType = {
  type: string; // 주택형 이름 (예: "84A")
  area: number; // 전용면적 ㎡
  supply: number; // 일반공급 세대수
  gajeomRatio: number; // 가점제 비율 (0~1)
  lotteryRatio: number; // 추첨제 비율 (0~1)
  score: ScoreStats | null; // 당첨 가점. 가점제 물량이 없으면 null
};

export type Complex = {
  id: string;
  name: string;
  region: { sido: string; sigungu: string };
  saleMonth: string; // 분양 시기 "YYYY-MM"
  isSample: boolean;
  types: HouseType[];
};

export type ComplexData = {
  meta: { isSample: boolean; source: string; updatedAt: string; note: string };
  complexes: Complex[];
};

export function getComplexes(): ComplexData {
  return raw as ComplexData;
}

/** 가점제·추첨제 세대수 (비율 × 공급세대, 가점제 쪽 반올림) */
export function splitSupply(t: HouseType): { gajeom: number; lottery: number } {
  const gajeom = Math.round(t.supply * t.gajeomRatio);
  return { gajeom, lottery: t.supply - gajeom };
}
