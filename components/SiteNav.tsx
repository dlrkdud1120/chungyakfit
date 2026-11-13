"use client";

/**
 * 맨 위 바 + 왼쪽 메뉴 판 + 모바일 하단 탭
 * - 위 바: 왼쪽 메뉴 버튼(≡), 가운데 아이콘과 이름, 오른쪽 카카오 로그인(선택)
 * - 메뉴 판: 메뉴 버튼을 누르면 왼쪽에서 열림. 바깥을 누르거나 ESC를 누르면 닫힘
 * - 하단 탭: 좁은 화면에서만, 자주 쓰는 4개
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthMenu } from "@/components/KakaoLogin";

type Item = { href: string; label: string; desc: string; icon: React.ReactNode; tab?: boolean };

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const MENU: Item[] = [
  { href: "/", label: "홈", desc: "내 점수와 노려볼 단지 한눈에", tab: true, icon: <path {...P} d="M3 9.5 10 3l7 6.5M5 8.5V17h10V8.5" /> },
  {
    href: "/score",
    label: "가점 계산",
    desc: "내 청약 점수 알아보기",
    tab: true,
    icon: <path {...P} d="M5 3h10v14H5zM7.5 6.5h5M7.5 10h1M11.5 10h1M7.5 13.5h1M11.5 13.5h1" />,
  },
  {
    href: "/check",
    label: "가능성 확인",
    desc: "원하는 단지에 당첨될 수 있을지",
    tab: true,
    icon: <path {...P} d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM7 10l2 2 4-4.5" />,
  },
  { href: "/compare", label: "단지 비교", desc: "과거 당첨 가점과 내 점수 비교", icon: <path {...P} d="M4 16V9M10 16V4M16 16v-5" /> },
  {
    href: "/location",
    label: "입지 점수",
    desc: "교통·학군·생활 여건 점수",
    icon: <path {...P} d="M10 17s5-5 5-8.5a5 5 0 0 0-10 0C5 12 10 17 10 17ZM10 10.2a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z" />,
  },
  { href: "/notice", label: "분양 공고", desc: "최근 공고와 접수 일정", icon: <path {...P} d="M4 5h12v11H4zM4 8.5h12M7 3v3M13 3v3" /> },
  {
    href: "/eligibility",
    label: "부적격 점검",
    desc: "당첨 취소로 이어지는 실수 확인",
    icon: <path {...P} d="M10 3 4 5.5V10c0 3.5 2.5 6 6 7 3.5-1 6-3.5 6-7V5.5L10 3ZM10 7.5v3.5M10 13.5v.2" />,
  },
  {
    href: "/mypage",
    label: "마이페이지",
    desc: "점수 기록, 관심 공고, 청약 캘린더",
    tab: true,
    icon: <path {...P} d="M10 10a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM4 17c.5-3 3-4.5 6-4.5s5.5 1.5 6 4.5" />,
  },
];

const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0" aria-hidden>
    {children}
  </svg>
);

export default function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // 메뉴 판이 열려 있는 동안: ESC로 닫기, 뒤 화면이 같이 밀리지 않게 고정
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* ───── 위 바 ───── */}
      <nav className="border-b border-line bg-white" aria-label="상단 바">
        <div className="mx-auto grid h-12 max-w-5xl grid-cols-[1fr_auto_1fr] items-center px-2 sm:px-6">
          <div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="메뉴 열기"
              aria-expanded={open}
              className="-ml-0.5 rounded p-2 text-ink hover:bg-brand/5"
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
                <path {...P} strokeWidth={1.7} d="M3 5.5h14M3 10h14M3 14.5h14" />
              </svg>
            </button>
          </div>
          <Link href="/" className="flex items-center gap-1.5 text-[15px] font-bold text-brand">
            <Logo />
            청약핏
          </Link>
          <div className="flex justify-end pr-2 sm:pr-0">
            <AuthMenu />
          </div>
        </div>
      </nav>

      {/* ───── 왼쪽 메뉴 판 ───── */}
      {open && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="메뉴">
          <button type="button" aria-label="메뉴 닫기" onClick={() => setOpen(false)} className="menu-fade absolute inset-0 bg-ink/30" />
          <div className="menu-slide absolute inset-y-0 left-0 flex w-72 max-w-[82%] flex-col overflow-y-auto bg-white">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-line pr-2 pl-4">
              <span className="flex items-center gap-1.5 text-[15px] font-bold text-brand">
                <Logo />
                청약핏
              </span>
              <button type="button" onClick={() => setOpen(false)} aria-label="메뉴 닫기" className="rounded p-2 text-muted hover:text-ink">
                <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
                  <path {...P} d="M5 5l10 10M15 5 5 15" />
                </svg>
              </button>
            </div>
            <ul>
              {MENU.map((m) => {
                const active = pathname === m.href;
                return (
                  <li key={m.href}>
                    <Link
                      href={m.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 border-b border-l-2 border-b-line py-3 pr-4 pl-4 ${
                        active ? "border-l-brand text-brand" : "border-l-transparent text-ink hover:bg-brand/5"
                      }`}
                    >
                      <span className={active ? "text-brand" : "text-muted"}>
                        <Icon>{m.icon}</Icon>
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-sm ${active ? "font-semibold" : ""}`}>{m.label}</span>
                        <span className="block truncate text-xs text-muted">{m.desc}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* ───── 모바일 하단 탭 (자주 쓰는 4개) ───── */}
      <nav
        aria-label="하단 탭"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        {MENU.filter((m) => m.tab).map((m) => {
          const active = pathname === m.href;
          return (
            <Link
              key={m.href}
              href={m.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-1.5 text-[11px] ${active ? "font-semibold text-brand" : "text-muted"}`}
            >
              <Icon>{m.icon}</Icon>
              {m.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

/** 앱 아이콘 원본(public/icons/icon.svg)과 같은 그림, 24px */
function Logo() {
  return (
    <svg viewBox="0 0 100 100" className="h-6 w-6 shrink-0" aria-hidden>
      <rect width="100" height="100" rx="22" fill="#1F4E46" />
      <path d="M20 50 L50 24 L80 50" fill="none" stroke="#F7F6F2" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M29 46 V78 H71 V46" fill="none" stroke="#F7F6F2" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 74 V58" stroke="#F4A53F" strokeWidth="5" strokeLinecap="round" />
      <path d="M50 60 C50 52 44 47 37 47 C37 55 43 60 50 60 Z" fill="#F4A53F" />
      <path d="M50 62 C50 53 56 48 63 48 C63 56 57 62 50 62 Z" fill="#F4A53F" />
    </svg>
  );
}
