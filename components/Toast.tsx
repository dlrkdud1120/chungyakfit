"use client";

/**
 * 짧은 알림(토스트) — 모든 화면 공용
 *
 * - 어디서든 toast("관심 공고에 담았어요") 처럼 부르면 화면 아래에 한 줄이 잠깐 떴다가 사라집니다.
 * - 한 번에 하나만 보여 줍니다(새 알림이 오면 바뀜). 4초 뒤 사라지고, 마우스를 올리거나 버튼에 초점이 있으면 멈춥니다.
 * - action을 주면 오른쪽에 "되돌리기" 같은 버튼이 붙습니다.
 * - 화면 읽기 프로그램은 role="status"로 읽고, 동작 줄이기 설정이면 올라오는 효과 없이 바로 나타납니다.
 * <Toaster />는 app/layout.tsx에 한 번만 둡니다.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";

type ToastItem = { id: number; message: string; action?: { label: string; onClick: () => void } };

let current: ToastItem | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(message: string, action?: ToastItem["action"]) {
  current = { id: nextId++, message, action };
  emit();
}

function dismiss(id: number) {
  if (current?.id !== id) return;
  current = null;
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const DURATION = 4000;

export default function Toaster() {
  const item = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const paused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 새 알림마다 4초 타이머 (멈춘 동안은 다시 시작하지 않음)
  const start = (id: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!paused.current) dismiss(id);
    }, DURATION);
  };
  useEffect(() => {
    if (!item) return;
    paused.current = false;
    start(item.id);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [item]);

  const pause = () => {
    paused.current = true;
    if (timer.current) clearTimeout(timer.current);
  };
  const resume = () => {
    paused.current = false;
    if (item) start(item.id);
  };

  return (
    // 모바일은 아래 탭 바 위, PC는 화면 아래 가운데
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 sm:bottom-6"
    >
      {item && (
        <div
          key={item.id}
          onMouseEnter={pause}
          onMouseLeave={resume}
          onFocus={pause}
          onBlur={resume}
          onKeyDown={(e) => e.key === "Escape" && dismiss(item.id)}
          className="toast-in pointer-events-auto flex max-w-[528px] min-w-0 items-center gap-3 rounded bg-ink px-4 py-2.5 text-sm text-white shadow-[0_4px_14px_rgba(0,0,0,0.18)]"
        >
          <span className="min-w-0 flex-1">{item.message}</span>
          {item.action && (
            <button
              type="button"
              onClick={() => {
                item.action?.onClick();
                dismiss(item.id);
              }}
              className="-my-1 shrink-0 rounded px-2 py-1 font-semibold text-accent hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-accent"
            >
              {item.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="알림 닫기"
            onClick={() => dismiss(item.id)}
            className="-my-1 -mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
