"use client";

/**
 * 분양 공고 한 건의 "내 판정" 구하기 (목록 행·상세 공용)
 * 아직 당첨 결과가 없는 공고라서, 가능성 확인과 같은 "비슷한 과거 사례"(/api/similar)로
 * lib/judge.ts 판정을 붙입니다. 같은 조건은 한 번만 불러옵니다.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Notice } from "@/lib/applyhome";
import { judge, type Verdict } from "@/lib/judge";
import { favoriteFromNotice } from "@/lib/meTypes";
import { parseMyHome, readMyHomeRaw, subscribeMyHome } from "@/lib/myHome";
import { parseMyScore, readMyScoreRaw, subscribeMyScore } from "@/lib/myScore";
import { areaOf, bandOf, type SimilarResult } from "@/lib/similar";

type SimilarResponse = { ok: true; result: SimilarResult } | { ok: false; reason: string };
const cache = new Map<string, Promise<SimilarResponse>>();

function load(qs: string): Promise<SimilarResponse> {
  let p = cache.get(qs);
  if (!p) {
    p = fetch(`/api/similar?${qs}`)
      .then((r) => r.json() as Promise<SimilarResponse>)
      .catch((): SimilarResponse => ({ ok: false, reason: "" }));
    cache.set(qs, p);
  }
  return p;
}

export type NoticeVerdict =
  | { status: "none"; text: string } // 판정하지 않음 (이유)
  | { status: "loading" }
  | { status: "done"; verdict: Verdict | null };

/** enabled가 true가 된 뒤에만 불러옵니다 (목록에서는 화면에 보일 때) */
export function useNoticeVerdict(n: Notice, enabled: boolean): NoticeVerdict {
  const scoreRaw = useSyncExternalStore(subscribeMyScore, readMyScoreRaw, () => null);
  const homeRaw = useSyncExternalStore(subscribeMyHome, readMyHomeRaw, () => null);
  const score = parseMyScore(scoreRaw)?.total ?? null;
  const home = parseMyHome(homeRaw);

  const fav = favoriteFromNotice(n);
  const area = fav.houseTy ? areaOf(fav.houseTy) : null;
  const qs =
    score !== null && home.sido && area !== null && fav.sido && fav.unit
      ? new URLSearchParams({ sido: fav.sido, unit: fav.unit, band: bandOf(area), homeSido: home.sido, homeUnit: home.unit, exclude: n.houseManageNo }).toString()
      : null;

  const [got, setGot] = useState<{ qs: string; res: SimilarResponse } | null>(null);
  useEffect(() => {
    if (!qs || !enabled) return;
    let alive = true;
    load(qs).then((res) => alive && setGot({ qs, res }));
    return () => {
      alive = false;
    };
  }, [qs, enabled]);

  if (n.kind !== "APT" || area === null) return { status: "none", text: "판정 대상 아님" };
  if (score === null) return { status: "none", text: "점수 필요" };
  if (!home.sido) return { status: "none", text: "거주지 필요" };
  if (!qs || !got || got.qs !== qs) return { status: "loading" };
  if (!got.res.ok || !got.res.result.stats) return { status: "done", verdict: null };
  return { status: "done", verdict: judge(score, got.res.result.stats)?.verdict ?? null };
}

export const VERDICT_COLOR: Record<Verdict, string> = { 안정: "text-ok", 도전: "text-accent-dark", 어려움: "text-bad" };
