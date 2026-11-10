/**
 * 내 가점 저장하기 (브라우저 localStorage)
 *
 * 로그인·DB 없이, 계산기에서 구한 점수를 이 브라우저에만 저장합니다.
 * 다른 기기나 다른 브라우저에서는 보이지 않습니다.
 */

const KEY = "chungyakfit:myScore";
const EVENT = "chungyakfit:myScore-change";

export type SavedFuture = { years: number; baseDate: string; total: number };

export type SavedScore = {
  total: number;
  homeless: number;
  dependents: number;
  account: number;
  savedAt: string; // "YYYY-MM-DD"
  future?: SavedFuture[]; // 1년 뒤, 3년 뒤 예측 점수 (3단계부터 저장)
};

export function saveMyScore(s: SavedScore) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // 시크릿 모드 등에서 저장이 막혀도 앱은 계속 동작
  }
}

/** 저장된 원본 문자열 (없으면 null). React의 useSyncExternalStore용 */
export function readMyScoreRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function parseMyScore(raw: string | null): SavedScore | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as SavedScore;
    return typeof s.total === "number" ? s : null;
  } catch {
    return null;
  }
}

/** 저장값이 바뀌면 알려주기 (다른 탭에서 바꾼 것 포함) */
export function subscribeMyScore(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
