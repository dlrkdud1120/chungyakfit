import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { MigratePrompt } from "@/components/KakaoLogin";
import Providers from "@/components/Providers";
import SiteNav from "@/components/SiteNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "청약핏 — 내 가점으로 되는 단지 찾기",
  description: "내 청약 가점으로 관심 단지에 당첨 가능성이 있는지 알려주는 앱",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1F4E46",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // 카카오 로그인 환경변수가 다 있는지 (없으면 로그인 버튼이 "설정 전" 안내만 보여줌. 다른 기능은 그대로)
  const loginReady = !!(
    process.env.AUTH_SECRET &&
    (process.env.AUTH_KAKAO_ID ?? process.env.KAKAO_REST_KEY) &&
    process.env.AUTH_KAKAO_SECRET
  );
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        {/* 한글 웹폰트 (Pretendard) */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="flex min-h-full flex-col">
        {/* 로그인은 선택. Providers는 로그인 상태와 내 데이터를 모든 화면에 나눠 줍니다 */}
        <Providers enabled={loginReady}>
          <Suspense fallback={<div className="h-[46px] border-b border-line bg-white" />}>
            <SiteNav />
          </Suspense>
          <MigratePrompt />

          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>
        </Providers>

        <footer className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6">
          <p className="border-t border-line pt-5 text-xs leading-relaxed text-muted">
            실제 청약 자격과 점수는 청약홈 및 입주자모집공고 기준으로 확인하세요.
          </p>
        </footer>
      </body>
    </html>
  );
}
