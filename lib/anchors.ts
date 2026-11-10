/**
 * 화면 안 이동용 주소(#…) 만들기
 * 메인 화면에서 단지를 누르면 /compare#cx-… 로 이동해 그 단지 줄로 바로 내려갑니다.
 */

export function rowAnchor(complexId: string, type: string): string {
  let h = 5381;
  for (const ch of `${complexId}|${type}`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `cx-${h.toString(36)}`;
}

/** 단지 비교 화면의 "시간이 지나면 판정이 좋아지는 단지" 구역 */
export const FUTURE_SECTION_ID = "future";
