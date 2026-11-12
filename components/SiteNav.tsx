"use client";

/** 맨 위 메뉴 바. 지금 보고 있는 페이지 메뉴에 밑줄을 그어 줍니다. 오른쪽에는 카카오 로그인(선택). */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { AuthMenu } from "@/components/KakaoLogin";

const MENU = [
  { href: "/", label: "홈" },
  { href: "/score", label: "가점 계산" },
  { href: "/check", label: "가능성 확인" },
  { href: "/compare", label: "단지 비교" },
  { href: "/location", label: "입지 점수" },
  { href: "/notice", label: "분양 공고" },
  { href: "/mypage", label: "마이페이지" },
];

export default function SiteNav() {
  const pathname = usePathname();
  // 좁은 화면에서 메뉴가 옆으로 넘칠 때, 지금 페이지의 메뉴가 보이도록 옮겨 줌
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname]);
  return (
    <nav className="border-b border-line bg-white">
      {/* 메뉴가 늘어나 좁은 화면에서 넘치면 옆으로 밀어서 볼 수 있게 */}
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto whitespace-nowrap sm:gap-6">
        <Link href="/" className="py-3 text-[15px] font-bold text-brand">
          청약핏
        </Link>
        {MENU.map((m) => {
          const active = pathname === m.href;
          return (
            <Link
              key={m.href}
              href={m.href}
              ref={active ? activeRef : undefined}
              className={`border-b-2 py-3 text-sm ${
                active ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {m.label}
            </Link>
          );
        })}
      </div>
      {/* 오른쪽: 로그인 전에는 카카오 로그인 버튼, 로그인 후에는 닉네임과 로그아웃 */}
      <div className="shrink-0">
        <AuthMenu />
      </div>
      </div>
    </nav>
  );
}
