/**
 * 내 거주지 저장하기 (브라우저 localStorage)
 * 해당지역·기타지역 구분에 씁니다. 내 점수처럼 이 브라우저에만 저장됩니다.
 */

const KEY = "chungyakfit:myHome";
const EVENT = "chungyakfit:myHome-change";

export type MyHome = { sido: string; unit: string };

export function saveMyHome(h: MyHome) {
  try {
    localStorage.setItem(KEY, JSON.stringify(h));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // 저장이 막혀도 계속 동작
  }
}

export function readMyHomeRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function parseMyHome(raw: string | null): MyHome {
  try {
    const h = raw ? (JSON.parse(raw) as MyHome) : null;
    return { sido: h?.sido ?? "", unit: h?.unit ?? "" };
  } catch {
    return { sido: "", unit: "" };
  }
}

export function subscribeMyHome(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
