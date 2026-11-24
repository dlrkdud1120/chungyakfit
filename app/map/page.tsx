/**
 * 지도로 찾기 (/map)
 * 분양 공고 단지를 지도에 표시하고, 지금 화면 안의 단지를 목록으로 보여줍니다. 내용은 components/MapSearch.tsx.
 */

import { Suspense } from "react";
import MapSearch from "@/components/MapSearch";

export const metadata = { title: "지도로 찾기 — 청약핏" };

export default function MapPage() {
  return (
    <>
      {/* 지도는 화면 전체를 덮어 쓰고, 화면 읽기용 제목만 둠 */}
      <h1 className="sr-only">지도로 찾기</h1>
      {/* 주소의 ?lat=&lng=&level=&id= 를 읽기 때문에 화면에서 그립니다 */}
      <Suspense fallback={<p className="py-10 text-sm text-muted">지도를 준비하는 중…</p>}>
        <MapSearch />
      </Suspense>
    </>
  );
}
