import NoticeList from "@/components/NoticeList";
import { loadComplexes } from "@/lib/complexes";

export const metadata = { title: "분양 공고 — 청약핏" };

export default function NoticesPage() {
  // API가 실패했을 때 대신 보여줄 데이터 (빌드할 때 CSV에서 읽음)
  const fallback = loadComplexes();
  return (
    <>
      <header className="mb-8 border-b border-line pb-6">
        <h1 className="text-2xl font-bold text-brand sm:text-3xl">최근 분양 공고</h1>
        <p className="mt-2 text-sm text-muted">
          청약홈 분양정보 API에서 서울·경기의 최근 APT 분양 공고와 주택형별 공급세대수를 불러옵니다.
        </p>
      </header>
      <NoticeList fallback={fallback.complexes} />
    </>
  );
}
