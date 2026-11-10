import { Suspense } from "react";
import CompareList, { type LocationBrief } from "@/components/CompareList";
import { loadComplexes } from "@/lib/complexes";
import { loadLocations } from "@/lib/locationData";

export const metadata = { title: "단지 비교 — 청약핏" };

export default function ComparePage() {
  // 단지 데이터는 화면에서 청약홈 API로 불러오고, 여기서는 예비용 CSV와 입지 점수만 읽습니다
  const fallback = loadComplexes();
  const { entries } = loadLocations();

  // 입지 점수를 단지명+지역 키로 넘겨, 화면에서 API 단지와 이어 붙입니다
  const locations: Record<string, LocationBrief> = {};
  for (const e of entries) locations[e.key] = { anchor: e.anchor, total: e.score.total, max: e.score.max };

  return (
    <>
      <header className="mb-8 border-b border-line pb-6">
        <h1 className="text-2xl font-bold text-brand sm:text-3xl">내 점수로 되는 단지</h1>
        <p className="mt-2 text-sm text-muted">
          청약홈에 공개된 최근 과거 당첨 가점과 내 점수를 단지·주택형마다 비교해 안정, 도전, 어려움으로 나눠 보여줍니다.
        </p>
      </header>
      {/* 주소의 ?sido=…&verdict=… 를 읽기 때문에 화면에서 그립니다 */}
      <Suspense fallback={<p className="py-10 text-sm text-muted">불러오는 중…</p>}>
        <CompareList fallback={fallback} locations={locations} />
      </Suspense>
    </>
  );
}
