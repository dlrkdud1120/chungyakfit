import { Suspense } from "react";
import type { LocationBrief } from "@/components/CompareList";
import NoticeList from "@/components/NoticeList";
import { loadLocations } from "@/lib/locationData";
import { loadComplexes } from "@/lib/complexes";

export const metadata = { title: "분양 공고 — 청약핏" };

export default function NoticesPage() {
  // API가 실패했을 때 대신 보여줄 데이터 (빌드할 때 CSV에서 읽음)
  const fallback = loadComplexes();
  // 입지 점수를 단지명+지역 키로 넘겨, 상세 화면에서 이어 붙입니다
  const locations: Record<string, LocationBrief> = {};
  for (const e of loadLocations().entries) locations[e.key] = { anchor: e.anchor, total: e.score.total, max: e.score.max };
  return (
    <>
      <header className="mb-8 border-b border-line pb-6">
        <h1 className="text-2xl font-bold text-brand sm:text-3xl">최근 분양 공고</h1>
        <p className="mt-2 text-sm text-muted">
          서울·경기의 최근 분양 공고입니다. 공고를 누르면 일정과 공급세대를 볼 수 있어요.
        </p>
      </header>
      {/* 주소의 ?no=… (상세 화면)를 읽기 때문에 화면에서 그립니다 */}
      <Suspense fallback={<p className="py-10 text-sm text-muted">불러오는 중…</p>}>
        <NoticeList fallback={fallback.complexes} images={fallback.images} locations={locations} />
      </Suspense>
    </>
  );
}
