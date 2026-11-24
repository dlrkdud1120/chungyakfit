"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- 카카오맵 SDK는 타입 정의가 없어 지도 객체만 any로 다룸 */

/**
 * 지도로 찾기 (/map)
 *
 * - 분양 공고(+무순위) 단지를 카카오맵에 말풍선 마커로 표시. 축소하면 MarkerClusterer로 묶어 개수만 보여줌.
 *   좌표는 /api/map-items가 그때그때 찾아 주고(coords.json → 카카오 검색, 저장하지 않음), 이 화면도 메모리에만 둠.
 * - 말풍선: 단지명(8자) + 다음 일정 한 줄, 왼쪽 점은 내 판정 색(안정·도전·어려움, 점수 없으면 회색), 마감은 흐리게.
 * - 왼쪽 패널(PC) / 아래쪽 시트(모바일, 접힘·반쯤·전체): 검색 → 필터 → 지금 지도 화면 안의 단지 목록(다음 일정 순).
 * - 단지를 고르면 요약(이미지·주소·타입별 분양가·일정·내 판정·경쟁률)과 버튼(가능성 확인하기, 공고 상세, 관심 공고 별).
 * - 지도 위치와 고른 단지는 주소(/map?lat=&lng=&level=&id=)에 담아 새로고침·공유해도 그대로 열림.
 * 판정은 분양 공고 목록과 같은 방법(/api/similar + lib/judge.ts)이고, 계산·판정 규칙은 바꾸지 않습니다.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ComplexThumb from "@/components/ComplexThumb";
import FavoriteStar from "@/components/FavoriteStar";
import { useMy } from "@/components/Providers";
import { loadSimilar } from "@/components/useNoticeVerdict";
import { pickCmpet, rankText, rateText, type CmpetRow } from "@/lib/competition";
import { judge, type Judgement, type Verdict } from "@/lib/judge";
import { hasKakaoKey, loadKakaoMaps } from "@/lib/kakaoMap";
import {
  byNext,
  EMPTY_FILTERS,
  eok,
  filterCount,
  nextLong,
  nextText,
  passes,
  shortName,
  toMapItem,
  VERDICT_HEX,
  type Category,
  type Filters,
  type MapItem,
  type MapItemsResponse,
} from "@/lib/map-items";
import { favoriteFromNotice } from "@/lib/meTypes";
import { parseMyHome, readMyHomeRaw, subscribeMyHome } from "@/lib/myHome";
import { parseMyScore, readMyScoreRaw, subscribeMyScore } from "@/lib/myScore";
import { md, todayKST } from "@/lib/mySchedule";
import { shortType } from "@/lib/similar";
import { similarQuery } from "@/lib/weekly-cards";

const SEOUL = { lat: 37.5665, lng: 126.978 };
const START_LEVEL = 8; // 처음 확대 수준 (숫자가 클수록 넓게)
const PICK_LEVEL = 5; // 단지로 이동할 때
const CLUSTER_MIN_LEVEL = 7; // 이 수준부터 마커를 묶음
const noSubscribe = () => () => {};

type Load = { status: "loading" } | { status: "fail"; reason: string } | { status: "ok"; items: MapItem[] };
type Bounds = { south: number; west: number; north: number; east: number };
type Sheet = "collapsed" | "half" | "full";
type VerdictInfo = { judgement: Judgement | null };

const VERDICT_TEXT: Record<Verdict, string> = { 안정: "text-ok", 도전: "text-accent-dark", 어려움: "text-bad" };

export default function MapSearch() {
  const params = useSearchParams();
  // 주소에 담긴 처음 위치·단지 (처음 한 번만 읽음)
  const [initial] = useState(() => {
    const lat = Number(params.get("lat"));
    const lng = Number(params.get("lng"));
    const level = Number(params.get("level"));
    const ok = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
    return { center: ok ? { lat, lng } : null, level: level >= 1 && level <= 14 ? level : START_LEVEL, id: params.get("id") };
  });

  const today = useSyncExternalStore(noSubscribe, todayKST, () => "");
  const scoreRaw = useSyncExternalStore(subscribeMyScore, readMyScoreRaw, () => null);
  const homeRaw = useSyncExternalStore(subscribeMyHome, readMyHomeRaw, () => null);
  const score = useMemo(() => parseMyScore(scoreRaw), [scoreRaw]);
  const home = useMemo(() => parseMyHome(homeRaw), [homeRaw]);

  // ── 공고 + 위치 ──
  const [load, setLoad] = useState<Load>({ status: "loading" });
  useEffect(() => {
    if (!today) return;
    let alive = true;
    fetch("/api/map-items", { cache: "no-store" })
      .then((r) => r.json() as Promise<MapItemsResponse>)
      .catch((): MapItemsResponse => ({ ok: false, reason: "서버에 연결하지 못했습니다." }))
      .then((res) => {
        if (!alive) return;
        if (!res.ok) setLoad({ status: "fail", reason: res.reason });
        else setLoad({ status: "ok", items: res.items.map((n) => toMapItem(n, today)) });
      });
    return () => {
      alive = false;
    };
  }, [today]);
  const items = useMemo(() => (load.status === "ok" ? load.items : []), [load]);
  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  // ── 내 판정 (분양 공고 목록과 같은 방법) ──
  const [verdicts, setVerdicts] = useState<Record<string, VerdictInfo>>({});
  const targets = useMemo(
    () =>
      score
        ? items.filter((it) => it.notice).map((it) => ({ id: it.id, qs: similarQuery(it.notice!, home) })).filter((t): t is { id: string; qs: string } => !!t.qs)
        : [],
    [items, score, home],
  );
  useEffect(() => {
    if (!score || !targets.length) return;
    let alive = true;
    for (const t of targets) {
      loadSimilar(t.qs).then((res) => {
        if (!alive) return;
        const judgement = res.ok && res.result.stats ? judge(score.total, res.result.stats) : null;
        setVerdicts((v) => ({ ...v, [t.id]: { judgement } }));
      });
    }
    return () => {
      alive = false;
    };
  }, [targets, score]);
  const verdictOf = useCallback((id: string): Verdict | null => (score ? (verdicts[id]?.judgement?.verdict ?? null) : null), [score, verdicts]);

  // ── 필터·선택·강조 ──
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(initial.id);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [sheet, setSheet] = useState<Sheet>(initial.id ? "half" : "collapsed");
  const filtered = useMemo(() => items.filter((it) => passes(it, filters, verdictOf(it.id))), [items, filters, verdictOf]);
  const inView = (it: MapItem) =>
    !!it.coord && (!bounds || (it.coord.lat >= bounds.south && it.coord.lat <= bounds.north && it.coord.lng >= bounds.west && it.coord.lng <= bounds.east));
  const visible = filtered.filter(inView).sort(byNext);
  const noCoord = filtered.filter((it) => !it.coord).sort(byNext);
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  // ── 지도 ──
  const mapBox = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const clustererRef = useRef<any>(null);
  const overlays = useRef(new Map<string, { overlay: any; el: HTMLDivElement }>());
  const myDot = useRef<any>(null);
  const selectedRef = useRef<string | null>(initial.id);
  const [mapState, setMapState] = useState<"loading" | "ok" | "fail">(hasKakaoKey ? "loading" : "fail");
  const [message, setMessage] = useState<string | null>(null);

  /** 주소창에 지도 위치와 고른 단지 담기 (새로고침·공유용, 기록은 쌓지 않음) */
  const writeUrl = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const qs = new URLSearchParams({ lat: c.getLat().toFixed(5), lng: c.getLng().toFixed(5), level: String(map.getLevel()) });
    if (selectedRef.current) qs.set("id", selectedRef.current);
    window.history.replaceState(null, "", `/map?${qs}`);
  }, []);

  useEffect(() => {
    if (!hasKakaoKey || !mapBox.current) return;
    let alive = true;
    loadKakaoMaps()
      .then((maps: any) => {
        if (!alive || !mapBox.current) return;
        const c = initial.center ?? SEOUL;
        const map = new maps.Map(mapBox.current, { center: new maps.LatLng(c.lat, c.lng), level: initial.level });
        mapRef.current = map;
        clustererRef.current = new maps.MarkerClusterer({
          map,
          averageCenter: true,
          minLevel: CLUSTER_MIN_LEVEL,
          styles: [
            {
              width: "38px",
              height: "38px",
              background: "rgba(31, 78, 70, 0.88)",
              border: "2px solid #ffffff",
              borderRadius: "19px",
              color: "#ffffff",
              textAlign: "center",
              fontWeight: "600",
              fontSize: "13px",
              lineHeight: "34px",
            },
          ],
        });
        const onIdle = () => {
          const b = map.getBounds();
          const sw = b.getSouthWest();
          const ne = b.getNorthEast();
          setBounds({ south: sw.getLat(), west: sw.getLng(), north: ne.getLat(), east: ne.getLng() });
          writeUrl();
        };
        maps.event.addListener(map, "idle", onIdle);
        onIdle();
        setMapState("ok");
      })
      .catch(() => alive && setMapState("fail"));
    return () => {
      alive = false;
    };
  }, [initial, writeUrl]);

  // 처음 열 때 주소에 위치가 없으면 저장된 거주지 중심으로 (없으면 서울)
  const centeredHome = useRef(false);
  useEffect(() => {
    if (mapState !== "ok" || centeredHome.current || initial.center || initial.id || !home.sido) return;
    centeredHome.current = true;
    const place = `${home.sido} ${home.unit}`.trim();
    fetch(`/api/coords?${new URLSearchParams({ name: place, address: place, region: place })}`)
      .then((r) => r.json() as Promise<{ ok: boolean; lat?: number; lng?: number }>)
      .then((r) => {
        if (r.ok && r.lat !== undefined && r.lng !== undefined) mapRef.current?.setCenter(new (window as any).kakao.maps.LatLng(r.lat, r.lng));
      })
      .catch(() => {});
  }, [mapState, home, initial]);

  const select = useCallback(
    (id: string | null, pan = true) => {
      setSelectedId(id);
      selectedRef.current = id;
      const it = id ? byId.get(id) : null;
      if (it?.coord && pan) panTo(mapRef.current, it.coord);
      if (id) setSheet((s) => (s === "collapsed" ? "half" : s));
      writeUrl();
    },
    [byId, writeUrl],
  );

  // 주소에 담긴 단지로 처음 이동 (데이터가 온 뒤 한 번)
  const openedFromUrl = useRef(false);
  useEffect(() => {
    if (openedFromUrl.current || mapState !== "ok" || !initial.id || !byId.has(initial.id)) return;
    openedFromUrl.current = true;
    // 고른 단지는 이미 주소에서 읽어 둠. 지도 위치가 주소에 없으면 그 단지로 옮기기만 함
    const c = byId.get(initial.id)?.coord;
    if (!initial.center && c) panTo(mapRef.current, c);
  }, [mapState, byId, initial]);

  // 말풍선 마커 만들기·갱신 (단지명·일정·판정 색이 바뀌면 다시 그림)
  const pinKey = (it: MapItem) => `${it.name}|${nextText(it)}|${it.status}|${verdictOf(it.id) ?? ""}`;
  useEffect(() => {
    if (mapState !== "ok") return;
    const kakao = (window as any).kakao;
    for (const it of items) {
      if (!it.coord) continue;
      const key = pinKey(it);
      const old = overlays.current.get(it.id);
      if (old && old.el.dataset.key === key) continue;
      const el = old?.el ?? document.createElement("div");
      renderPin(el, it, verdictOf(it.id), key, () => select(it.id));
      if (!old) {
        const overlay = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(it.coord.lat, it.coord.lng), content: el, yAnchor: 1.25, clickable: true });
        overlays.current.set(it.id, { overlay, el });
      }
    }
    // pinKey가 verdictOf에 따라 바뀌므로 verdicts만 지켜봄
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapState, items, verdicts, select]);

  // 지금 화면 안 + 필터를 통과한 마커만 지도(묶음)에 올림
  const shownKey = visible.map((it) => it.id).join(",");
  useEffect(() => {
    const clusterer = clustererRef.current;
    if (mapState !== "ok" || !clusterer) return;
    clusterer.clear();
    clusterer.addMarkers(visible.map((it) => overlays.current.get(it.id)?.overlay).filter(Boolean));
    // shownKey가 visible 목록을 대표함
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapState, shownKey, verdicts]);

  // 목록에 마우스를 올리거나 고른 단지는 마커 강조
  useEffect(() => highlightPins(overlays.current, [hoverId, selectedId]), [hoverId, selectedId, shownKey]);

  // ── 검색 ──
  const [query, setQuery] = useState("");
  function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.replace(/\s+/g, "");
    if (!q) return;
    setMessage(null);
    const hit = items.find((it) => it.name.replace(/\s+/g, "").includes(q));
    if (hit) {
      select(hit.id);
      return;
    }
    const kakao = (window as any).kakao;
    if (mapState !== "ok" || !kakao?.maps?.services) {
      setMessage("우리 공고에 없는 이름이에요. 지도를 불러오지 못해 지역 검색도 할 수 없어요.");
      return;
    }
    new kakao.maps.services.Places().keywordSearch(query.trim(), (data: { x: string; y: string; place_name: string }[], status: string) => {
      if (status !== kakao.maps.services.Status.OK || !data.length) {
        setMessage(`"${query.trim()}"을(를) 공고나 지역에서 찾지 못했어요.`);
        return;
      }
      select(null, false);
      mapRef.current.setLevel(6);
      mapRef.current.setCenter(new kakao.maps.LatLng(Number(data[0].y), Number(data[0].x)));
      setMessage(`${data[0].place_name} 주변으로 옮겼어요.`);
    });
  }

  // ── 지도 버튼: 확대·축소·내 위치 (내 위치는 누를 때만 권한 요청) ──
  const zoom = (d: number) => mapRef.current?.setLevel(mapRef.current.getLevel() + d, { animate: true });
  function locate() {
    if (!navigator.geolocation) return setMessage("이 브라우저에서는 위치를 쓸 수 없어요.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const kakao = (window as any).kakao;
        const map = mapRef.current;
        if (!kakao || !map) return;
        const pos = new kakao.maps.LatLng(p.coords.latitude, p.coords.longitude);
        map.setLevel(6);
        map.setCenter(pos);
        if (!myDot.current) {
          const dot = document.createElement("div");
          dot.className = "h-3.5 w-3.5 rounded-full border-2 border-white bg-[#2f7de1] shadow";
          dot.setAttribute("aria-hidden", "true");
          myDot.current = new kakao.maps.CustomOverlay({ position: pos, content: dot, zIndex: 5 });
          myDot.current.setMap(map);
        } else myDot.current.setPosition(pos);
      },
      () => setMessage("위치 권한이 없거나 위치를 찾지 못했어요."),
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  // 목록으로 돌아오면 그 단지 행이 보이게
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  function backToList() {
    setLastSelected(selectedId);
    select(null, false);
  }
  useEffect(() => {
    if (!selectedId && lastSelected) rowRefs.current.get(lastSelected)?.scrollIntoView({ block: "nearest" });
  }, [selectedId, lastSelected]);

  return (
    <div className="fixed inset-x-0 top-12 bottom-[calc(52px+env(safe-area-inset-bottom))] z-20 flex bg-white sm:bottom-0">
      {/* 지도 */}
      <div className="relative order-2 min-w-0 flex-1">
        <div ref={mapBox} className="absolute inset-0 bg-[#eef2f0]" aria-label="공고 위치 지도" role="application" />
        {mapState !== "ok" && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">
            {mapState === "loading" ? "지도를 불러오는 중…" : "지도를 불러오지 못했어요. 목록과 검색은 그대로 쓸 수 있어요."}
          </div>
        )}
        {mapState === "ok" && (
          <div className="absolute right-3 bottom-[132px] z-10 flex flex-col overflow-hidden rounded-md border border-line bg-white shadow md:bottom-4">
            <MapButton label="확대" onClick={() => zoom(-1)} d="M10 5v10M5 10h10" />
            <MapButton label="축소" onClick={() => zoom(1)} d="M5 10h10" border />
            <MapButton label="내 위치로 이동" onClick={locate} d="M10 3v2.5M10 14.5V17M3 10h2.5M14.5 10H17M10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" border />
          </div>
        )}
      </div>

      {/* 패널(PC 왼쪽) / 시트(모바일 아래) */}
      <Panel sheet={sheet} setSheet={setSheet}>
        <form onSubmit={search} className="flex gap-2 px-4 pt-1 md:pt-4" role="search">
          <label htmlFor="map-search" className="sr-only">
            단지명이나 지역명 검색
          </label>
          <input
            id="map-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSheet((s) => (s === "collapsed" ? "half" : s))}
            placeholder="단지명이나 지역명 (예: 문래, 수원시)"
            className="min-w-0 flex-1 rounded border border-line px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button type="submit" className="shrink-0 rounded bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand/90">
            검색
          </button>
        </form>
        {message && (
          <p className="px-4 pt-1.5 text-xs text-muted" role="status">
            {message}
          </p>
        )}
        <FilterBar filters={filters} setFilters={setFilters} hasScore={!!score} />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {selected ? (
            <Summary item={selected} info={score ? (verdicts[selected.id] ?? null) : null} hasScore={!!score} home={home} onBack={backToList} />
          ) : load.status === "loading" ? (
            <p className="px-4 py-6 text-sm text-muted">공고와 위치를 불러오는 중…</p>
          ) : load.status === "fail" ? (
            <p className="px-4 py-6 text-sm text-muted">공고를 불러오지 못했어요. ({load.reason})</p>
          ) : (
            <>
              <p className="border-b border-line px-4 pt-3 pb-2 text-xs text-muted">
                {mapState === "ok" ? "지금 지도 화면 안" : "전체"} {visible.length}곳 · 다음 일정 가까운 순
              </p>
              {visible.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted">이 화면 안에 조건에 맞는 공고가 없어요. 지도를 옮기거나 축소해 보세요.</p>
              ) : (
                <ul>
                  {visible.map((it) => (
                    <ListRow
                      key={it.id}
                      item={it}
                      verdict={verdictOf(it.id)}
                      active={it.id === hoverId}
                      onHover={setHoverId}
                      onPick={() => select(it.id)}
                      rowRef={(el) => (el ? rowRefs.current.set(it.id, el) : rowRefs.current.delete(it.id))}
                    />
                  ))}
                </ul>
              )}
              <NoCoordList items={noCoord} verdictOf={verdictOf} onPick={(id) => select(id, false)} />
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}

// ───────────────────────── 말풍선 마커 (DOM으로 직접 그림. 글자는 textContent라 그대로 표시) ─────────────────────────

/** 단지 위치로 지도 옮기기 (너무 넓게 보고 있으면 조금 확대) */
function panTo(map: any, c: { lat: number; lng: number }) {
  const kakao = (window as any).kakao;
  if (!map || !kakao) return;
  if (map.getLevel() > PICK_LEVEL + 1) map.setLevel(PICK_LEVEL);
  map.panTo(new kakao.maps.LatLng(c.lat, c.lng));
}

/** 목록에 마우스를 올렸거나 고른 단지의 마커를 강조 */
function highlightPins(pins: Map<string, { overlay: any; el: HTMLDivElement }>, ids: (string | null)[]) {
  for (const [id, { overlay, el }] of pins) {
    const on = ids.includes(id);
    el.dataset.active = on ? "true" : "false";
    overlay.setZIndex(on ? 10 : 1);
  }
}

function renderPin(el: HTMLDivElement, it: MapItem, verdict: Verdict | null, key: string, onClick: () => void) {
  el.dataset.key = key;
  el.className =
    "map-pin relative flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-white py-1 pr-2 pl-1.5 text-left shadow-sm " +
    "data-[active=true]:border-brand data-[active=true]:ring-2 data-[active=true]:ring-brand/40 " +
    (it.status === "마감" ? "opacity-50" : "");
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  el.setAttribute("aria-label", `${it.name}, ${nextText(it)}${verdict ? `, 내 판정 ${verdict}` : ""}`);
  el.replaceChildren();
  const dot = document.createElement("span");
  dot.className = "h-2 w-2 shrink-0 rounded-full";
  dot.style.background = VERDICT_HEX[verdict ?? "none"];
  const text = document.createElement("span");
  text.className = "flex flex-col leading-tight";
  const name = document.createElement("span");
  name.className = "text-xs font-semibold whitespace-nowrap text-ink";
  name.textContent = shortName(it.name);
  const next = document.createElement("span");
  next.className = "text-xs whitespace-nowrap text-muted";
  next.textContent = nextText(it);
  text.append(name, next);
  const tail = document.createElement("span");
  tail.className = "absolute -bottom-[5px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-r border-b border-line bg-white";
  tail.setAttribute("aria-hidden", "true");
  el.append(dot, text, tail);
  el.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  el.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };
}

