"use client";

/**
 * 가점 계산 입력값 임시 보관 (이 브라우저 탭 안에서만)
 * 입력 중 다른 메뉴로 갔다 와도 값이 남도록 sessionStorage에 둡니다.
 * 탭을 닫으면 지워지고, 서버로는 보내지 않습니다. (계정에 저장하는 것은 계산된 점수뿐)
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ScoreInput } from "@/lib/score";

const KEY = "chungyakfit:scoreDraft";
const EVENT = "chungyakfit:scoreDraft-change";

/** 계산 기준일은 보관하지 않고 늘 오늘 날짜에서 시작 (baseDate를 뺀 나머지 입력) */
export type ScoreDraft = Omit<ScoreInput, "baseDate"> & { baseDate: string | null };

export const EMPTY_DRAFT: ScoreDraft = {
  baseDate: null,
  birthDate: "",
  married: false,
  marriageDate: "",
  houseHistory: "never",
  soldDate: "",
  children: [],
  parents: [],
  hasAccount: true,
  accountJoinDate: "",
  spouseHasAccount: false,
  spouseAccountJoinDate: "",
};

// 저장이 막힌 브라우저에서도 화면을 옮겨 다니는 동안은 값이 남도록 메모리에도 둠
let memory: string | null = null;

function readRaw(): string | null {
  try {
    return window.sessionStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

function parse(raw: string | null): ScoreDraft {
  if (!raw) return EMPTY_DRAFT;
  try {
    const v = JSON.parse(raw) as Partial<ScoreDraft>;
    return { ...EMPTY_DRAFT, ...v, children: Array.isArray(v.children) ? v.children : [], parents: Array.isArray(v.parents) ? v.parents : [] };
  } catch {
    return EMPTY_DRAFT;
  }
}

/** [입력값, 일부만 바꾸기, 입력을 한 번이라도 했는지] */
export function useScoreDraft(): [ScoreDraft, (patch: Partial<ScoreDraft>) => void, boolean] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const draft = useMemo(() => parse(raw), [raw]);
  const set = useCallback((patch: Partial<ScoreDraft>) => {
    memory = JSON.stringify({ ...parse(readRaw()), ...patch });
    try {
      window.sessionStorage.setItem(KEY, memory);
    } catch {
      // 저장이 막힌 브라우저에서는 메모리 값만 사용
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [draft, set, raw !== null];
}
