"use client";

/**
 * 카카오 로그인 관련 작은 부품들
 * - KakaoLoginButton: 작은 로그인 버튼
 * - AuthMenu: 내비게이션 오른쪽 (로그인 전: 로그인 버튼 / 로그인 후: 닉네임과 로그아웃)
 * - LoginHint: 로그인이 필요한 버튼을 눌렀을 때만 보여주는 짧은 안내
 * - MigratePrompt: 처음 로그인했을 때 브라우저에 저장된 점수를 계정으로 옮길지 한 번 묻기
 */

import { useState, useSyncExternalStore } from "react";
import { useMy } from "@/components/Providers";
import { parseMyHome, readMyHomeRaw } from "@/lib/myHome";
import { parseMyScore, readMyScoreRaw, subscribeMyScore } from "@/lib/myScore";

export function KakaoLoginButton({ className = "" }: { className?: string }) {
  const my = useMy();
  const [note, setNote] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => (my.enabled ? my.login() : setNote(true))}
        className={`inline-flex items-center gap-1 rounded bg-[#FEE500] px-2.5 py-1 text-xs font-medium whitespace-nowrap text-[#191919] hover:brightness-95 ${className}`}
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden>
          <path d="M8 1.8C4.1 1.8 1 4.2 1 7.2c0 1.9 1.3 3.6 3.2 4.6l-.7 2.6c-.1.2.2.4.4.3l3.1-2c.3 0 .7.1 1 .1 3.9 0 7-2.4 7-5.5S11.900 1.800 8 1.800Z" />
        </svg>
        카카오 로그인
      </button>
      {note && <span className="ml-2 text-xs text-muted">로그인 설정이 아직 안 됐어요 (.env.local 확인)</span>}
    </>
  );
}

export function AuthMenu() {
  const my = useMy();
  if (my.status === "loading") return null;
  if (my.status === "guest") return <KakaoLoginButton />;
  return (
    <span className="flex items-center gap-2 text-xs whitespace-nowrap text-muted">
      <span className="max-w-24 truncate text-ink">{my.nickname}님</span>
      <button type="button" onClick={my.logout} className="underline-offset-2 hover:text-ink hover:underline">
        로그아웃
      </button>
    </span>
  );
}

/** 로그인 전에 별 표시 등을 눌렀을 때만 뜨는 작은 안내 */
export function LoginHint({ onClose }: { onClose: () => void }) {
  return (
    <span className="absolute top-full left-1/2 z-20 mt-1 flex w-56 -translate-x-1/2 flex-col gap-1.5 rounded-[3px] border border-line bg-white p-2.5 text-left text-xs font-normal text-ink shadow-sm">
      <span>로그인하면 마이페이지에 저장돼요.</span>
      <span className="flex items-center justify-between">
        <KakaoLoginButton />
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          닫기
        </button>
      </span>
    </span>
  );
}

const askedKey = (id: string) => `chungyakfit:migrateAsked:${id}`;

export function MigratePrompt() {
  const my = useMy();
  const raw = useSyncExternalStore(subscribeMyScore, readMyScoreRaw, () => null);
  const [answered, setAnswered] = useState(false);
  const local = parseMyScore(raw);

  // 로그인했고, 계정에 점수 기록이 하나도 없고, 이 브라우저에 저장된 점수가 있을 때만
  if (answered || !my.userId || my.dataState !== "ok" || !my.data || my.data.scores.length > 0 || !local) return null;
  let asked = false;
  try {
    asked = localStorage.getItem(askedKey(my.userId)) === "1";
  } catch {
    // 저장소를 못 읽으면 그냥 물어봄
  }
  if (asked) return null;

  const done = (move: boolean) => {
    try {
      localStorage.setItem(askedKey(my.userId!), "1");
    } catch {
      // 무시
    }
    setAnswered(true);
    if (move) {
      void my.uploadScore(local);
      // 계정에 거주지가 비어 있으면 이 브라우저의 거주지(시·군)도 함께 옮김
      const home = parseMyHome(readMyHomeRaw());
      if (!my.data?.home.sido && home.sido) my.setHome(home.sido, home.unit);
    }
  };

  return (
    <div className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-sm sm:px-6">
        <span>
          이 브라우저에 저장된 점수 <b className="text-brand">{local.total}점</b>이 있어요. 내 계정으로 옮길까요?
        </span>
        <span className="flex gap-2 text-xs">
          <button type="button" onClick={() => done(true)} className="rounded bg-brand px-2.5 py-1 font-semibold text-white">
            옮기기
          </button>
          <button type="button" onClick={() => done(false)} className="rounded border border-line px-2.5 py-1 text-muted">
            괜찮아요
          </button>
        </span>
      </div>
    </div>
  );
}
