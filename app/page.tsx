import { Suspense } from "react";
import Calculator from "@/components/Calculator";

export default function Home() {
  return (
    <>
      <header className="mb-10 border-b border-line pb-6">
        <h1 className="text-2xl font-bold text-brand sm:text-3xl">청약 가점 계산기</h1>
        <p className="mt-2 text-sm text-muted">
          무주택기간, 부양가족, 청약통장 세 항목으로 84점 만점 가점을 계산하고 근거를 함께 보여줍니다.
        </p>
      </header>

      {/* 계산기는 '오늘 날짜'를 쓰므로 방문할 때마다 새로 그립니다 */}
      <Suspense fallback={<p className="py-10 text-sm text-muted">계산기를 불러오는 중…</p>}>
        <Calculator />
      </Suspense>
    </>
  );
}
