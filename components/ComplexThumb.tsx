"use client";

/**
 * 단지 썸네일 (단지 비교·분양 공고·가능성 확인 공용)
 *
 * 보여주는 순서
 *  1) 조감도 — complexes.csv에 적고 public/images/complexes/ 에 넣은 이미지 (아래에 출처 표시)
 *  2) 분양 홈페이지 대표 이미지(og:image) — noticeNo를 넘긴 경우만. /api/og-image가 주소만 알려 주고,
 *     이미지는 그 홈페이지에서 바로 불러옵니다(우리 서버에 저장하지 않음). 누르면 분양 홈페이지가 새 탭으로 열림
 *  3) 위치 지도 — 카카오 정적 지도. 좌표는 /api/coords에서 매번 받아옵니다
 *  4) 빈 칸 — 키가 없거나 위치를 못 찾으면 연한 바탕에 핀 모양만 (깨진 이미지 아이콘 없음)
 * 이미지가 깨지면 자동으로 다음 순서(지도)로 넘어갑니다.
 * 화면에 보이기 직전에만 불러옵니다 (lazy loading).
 *
 * size="sm": 목록용 (모바일 56px, 넓은 화면 80px, 4:3)
 * size="lg": 가능성 확인용 (240px, 4:3)
 * size="fill": 부모 칸 너비에 맞춤
 * size="wide": 상세 화면용 (가로 최대 560px, 16:9)
 * 조감도·지도는 누르면 카카오맵에서 위치가, 분양 홈페이지 이미지는 누르면 분양 홈페이지가 새 탭으로 열립니다.
 */

import { useEffect, useRef, useState } from "react";
import type { ComplexImage } from "@/lib/complexImage";
import { hasKakaoKey, kakaoMapLink, loadKakaoMaps } from "@/lib/kakaoMap";

type Props = {
  name: string;
  address?: string | null;
  region?: string;
  image?: ComplexImage | null;
  /** 청약홈 주택관리번호. 넘기면 조감도가 없을 때 분양 홈페이지 대표 이미지를 찾아 봄 */
  noticeNo?: string | null;
  size?: "sm" | "lg" | "fill" | "wide";
};

type Og = { image: string | null; homepage: string } | null;
const ogCache = new Map<string, Promise<Og>>();

/** 공고 번호 → 대표 이미지 주소 (같은 공고는 한 번만 물어봄) */
function loadOg(no: string): Promise<Og> {
  let p = ogCache.get(no);
  if (!p) {
    p = fetch(`/api/og-image?no=${encodeURIComponent(no)}`)
      .then((r) => r.json() as Promise<{ ok: boolean; image?: string | null; homepage?: string }>)
      .then((r) => (r.ok && r.homepage ? { image: r.image ?? null, homepage: r.homepage } : null))
      .catch(() => null);
    ogCache.set(no, p);
  }
  return p;
}

type CoordState = { status: "idle" | "loading" } | { status: "ok"; lat: number; lng: number } | { status: "fail" };

const BOX = {
  sm: "w-14 sm:w-20",
  lg: "w-60 max-w-full",
  fill: "w-full",
  wide: "w-full max-w-[560px]",
} as const;

