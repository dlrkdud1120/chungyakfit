"use client";

/**
 * 카카오맵 JavaScript SDK 불러오기 (화면 전용)
 *
 * 지도용 JavaScript 키는 NEXT_PUBLIC_KAKAO_JS_KEY 환경변수에 둡니다.
 * 이 키는 브라우저에서 쓰는 키라 화면 코드에 들어가지만, 카카오에 등록한 도메인에서만 작동합니다.
 * SDK는 처음 지도가 필요할 때 한 번만 불러옵니다.
 */

type LatLng = object;
export type KakaoMaps = {
  load: (cb: () => void) => void;
  LatLng: new (lat: number, lng: number) => LatLng;
  StaticMap: new (container: HTMLElement, options: { center: LatLng; level: number; marker?: { position: LatLng } }) => object;
};

declare global {
  interface Window {
    kakao?: { maps: KakaoMaps };
  }
}

const JS_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
let loading: Promise<KakaoMaps> | null = null;

export const hasKakaoKey = Boolean(JS_KEY);

export function loadKakaoMaps(): Promise<KakaoMaps> {
  if (!JS_KEY) return Promise.reject(new Error("카카오 JavaScript 키가 없습니다."));
  if (loading) return loading;

  loading = new Promise<KakaoMaps>((resolve, reject) => {
    const ready = () => window.kakao!.maps.load(() => resolve(window.kakao!.maps));
    if (window.kakao?.maps) return ready();
    const s = document.createElement("script");
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(JS_KEY)}&autoload=false`;
    s.async = true;
    s.onload = () => (window.kakao?.maps ? ready() : reject(new Error("카카오 SDK를 불러오지 못했습니다.")));
    s.onerror = () => reject(new Error("카카오 SDK를 불러오지 못했습니다."));
    document.head.appendChild(s);
  }).catch((e) => {
    loading = null; // 다음에 다시 시도
    throw e;
  });
  return loading;
}

/** 카카오맵에서 위치 열기 (좌표가 있으면 그 지점, 없으면 검색) */
export function kakaoMapLink(name: string, coord: { lat: number; lng: number } | null, query: string): string {
  return coord
    ? `https://map.kakao.com/link/map/${encodeURIComponent(name)},${coord.lat},${coord.lng}`
    : `https://map.kakao.com/link/search/${encodeURIComponent(query || name)}`;
}