function MapButton({ label, onClick, d, border = false }: { label: string; onClick: () => void; d: string; border?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-10 w-10 items-center justify-center text-ink hover:bg-brand/5 ${border ? "border-t border-line" : ""}`}
    >
      <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// ───────────────────────── 패널 / 시트 ─────────────────────────

const SHEET_HEIGHT: Record<Sheet, string> = { collapsed: "120px", half: "52%", full: "100%" };
const SHEET_ORDER: Sheet[] = ["collapsed", "half", "full"];

function Panel({ sheet, setSheet, children }: { sheet: Sheet; setSheet: (s: Sheet) => void; children: React.ReactNode }) {
  const boxRef = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const [dragH, setDragH] = useState<number | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    const box = boxRef.current;
    if (!box) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, h: box.getBoundingClientRect().height, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const parent = boxRef.current?.parentElement;
    if (!d || !parent) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    setDragH(Math.max(80, Math.min(parent.clientHeight, d.h + dy)));
  }
  function onPointerUp() {
    const d = drag.current;
    const parent = boxRef.current?.parentElement;
    drag.current = null;
    if (!d || !parent) return;
    if (!d.moved) {
      // 누르기만 하면 다음 단계로 (전체에서는 접힘으로)
      setSheet(SHEET_ORDER[(SHEET_ORDER.indexOf(sheet) + 1) % SHEET_ORDER.length]);
    } else if (dragH !== null) {
      const ratio = dragH / parent.clientHeight;
      setSheet(ratio > 0.75 ? "full" : ratio > 0.3 ? "half" : "collapsed");
    }
    setDragH(null);
  }

  return (
    <section
      ref={boxRef}
      aria-label="공고 목록"
      style={{ ["--sheet-h" as string]: dragH !== null ? `${dragH}px` : SHEET_HEIGHT[sheet] }}
      className={`absolute inset-x-0 bottom-0 z-20 flex h-[var(--sheet-h)] flex-col rounded-t-xl border-t border-line bg-white shadow-[0_-4px_16px_rgba(0,0,0,0.08)] ${
        dragH === null ? "transition-[height] duration-200 motion-reduce:transition-none" : ""
      } md:static md:order-1 md:h-auto md:w-[360px] md:shrink-0 md:rounded-none md:border-t-0 md:border-r md:shadow-none`}
    >
      <button
        type="button"
        className="flex shrink-0 touch-none justify-center py-2 md:hidden"
        aria-label={sheet === "full" ? "목록 접기" : "목록 더 보기"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="h-1 w-10 rounded-full bg-line" aria-hidden="true" />
      </button>
      {children}
    </section>
  );
}

// ───────────────────────── 필터 ─────────────────────────

function FilterBar({ filters, setFilters, hasScore }: { filters: Filters; setFilters: (f: Filters) => void; hasScore: boolean }) {
  const [open, setOpen] = useState(false);
  const n = filterCount(filters);
  const toggle = <K extends "status" | "category" | "verdict">(k: K, v: Filters[K][number]) => {
    const list = filters[k] as string[];
    setFilters({ ...filters, [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] });
  };
  return (
    <div className="border-b border-line px-4 py-2">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1 text-sm text-ink">
          필터{n > 0 && <span className="text-accent-dark">({n})</span>}
          <svg viewBox="0 0 20 20" className={`h-4 w-4 text-muted ${open ? "rotate-180" : ""}`} aria-hidden="true">
            <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {n > 0 && (
          <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="text-xs text-muted hover:text-brand">
            초기화
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          <ChipRow label="일정">
            {(["접수 중", "접수 예정", "발표 대기"] as const).map((s) => (
              <Chip key={s} on={filters.status.includes(s)} onClick={() => toggle("status", s)}>
                {s}
              </Chip>
            ))}
            <Chip on={filters.hideClosed} onClick={() => setFilters({ ...filters, hideClosed: !filters.hideClosed })}>
              마감 제외
            </Chip>
          </ChipRow>
          <ChipRow label="공급">
            {([
              ["민영", "민영"],
              ["공공", "공공·신혼희망타운"],
              ["무순위", "무순위"],
            ] as [Category, string][]).map(([v, text]) => (
              <Chip key={v} on={filters.category.includes(v)} onClick={() => toggle("category", v)}>
                {text}
              </Chip>
            ))}
          </ChipRow>
          <ChipRow label="내 판정">
            {(["안정", "도전", "어려움"] as const).map((v) => (
              <Chip key={v} on={filters.verdict.includes(v)} onClick={() => toggle("verdict", v)} disabled={!hasScore}>
                {v}
              </Chip>
            ))}
            {!hasScore && <span className="self-center text-muted">가점을 저장하면 쓸 수 있어요</span>}
          </ChipRow>
        </div>
      )}
    </div>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-12 shrink-0 pt-1 text-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, disabled = false, children }: { on: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 ${on ? "border-brand bg-brand text-white" : "border-line text-ink hover:border-brand"} disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

// ───────────────────────── 목록 ─────────────────────────

function ListRow({
  item,
  verdict,
  active,
  onHover,
  onPick,
  rowRef,
}: {
  item: MapItem;
  verdict: Verdict | null;
  active: boolean;
  onHover: (id: string | null) => void;
  onPick: () => void;
  rowRef: (el: HTMLLIElement | null) => void;
}) {
  return (
    <li
      ref={rowRef}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      className={`flex items-center gap-3 border-b border-line px-4 py-2.5 ${active ? "bg-brand/5" : ""} ${item.status === "마감" ? "opacity-60" : ""}`}
    >
      <ComplexThumb name={item.name} address={item.address} region={`${item.region} ${item.unit}`} noticeNo={item.source === "apt" ? item.id : null} size="sm" />
      <button type="button" onClick={onPick} onFocus={() => onHover(item.id)} onBlur={() => onHover(null)} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-ink">{item.name}</span>
        <span className="block truncate text-xs text-muted">
          {`${item.region} ${item.unit}`.trim()} · {item.category === "공공" ? "공공·신혼희망타운" : item.category}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs">
          {verdict && <span className={`font-semibold ${VERDICT_TEXT[verdict]}`}>{verdict}</span>}
          <span className={item.next ? "text-ink" : "text-muted"}>{nextText(item)}</span>
        </span>
      </button>
    </li>
  );
}

function NoCoordList({ items, verdictOf, onPick }: { items: MapItem[]; verdictOf: (id: string) => Verdict | null; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="px-4 py-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-xs text-brand underline underline-offset-2">
        위치 정보 없는 공고 {items.length}건
      </button>
      {open && (
        <ul className="mt-2 border-t border-line">
          {items.map((it) => {
            const v = verdictOf(it.id);
            return (
              <li key={it.id} className="border-b border-line py-2">
                <button type="button" onClick={() => onPick(it.id)} className="w-full text-left">
                  <span className="block truncate text-sm text-ink">{it.name}</span>
                  <span className="block text-xs text-muted">
                    {`${it.region} ${it.unit}`.trim()} · {v ? `${v} · ` : ""}
                    {nextText(it)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────── 단지 요약 ─────────────────────────

function Summary({
  item,
  info,
  hasScore,
  home,
  onBack,
}: {
  item: MapItem;
  info: VerdictInfo | null;
  hasScore: boolean;
  home: { sido: string; unit: string };
  onBack: () => void;
}) {
  const my = useMy();
  const fav = item.notice ? favoriteFromNotice(item.notice) : null;
  const mainType = fav?.houseTy ?? null;
  const prices = item.types.filter((t) => t.topAmount !== null && t.topAmount > 0);
  const today = useSyncExternalStore(noSubscribe, todayKST, () => "");

  // 경쟁률: 이 공고 주택형의 청약 경쟁률 (아직 접수 전이면 없음)
  const [cmpet, setCmpet] = useState<{ id: string; row: CmpetRow | null } | null>(null);
  useEffect(() => {
    if (!item.notice || !mainType) return;
    const q = similarQuery(item.notice, home.sido ? home : { sido: item.region, unit: item.unit });
    if (!q) return;
    let alive = true;
    fetch(`/api/similar?${q}&houseTy=${encodeURIComponent(mainType)}`)
      .then((r) => r.json() as Promise<{ ok: boolean; targetCmpet?: CmpetRow[] | null }>)
      .then((r) => alive && setCmpet({ id: item.id, row: r.ok ? pickCmpet(r.targetCmpet ?? null) : null }))
      .catch(() => alive && setCmpet({ id: item.id, row: null }));
    return () => {
      alive = false;
    };
  }, [item, mainType, home]);
  const cmpetRow = cmpet?.id === item.id ? cmpet.row : null;

  const verdictLine = !item.notice
    ? "무순위·재공급은 추첨으로 뽑아 가점 판정을 하지 않아요."
    : !hasScore
      ? null
      : !home.sido
        ? "거주지를 정하면 내 판정을 보여드려요."
        : !similarQuery(item.notice, home)
          ? "주택형 정보가 없어 판정하지 않았어요."
          : info === null
          ? "판정을 불러오는 중…"
          : info.judgement
            ? `${info.judgement.verdict} · ${info.judgement.reason} (비슷한 과거 사례 기준)`
            : "비슷한 과거 사례가 부족해 판정하지 않았어요.";

  return (
    <div className="px-4 pb-6">
      <button type="button" onClick={onBack} className="py-3 text-sm text-brand hover:underline">
        ← 목록
      </button>
      <ComplexThumb name={item.name} address={item.address} region={`${item.region} ${item.unit}`} noticeNo={item.source === "apt" ? item.id : null} size="wide" />
      <h2 className="mt-3 text-lg font-bold text-brand">{item.name}</h2>
      <p className="mt-0.5 text-xs text-muted">{item.address || `${item.region} ${item.unit}`}</p>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted">{item.category === "공공" ? "공공·신혼희망타운" : item.category}</span>
        <span className="text-muted">·</span>
        <span className={item.status === "마감" ? "text-muted" : "text-accent-dark"}>{item.status}</span>
        {item.capped && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent-dark">분양가상한제</span>}
      </p>

      <Section title="내 판정">
        {verdictLine ? (
          <p className={`text-sm ${info?.judgement ? VERDICT_TEXT[info.judgement.verdict] : "text-muted"}`}>{verdictLine}</p>
        ) : (
          <p className="text-sm text-muted">
            <Link href="/score" className="text-brand underline">
              가점을 계산해 저장하면
            </Link>{" "}
            판정을 보여드려요.
          </p>
        )}
      </Section>

      {prices.length > 0 && (
        <Section title="주택형별 분양가 (최고가)">
          <ul>
            {prices.map((t) => (
              <li key={t.type} className="flex justify-between border-b border-line py-1.5 text-sm last:border-0">
                <span>
                  {shortType(t.type)}
                  {t.supply !== null && <span className="ml-1.5 text-xs text-muted">일반 {t.supply}세대</span>}
                </span>
                <span className="tabular-nums">{eok(t.topAmount!)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {item.events.length > 0 && (
        <Section title="일정">
          <ul>
            {item.events.map((e) => (
              <li key={e.key} className={`flex justify-between border-b border-line py-1.5 text-sm last:border-0 ${today && e.end < today ? "text-muted" : ""}`}>
                <span>{e.label}</span>
                <span className="tabular-nums">{e.start === e.end ? md(e.start) : `${md(e.start)}~${md(e.end)}`}</span>
              </li>
            ))}
          </ul>
          {item.next && <p className="mt-1 text-xs text-accent-dark">{nextLong(item)}</p>}
        </Section>
      )}

      {cmpetRow && (
        <Section title="경쟁률">
          <p className="text-sm">
            {mainType && <span className="mr-1.5 text-muted">{shortType(mainType)}</span>}
            {rankText(cmpetRow)} {rateText(cmpetRow)}
          </p>
        </Section>
      )}

      <div className="mt-5 flex items-center gap-2">
        {item.notice && mainType && (
          <Link
            href={`/check?${new URLSearchParams({ no: item.id, type: mainType })}`}
            className="flex-1 rounded bg-brand py-2.5 text-center text-sm font-semibold text-white hover:bg-brand/90"
          >
            가능성 확인하기
          </Link>
        )}
        {item.source === "apt" ? (
          <Link href={`/notice?no=${encodeURIComponent(item.id)}`} className="flex-1 rounded border border-brand py-2.5 text-center text-sm font-semibold text-brand hover:bg-brand/5">
            공고 상세
          </Link>
        ) : (
          item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 rounded border border-brand py-2.5 text-center text-sm font-semibold text-brand hover:bg-brand/5"
            >
              공고 상세 (청약홈) ↗
            </a>
          )
        )}
        {my.status === "user" && fav && <FavoriteStar item={fav} />}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 border-t border-line pt-3">
      <h3 className="mb-1.5 text-xs font-semibold text-brand">{title}</h3>
      {children}
    </section>
  );
}
