/**
 * 메인 화면 (/)
 * 단지 데이터(청약홈 과거 당첨가점), 내 점수, 분양 공고는 화면(HomeDashboard)에서 불러옵니다.
 * 여기서 읽는 CSV는 청약홈 API가 실패할 때만 쓰는 예비용입니다.
 */

import HomeDashboard from "@/components/HomeDashboard";
import WeeklyPopup from "@/components/WeeklyPopup";
import { loadComplexes } from "@/lib/complexes";
import { loadWeeklyFiles } from "@/lib/weekly-file";

export default function Home() {
  const { complexes } = loadComplexes();
  const weekly = loadWeeklyFiles();
  return (
    <>
      <header className="mb-8 border-b border-line pb-6">
        <h1 className="text-2xl font-bold text-brand sm:text-3xl">청약핏</h1>
        <p className="mt-2 text-sm text-muted">내 청약 가점으로 관심 단지에 당첨 가능성이 있는지 한눈에 봅니다.</p>
      </header>
      <HomeDashboard fallback={complexes} />
      {/* 홈에서만 띄우는 "이번 주 청약 소식" 팝업 (CSV는 추첨제 비율 계산용, weekly는 매주 자동으로 만든 주차별 파일) */}
      <WeeklyPopup csv={complexes} weekly={weekly} />
    </>
  );
}
