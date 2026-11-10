"use client";

/**
 * 화면에서 단지 목록 가져오기 (단지 비교·메인·가점 계산 공용)
 *
 * 1순위: /api/complexes — 청약홈 과거 당첨가점 (내 거주지 기준 해당/기타 값)
 * 2순위: API가 실패하면 서버가 넘겨준 data/complexes.csv 데이터(fallback)
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Complex } from "./complexes";
import { parseMyHome, readMyHomeRaw, subscribeMyHome, type MyHome } from "./myHome";

type ApiResponse =
  | { ok: true; complexes: Complex[]; fetchedAt: string; scope: string }
  | { ok: false; reason: string };

export type ComplexesState = {
  loading: boolean;
  source: "api" | "csv";
  complexes: Complex[];
  fetchedAt: string | null;
  scope: string | null; // 예: "최근 2년 서울·경기"
  failReason: string | null; // API 실패 이유 (CSV로 대신 보여줄 때)
  home: MyHome;
};

export function useComplexes(fallback: Complex[]): ComplexesState {
  const homeRaw = useSyncExternalStore(subscribeMyHome, readMyHomeRaw, () => null);
  const home = useMemo(() => parseMyHome(homeRaw), [homeRaw]);
  const key = `${home.sido}|${home.unit}`;

  const [loaded, setLoaded] = useState<{ key: string; res: ApiResponse } | null>(null);

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams(home.sido ? { homeSido: home.sido, homeUnit: home.unit } : {});
    fetch(`/api/complexes?${qs}`)
      .then((r) => r.json() as Promise<ApiResponse>)
      .catch((): ApiResponse => ({ ok: false, reason: "서버에 연결하지 못했습니다." }))
      .then((res) => {
        if (alive) setLoaded({ key, res });
      });
    return () => {
      alive = false;
    };
    // key가 바뀔 때(거주지 변경)만 다시 불러옵니다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 거주지를 바꾸는 동안에는 직전 결과를 그대로 보여줍니다
  const res = loaded?.res ?? null;
  const loading = !loaded || loaded.key !== key;

  if (res && res.ok) {
    return { loading, source: "api", complexes: res.complexes, fetchedAt: res.fetchedAt, scope: res.scope, failReason: null, home };
  }
  return {
    loading,
    source: "csv",
    complexes: res ? fallback : [],
    fetchedAt: null,
    scope: null,
    failReason: res && !res.ok ? res.reason : null,
    home,
  };
}
