"use client";

/**
 * 관심 공고 별 표시 (분양 공고·단지 비교·가능성 확인 공용)
 * 로그인했으면 누를 때마다 담기/빼기. 로그인 전이면 누를 때만 작은 로그인 안내를 보여줍니다.
 */

import { useState } from "react";
import { LoginHint } from "@/components/KakaoLogin";
import { useMy } from "@/components/Providers";
import type { FavoriteInput } from "@/lib/meTypes";

export default function FavoriteStar({ item, label = false }: { item: FavoriteInput; label?: boolean }) {
  const my = useMy();
  const [hint, setHint] = useState(false);
  const on = my.isFavorite(item.no);
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-pressed={on}
        aria-label={on ? `${item.name} 관심 공고에서 빼기` : `${item.name} 관심 공고에 담기`}
        title={on ? "관심 공고에서 빼기" : "관심 공고에 담기"}
        onClick={() => (my.status === "user" ? my.toggleFavorite(item) : setHint((h) => !h))}
        className={`inline-flex items-center gap-1 text-xs ${on ? "text-accent-dark" : "text-muted hover:text-accent-dark"}`}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill={on ? "#f4a53f" : "none"} stroke={on ? "#f4a53f" : "currentColor"} strokeWidth="1.3" aria-hidden>
          <path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6Z" strokeLinejoin="round" />
        </svg>
        {label && (on ? "관심 공고에 담음" : "관심 공고 담기")}
      </button>
      {hint && my.status !== "user" && <LoginHint onClose={() => setHint(false)} />}
    </span>
  );
}
