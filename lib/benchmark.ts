/**
 * 내 점수와 실제 당첨 가점 비교
 *
 * "관심 단지 평균 당첨 가점" = 단지 비교(complexes.csv)에 등록된 주택형들의 평균 당첨 가점을 다시 평균 낸 값.
 * 가점제 물량이 없거나 평균 가점이 비어 있는 주택형은 빼고 계산합니다.
 * 화면 어디서든 쓸 수 있도록 파일 읽기 없이 계산만 합니다.
 */

type TypeLike = { avg: number | null; gajeomSupply: number | null };

export type Benchmark = { avg: number; count: number };

export function averageCutoff(types: TypeLike[]): Benchmark | null {
  const values = types.filter((t) => t.gajeomSupply !== 0 && t.avg !== null).map((t) => t.avg as number);
  if (values.length === 0) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return { avg: Math.round(avg * 10) / 10, count: values.length };
}

/** "관심 단지 평균 당첨 가점(63.2점)보다 1.2점 높음" */
export function gapText(myScore: number, bench: Benchmark | null): string {
  if (!bench) return "비교할 단지 데이터가 아직 없습니다.";
  const diff = Math.round((myScore - bench.avg) * 10) / 10;
  const base = `관심 단지 평균 당첨 가점(${fmt(bench.avg)}점)`;
  if (diff === 0) return `${base}과 같음`;
  return `${base}보다 ${fmt(Math.abs(diff))}점 ${diff > 0 ? "높음" : "낮음"}`;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
