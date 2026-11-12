import MyPage from "@/components/MyPage";

export const metadata = { title: "마이페이지 — 청약핏" };

/** 마이페이지 (/mypage). 로그인 전에는 기능 소개와 로그인 버튼만 보여줍니다. 내용은 components/MyPage.tsx */
export default function MyPagePage() {
  return (
    <>
      <header className="mb-8 border-b border-line pb-6">
        <h1 className="text-2xl font-bold text-brand sm:text-3xl">마이페이지</h1>
        <p className="mt-2 text-sm text-muted">내 점수 기록, 관심 분양 공고, 청약 일정을 한곳에서 봅니다. 로그인은 선택이에요.</p>
      </header>
      <MyPage />
    </>
  );
}
