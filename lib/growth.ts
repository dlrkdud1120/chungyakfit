/**
 * 성장 단계 (마이페이지 "내 점수 기록"에 보여주는 이름)
 * 총점 구간으로만 나눈 참고용 이름이고, 판정(lib/judge.ts)과는 관계없습니다.
 * 구간을 바꾸려면 아래 표의 from 값만 고치면 됩니다.
 */

export const GROWTH_STAGES = [
  { from: 0, name: "씨앗", note: "가점을 쌓기 시작하는 단계" },
  { from: 20, name: "새싹", note: "기간 점수가 붙기 시작한 단계" },
  { from: 40, name: "줄기", note: "추첨제와 가점제를 함께 볼 단계" },
  { from: 55, name: "꽃", note: "가점제 도전이 늘어나는 단계" },
  { from: 70, name: "열매", note: "가점이 높은 편인 단계" },
] as const;

export function growthStage(total: number) {
  const i = GROWTH_STAGES.findLastIndex((s) => total >= s.from);
  const stage = GROWTH_STAGES[Math.max(i, 0)];
  const next = GROWTH_STAGES[i + 1] ?? null;
  return { step: Math.max(i, 0) + 1, of: GROWTH_STAGES.length, ...stage, next: next ? { name: next.name, need: next.from - total } : null };
}
