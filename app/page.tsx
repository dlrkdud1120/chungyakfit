/**
 * 메인 화면 (/)
 * 단지 데이터는 빌드할 때 CSV에서 읽어 넘기고, 내 점수와 분양 공고는 화면(HomeDashboard)에서 불러옵니다.
 */

import HomeDashboard from "@/components/HomeDashboard";
import { loadComplexes } from "@/lib/complexes";

export default function Home() {
  const { complexes } = loadComplexes();
  return (
    <>
      <header className="mb-8 border-b border-line pb-6">
        <h1 className="text-2xl font-bold text-brand sm:text-3xl">청약핏</h1>
        <p className="mt-2 text-sm text-muted">내 청약 가점으로 관심 단지에 당첨 가능성이 있는지 한눈에 봅니다.</p>
      </header>
      <HomeDashboard complexes={complexes} />
    </>
  );
}
