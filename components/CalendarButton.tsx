"use client";

/**
 * "내 캘린더에 추가" 버튼 (분양 공고 목록·가능성 확인 공용)
 * 누르면 그 공고 일정으로 .ics 파일을 브라우저에서 바로 만들어 내려받습니다. 서버에 보내거나 저장하지 않습니다.
 * 일정 만드는 규칙은 lib/calendar.ts에 있습니다.
 */

import type { Notice } from "@/lib/applyhome";
import { downloadIcs, scheduleEvents } from "@/lib/calendar";

export default function CalendarButton({ notice, className = "" }: { notice: Notice; className?: string }) {
  const count = scheduleEvents(notice.schedule).length;
  if (count === 0) return null; // 넣을 일정이 없으면 버튼을 숨김
  return (
    <button
      type="button"
      onClick={() => downloadIcs(notice)}
      title={`접수·발표·계약 일정 ${count}개를 .ics 파일로 받아요 (하루 전 오전 9시 알림)`}
      className={`inline-flex items-center gap-1 rounded border border-line bg-white px-2 py-1 text-xs text-brand hover:border-brand ${className}`}
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <rect x="2" y="3" width="12" height="11" rx="1.5" />
        <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3M8 8.5v3.5M6.25 10.25h3.5" strokeLinecap="round" />
      </svg>
      내 캘린더에 추가
    </button>
  );
}
