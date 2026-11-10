"use client";

/** 맨 위 메뉴 바. 지금 보고 있는 페이지 메뉴에 밑줄을 그어 줍니다. */

import Link from "next/link";
import { usePathname } from "next/navigation";

const MENU = [
  { href: "/", label: "가점 계산" },
  { href: "/compare", label: "단지 비교" },
  { href: "/location", label: "입지 점수" },
  { href: "/notices", label: "분양 공고" },
];

export default function SiteNav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-line bg-white">
      {/* 메뉴가 늘어나 좁은 화면에서 넘치면 옆으로 밀어서 볼 수 있게 */}
      <div className="mx-auto flex max-w-5xl items-center gap-5 overflow-x-auto px-4 whitespace-nowrap sm:gap-6 sm:px-6">
        <Link href="/" className="py-3 text-[15px] font-bold text-brand">
          청약핏
        </Link>
        {MENU.map((m) => {
          const active = pathname === m.href;
          return (
            <Link
              key={m.href}
              href={m.href}
              className={`border-b-2 py-3 text-sm ${
                active ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {m.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
