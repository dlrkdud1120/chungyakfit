import AdminImages from "@/components/AdminImages";
import { loadComplexes } from "@/lib/complexes";

// 점검용 화면이라 메뉴에 넣지 않고, 검색에도 걸리지 않게 합니다
export const metadata = { title: "이미지 점검 — 청약핏", robots: { index: false, follow: false } };

/** 단지별로 어떤 대표 이미지가 골라졌는지 한눈에 보는 점검 화면 (/admin/images) */
export default function AdminImagesPage() {
  const { images } = loadComplexes();
  return (
    <>
      <header className="mb-8 border-b border-line pb-6">
        <h1 className="text-2xl font-bold text-brand sm:text-3xl">이미지 점검</h1>
        <p className="mt-2 text-sm text-muted">
          분양 공고마다 어떤 대표 이미지가 골라졌는지 봅니다. 순서는 직접 넣은 조감도 → 자동 이미지(조감도 후보 · og:image) → 지도예요.
        </p>
      </header>
      <AdminImages images={images} />
    </>
  );
}
