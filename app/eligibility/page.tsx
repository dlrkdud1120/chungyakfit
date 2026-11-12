import { Suspense } from "react";
import EligibilityCheck from "@/components/EligibilityCheck";

export const metadata = { title: "부적격 위험 점검 — 청약핏" };

/** 부적격 위험 점검만 따로 보는 페이지 (/eligibility). 가점 계산 화면 아래에도 같은 점검이 있습니다. */
export default function EligibilityPage() {
  return (
    <>
      <header className="border-b border-line pb-6">
        <h1 className="text-2xl font-bold text-brand sm:text-3xl">부적격 위험 점검</h1>
        <p className="mt-2 text-sm text-muted">
          청약 전에 당첨 취소로 이어지는 흔한 실수를 확인합니다. 주소에 ?no=주택관리번호를 붙이면 그 공고를 고른 상태로 열려요.
        </p>
      </header>
      {/* 주소의 ?no= 를 읽기 때문에 화면에서 그립니다 */}
      <Suspense fallback={<p className="py-10 text-sm text-muted">불러오는 중…</p>}>
        <EligibilityCheck />
      </Suspense>
    </>
  );
}
