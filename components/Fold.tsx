"use client";

/**
 * "자세히 보기" 접기 부품 (앱 전체 공용)
 * 자세한 정보는 기본으로 접어 두고, 누르면 펼쳐지는 방식으로 통일합니다.
 */

import { useState } from "react";

export default function Fold({
  label,
  children,
  defaultOpen = false,
  openOnHash,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  openOnHash?: string; // 주소가 #이 값으로 끝나면 처음부터 펼침
  className?: string;
}) {
  const [open, setOpen] = useState(() => defaultOpen || (!!openOnHash && typeof window !== "undefined" && window.location.hash === `#${openOnHash}`));
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between border-b border-line py-3 text-left text-sm text-brand hover:bg-brand/5"
      >
        <span>{open ? label.replace(/보기$/, "접기") : label}</span>
        <svg viewBox="0 0 16 16" className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div className="pt-2">{children}</div>}
    </div>
  );
}
