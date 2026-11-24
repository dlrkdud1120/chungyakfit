"use client";

/**
 * 단지 썸네일 (모든 화면 공용: 지도로 찾기, 단지 비교, 분양 공고, 가능성 확인, 홈 팝업)
 *
 * 이미지는 단지명 하나로 /api/og-image?name= 에 물어 정합니다 (규칙은 lib/image-resolve.ts 한 곳).
 *  1) image-overrides.json 직접 지정  2) 직접 넣은 조감도·모집공고 PDF 조감도  3) 자동 수집(분양 홈페이지·공공기관)
 *  4) 없으면 위치 지도 — 카카오 정적 지도 가운데에 핀 하나만 (지명 글자 위에 다른 표시를 얹지 않음)
 *  5) 지도도 못 그리면 연한 바탕에 핀 모양만 (깨진 이미지 아이콘 없음)
 * 이미지가 깨지면 자동으로 지도로 넘어갑니다. 화면에 보이기 직전에만 불러옵니다 (lazy loading).
 *
 * size="sm": 목록용 80×60px · "md": 팝업용 112×84px (둘 다 출처 글씨 없음)
 * size="lg": 240px, 4:3 · "fill": 부모 너비 · "wide": 상세용 최대 560px, 16:9
 * 분양 홈페이지 이미지는 누르면 그 홈페이지가, 조감도·지도는 카카오맵 위치가 새 탭으로 열립니다.
 */

import { useEffect, useRef, useState } from "react";
import { hasKakaoKey, kakaoMapLink, loadKakaoMaps } from "@/lib/kakaoMap";

type Props = {
  name: string;
  address?: string | null;
  region?: string;
  size?: "sm" | "md" | "lg" | "fill" | "wide";
};

type Resolved = { image: string | null; homepage: string | null; source: string | null; kind: string } | null;
const cache = new Map<string, Promise<Resolved>>();

/** 단지명 → 대표 이미지 (같은 단지는 한 번만 물어봄) */
function loadImage(name: string): Promise<Resolved> {
  let p = cache.get(name);
  if (!p) {
    p = fetch(`/api/og-image?${new URLSearchParams({ name })}`)
      .then((r) => r.json() as Promise<{ ok: boolean; image?: string | null; homepage?: string | null; source?: string | null; kind?: string }>)
      .then((r) => (r.ok ? { image: r.image ?? null, homepage: r.homepage ?? null, source: r.source ?? null, kind: r.kind ?? "" } : null))
      .catch(() => null);
    cache.set(name, p);
  }
  return p;
}

// 작은 썸네일 지도의 확대 수준 (숫자가 클수록 넓게 보임). 두 배 크기로 그려 절반으로 줄이므로 화면에는 한 단계 넓게 보임
const SMALL_MAP_LEVEL = 5;

type CoordState = { status: "idle" | "loading" } | { status: "ok"; lat: number; lng: number } | { status: "fail" };

const BOX = {
  sm: "w-20",
  md: "w-28",
  lg: "w-60 max-w-full",
  fill: "w-full",
  wide: "w-full max-w-[560px]",
} as const;

