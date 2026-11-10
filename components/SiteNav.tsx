"use client";

/** 맨 위 메뉴 바. 지금 보고 있는 페이지 메뉴에 밑줄을 그어 줍니다. */

import Link from "next/link";
import { usePathname } from "next/navigation";

const MENU = [
  { href: "/", label: "가점 계산" },
  { href: "/compare", label: "단지 비교" },
  { href: "/location", label: "입지 점수" },
];

export default function SiteNav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 sm:px-6">
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
