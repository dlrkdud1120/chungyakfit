import { Suspense } from "react";
import CheckPossibility from "@/components/CheckPossibility";

export const metadata = { title: "당첨 가능성 확인 — 청약핏" };

export default function CheckPage() {
  return (
    <>
      <header className="mb-8 border-b border-line pb-6">
        <h1 className="text-2xl font-bold text-brand sm:text-3xl">당첨 가능성 확인</h1>
        <p className="mt-2 text-sm text-muted">
          청약하고 싶은 단지를 고르면, 같은 지역·같은 면적대의 최근 과거 당첨 가점과 내 가점을 비교해 가능성을 보여줍니다.
        </p>
      </header>
      {/* 주소의 ?no=…&type=… 를 읽기 때문에 화면에서 그립니다 */}
      <Suspense fallback={<p className="py-10 text-sm text-muted">불러오는 중…</p>}>
        <CheckPossibility />
      </Suspense>
    </>
  );
}