export default function ComplexThumb({ name, address, region, size = "sm" }: Props) {
  const compact = size === "sm" || size === "md";
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

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

  // 대표 이미지 물어보기 (화면에 보일 때만)
  const [got, setGot] = useState<{ name: string; value: Resolved } | null>(null);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    loadImage(name).then((value) => alive && setGot({ name, value }));
    return () => {
      alive = false;
    };
  }, [visible, name]);
  const answered = got !== null && got.name === name;
  const resolved = answered ? got.value : null;
  const showImage = resolved?.image && !imageFailed ? resolved : null;

  // 지도가 필요할 때만 좌표 받기 (카카오 결과는 저장하지 않음). 이미지 답을 기다린 뒤에 시작
  const [coord, setCoord] = useState<CoordState>({ status: "idle" });
  const needMap = !showImage && answered && visible && hasKakaoKey;
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

  // 좌표가 오면 정적 지도 그리기 (카카오 기본 마커 없이, 핀은 아래에서 가운데에 직접 그림)
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
        new maps.StaticMap(el, { center: new maps.LatLng(coord.lat, coord.lng), level: compact ? SMALL_MAP_LEVEL : 4 });
        setMapState("ok");
      })
      .catch(() => alive && setMapState("fail"));
    return () => {
      alive = false;
    };
  }, [coord, compact]);

  const mapCoord = coord.status === "ok" ? { lat: coord.lat, lng: coord.lng } : null;
  const fromHomepage = !!showImage?.homepage;
  const altText = showImage ? `${name} ${showImage.kind === "분양 홈페이지" ? "분양 홈페이지 대표 이미지" : "조감도"}` : "";

  const frame = (
    <div
      ref={boxRef}
      className={`relative overflow-hidden rounded border border-line bg-[#eef2f0] ${size === "wide" ? "aspect-[16/9]" : "aspect-[4/3]"} ${BOX[size]}`}
    >
      {/* 빈 칸 (불러오는 중이거나 지도를 못 그릴 때) */}
      {!(showImage && imageLoaded) && mapState !== "ok" && <Pin big={!compact} soft />}

      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={showImage.image!}
          src={showImage.image!}
          alt={altText}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageFailed(true)} // 깨지면 지도로
          className={`absolute inset-0 h-full w-full object-cover ${imageLoaded ? "" : "opacity-0"}`}
        />
      ) : (
        // 카카오 정적 지도가 이 안에 그려짐. 클릭은 바깥 링크가 받도록 지도 자체의 클릭은 막음
        <div aria-label={`${name} 위치 지도`} className={`pointer-events-none absolute inset-0 ${mapState === "ok" ? "" : "opacity-0"}`}>
          <div ref={mapRef} className={`absolute top-0 left-0 [&_img]:max-w-none ${compact ? "h-[200%] w-[200%] origin-top-left scale-50" : "h-full w-full"}`} />
          {mapState === "ok" && <Pin big={!compact} />}
        </div>
      )}
    </div>
  );

  return (
    <figure className={`shrink-0 ${BOX[size]}`}>
      <a
        href={fromHomepage ? showImage!.homepage! : kakaoMapLink(name, mapCoord, address || `${region ?? ""} ${name}`)}
        target="_blank"
        rel="noopener noreferrer"
        title={fromHomepage ? `${showImage!.source ?? "분양 홈페이지"} 열기` : "카카오맵에서 위치 보기"}
        aria-label={fromHomepage ? `${name} ${showImage!.source ?? "분양 홈페이지"} 열기` : `${name} 위치를 카카오맵에서 보기`}
        className="block"
      >
        {frame}
      </a>
      {/* 출처는 큰 이미지 아래에만 (목록·팝업 썸네일에는 붙이지 않음) */}
      {!compact && showImage && (fromHomepage || showImage.source) && (
        <figcaption className="mt-1 text-[11px] text-muted">
          {fromHomepage ? (
            <>
              이미지 출처: {showImage.source ? "" : "단지 분양 홈페이지 · "}
              <a href={showImage.homepage!} target="_blank" rel="noopener noreferrer" className="underline">
                {showImage.source ?? hostOf(showImage.homepage!)}
              </a>
            </>
          ) : (
            <>출처: {showImage.source}</>
          )}
        </figcaption>
      )}
      {!compact && !showImage && answered && <figcaption className="mt-1 text-[11px] text-muted">누르면 카카오맵에서 위치가 열려요</figcaption>}
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

/** 가운데 핀 하나 (soft: 지도 없이 빈 칸일 때 연하게) */
function Pin({ big, soft = false }: { big: boolean; soft?: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center" aria-hidden>
      <svg viewBox="0 0 24 24" className={`${big ? "h-8 w-8" : "h-5 w-5"} -translate-y-[30%] drop-shadow-sm`}>
        <path
          d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Z"
          fill={soft ? "rgba(107,118,114,0.45)" : "#f4a53f"}
          stroke={soft ? "none" : "#ffffff"}
          strokeWidth="1.5"
        />
        <circle cx="12" cy="9" r="2.6" fill="#ffffff" />
      </svg>
    </div>
  );
}