export default function ComplexThumb({ name, address, region, image, noticeNo, size = "sm" }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const manual = image && !imageFailed ? image : null;

  // 화면에 들어오는지 지켜보기 (lazy loading)
  const boxRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 조감도가 없으면 분양 홈페이지 대표 이미지 주소를 물어봄 (화면에 보일 때만)
  const wantOg = !!noticeNo && !manual && visible;
  const [og, setOg] = useState<{ no: string; value: Og } | null>(null);
  const [ogFailed, setOgFailed] = useState(false);
  useEffect(() => {
    if (!wantOg || !noticeNo) return;
    let alive = true;
    loadOg(noticeNo).then((value) => alive && setOg({ no: noticeNo, value }));
    return () => {
      alive = false;
    };
  }, [wantOg, noticeNo]);
  const answered = og !== null && og.no === noticeNo;
  const ogReady = !noticeNo || manual !== null || answered; // 물어볼 필요가 없거나 답이 옴
  const ogValue = answered ? og.value : null;
  const ogImage = !manual && ogValue?.image && !ogFailed ? { src: ogValue.image, homepage: ogValue.homepage } : null;

  // 화면에 실제로 쓸 이미지: 직접 넣은 조감도 > 분양 홈페이지 대표 이미지
  const showImage = manual ?? ogImage;

  // 지도가 필요할 때만 좌표 받기 (카카오 결과는 저장하지 않음). 대표 이미지 답을 기다린 뒤에 시작
  const [coord, setCoord] = useState<CoordState>({ status: "idle" });
  const needMap = !showImage && ogReady && visible && hasKakaoKey;
  const query = `${name}|${address ?? ""}|${region ?? ""}`;
  useEffect(() => {
    if (!needMap) return;
    let alive = true;
    const qs = new URLSearchParams({ name, address: address ?? "", region: region ?? "" });
    fetch(`/api/coords?${qs}`)
      .then((r) => r.json() as Promise<{ ok: boolean; lat?: number; lng?: number }>)
      .then((r) => {
        if (!alive) return;
        setCoord(r.ok && r.lat !== undefined && r.lng !== undefined ? { status: "ok", lat: r.lat, lng: r.lng } : { status: "fail" });
      })
      .catch(() => alive && setCoord({ status: "fail" }));
    return () => {
      alive = false;
    };
    // query가 같으면 다시 부르지 않음
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needMap, query]);

  // 좌표가 오면 정적 지도 그리기
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapState, setMapState] = useState<"none" | "ok" | "fail">("none");
  useEffect(() => {
    if (coord.status !== "ok" || !mapRef.current) return;
    let alive = true;
    const el = mapRef.current;
    loadKakaoMaps()
      .then((maps) => {
        if (!alive) return;
        el.innerHTML = "";
        const center = new maps.LatLng(coord.lat, coord.lng);
        new maps.StaticMap(el, { center, level: size === "sm" ? 5 : 4, marker: { position: center } });
        setMapState("ok");
      })
      .catch(() => alive && setMapState("fail"));
    return () => {
      alive = false;
    };
  }, [coord, size]);

  const mapCoord = coord.status === "ok" ? { lat: coord.lat, lng: coord.lng } : null;
  const caption = manual?.source ?? null;

  const frame = (
    <div
      ref={boxRef}
      className={`relative overflow-hidden rounded-[3px] border border-line bg-[#eef2f0] ${size === "wide" ? "aspect-[16/9]" : "aspect-[4/3]"} ${BOX[size]}`}
    >
      {/* 빈 칸 (불러오는 중이거나 지도를 못 그릴 때) */}
      {!(showImage && imageLoaded) && mapState !== "ok" && <Placeholder big={size !== "sm"} />}

      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={showImage.src}
          src={showImage.src}
          alt={manual ? `${name} 조감도` : `${name} 분양 홈페이지 대표 이미지`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setImageLoaded(true)}
          // 깨지면 다음 순서(대표 이미지 → 지도)로 넘어감
          onError={() => (manual ? setImageFailed(true) : setOgFailed(true))}
          className={`absolute inset-0 h-full w-full object-cover ${imageLoaded ? "" : "opacity-0"}`}
        />
      ) : (
        // 카카오 정적 지도가 이 안에 그려짐. 클릭은 바깥 링크가 받도록 지도 자체의 클릭은 막음
        <div
          ref={mapRef}
          aria-label={`${name} 위치 지도`}
          className={`pointer-events-none absolute inset-0 [&_img]:max-w-none ${mapState === "ok" ? "" : "opacity-0"}`}
        />
      )}
    </div>
  );

  return (
    <figure className={`shrink-0 ${BOX[size]}`}>
      {ogImage ? (
        <a
          href={ogImage.homepage}
          target="_blank"
          rel="noopener noreferrer"
          title="분양 홈페이지 열기"
          aria-label={`${name} 분양 홈페이지 열기`}
          className="block"
        >
          {frame}
        </a>
      ) : (
        <a
          href={kakaoMapLink(name, mapCoord, address || `${region ?? ""} ${name}`)}
          target="_blank"
          rel="noopener noreferrer"
          title="카카오맵에서 위치 보기"
          aria-label={`${name} 위치를 카카오맵에서 보기`}
          className="block"
        >
          {frame}
        </a>
      )}
      {ogImage &&
        (size === "sm" ? (
          <figcaption className="mt-0.5 truncate text-[10px] leading-tight text-muted" title="이미지 출처: 단지 분양 홈페이지">
            출처: 분양 홈페이지
          </figcaption>
        ) : (
          <figcaption className="mt-1 text-[11px] text-muted">
            이미지 출처: 단지 분양 홈페이지 ·{" "}
            <a href={ogImage.homepage} target="_blank" rel="noopener noreferrer" className="underline">
              {hostOf(ogImage.homepage)}
            </a>
          </figcaption>
        ))}
      {caption && (
        <figcaption className="mt-0.5 truncate text-[10px] leading-tight text-muted" title={`출처: ${caption}`}>
          출처: {caption}
        </figcaption>
      )}
      {size !== "sm" && !caption && !ogImage && (
        <figcaption className="mt-1 text-[11px] text-muted">누르면 카카오맵에서 위치가 열려요</figcaption>
      )}
    </figure>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "분양 홈페이지";
  }
}

function Placeholder({ big }: { big: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-muted/50" aria-hidden>
      <svg viewBox="0 0 24 24" className={big ? "h-8 w-8" : "h-4 w-4"} fill="currentColor">
        <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
      </svg>
    </div>
  );
}
