import CompareList from "@/components/CompareList";
import { loadComplexes } from "@/lib/complexes";

export const metadata = { title: "단지 비교 — 청약핏" };

export default function ComparePage() {
  // 빌드할 때 data/complexes.csv를 읽습니다
  const data = loadComplexes();
  return (
    <>
      <header className="mb-8 border-b border-line pb-6">
        <h1 className="text-2xl font-bold text-brand sm:text-3xl">내 점수로 되는 단지</h1>
        <p className="mt-2 text-sm text-muted">
          단지·주택형마다 청약홈에 공개된 과거 당첨 가점과 내 점수를 비교해 안정, 도전, 어려움으로 나눠 보여줍니다.
        </p>
      </header>
      <CompareList data={data} />
    </>
  );
}
