/**
 * 단지 위치 좌표 찾기 (서버 전용)
 *
 * 순서
 *  1) data/coords.json — 직접 확인해 적어 둔 좌표 (공공데이터 등, 카카오 결과가 아닌 것)
 *  2) 카카오 로컬 API 주소 검색 → 못 찾으면 키워드(단지명) 검색 — 매번 실시간 호출
 *
 * 카카오 운영정책상 로컬 API 결과(좌표·주소)는 파일·DB·임시 캐시 어디에도 저장하면 안 됩니다.
 * 그래서 2)의 결과는 저장하지 않고 응답으로만 돌려줍니다.
 * 카카오 REST API 키(KAKAO_REST_KEY)는 이 파일(서버)에서만 읽습니다.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const COORDS_PATH = path.join(process.cwd(), "data", "coords.json");
const KAKAO_BASE = process.env.KAKAO_LOCAL_BASE ?? "https://dapi.kakao.com/v2/local"; // 테스트용으로 바꿀 수 있음

export type Coord = { lat: number; lng: number };
export type CoordResult =
  | { ok: true; lat: number; lng: number; from: "manual" | "kakao-address" | "kakao-keyword" }
  | { ok: false; reason: string };

/** 단지명 비교용 (띄어쓰기 무시) */
const norm = (s: string) => s.replace(/\s+/g, "");

/** coords.json 읽기 — 파일이 작아서 요청마다 읽어도 됩니다 (고치면 바로 반영) */
function manualCoords(): Map<string, Coord> {
  const map = new Map<string, Coord>();
  try {
    const raw = JSON.parse(readFileSync(COORDS_PATH, "utf8")) as Record<string, unknown>;
    for (const [name, v] of Object.entries(raw)) {
      if (name.startsWith("_") || !v || typeof v !== "object") continue;
      const { lat, lng } = v as { lat?: unknown; lng?: unknown };
      if (typeof lat === "number" && typeof lng === "number") map.set(norm(name), { lat, lng });
    }
  } catch {
    // 파일이 없거나 형식이 틀리면 직접 입력 좌표 없이 진행
  }
  return map;
}

/**
 * 공급 주소를 검색하기 좋게 다듬기
 * "경기도 광주시 탄벌동 203-4번지 일원 (탄벌A지구 A5블럭)" → "경기도 광주시 탄벌동 203-4"
 */
export function cleanAddress(a: string): string {
  return a
    .replace(/\(.*?\)/g, " ")
    .replace(/외\s*\d+\s*필지/g, " ")
    .replace(/(\d)\s*번지/g, "$1")
    .replace(/(^|\s)(일원|일대)(?=\s|$)/g, " ")
    .replace(/[,·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function kakao(kind: "address" | "keyword", query: string, key: string): Promise<Coord | null> {
  const res = await fetch(`${KAKAO_BASE}/search/${kind}.json?${new URLSearchParams({ query, size: "1" })}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    cache: "no-store", // 정책상 저장 금지 → 캐시도 하지 않음
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 401 || res.status === 403) throw new Error(`카카오 REST 키가 거부되었습니다 (HTTP ${res.status}). 키와 카카오맵 사용 설정을 확인하세요.`);
  if (res.status === 429) throw new Error("카카오 API 하루 사용량을 넘었습니다.");
  if (!res.ok) throw new Error(`카카오 API 오류 (HTTP ${res.status})`);
  const body = (await res.json()) as { documents?: { x?: string; y?: string }[] };
  const d = body.documents?.[0];
  const lat = Number(d?.y);
  const lng = Number(d?.x);
  return d && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export async function findCoord(name: string, address: string, region: string): Promise<CoordResult> {
  const manual = manualCoords().get(norm(name));
  if (manual) return { ok: true, ...manual, from: "manual" };

  const key = process.env.KAKAO_REST_KEY;
  if (!key) return { ok: false, reason: "카카오 REST 키(KAKAO_REST_KEY)가 설정되지 않았습니다." };

  try {
    // 1) 주소 검색: 다듬은 주소 → 끝 단어를 하나씩 줄여 가며 (번지 없이 동까지)
    const clean = cleanAddress(address);
    if (clean) {
      const words = clean.split(" ");
      for (let n = words.length; n >= Math.min(3, words.length); n--) {
        const hit = await kakao("address", words.slice(0, n).join(" "), key);
        if (hit) return { ok: true, ...hit, from: "kakao-address" };
      }
    }
    // 2) 키워드 검색: "지역 단지명" → "단지명"
    for (const q of [`${region} ${name}`.trim(), name]) {
      if (!q) continue;
      const hit = await kakao("keyword", q, key);
      if (hit) return { ok: true, ...hit, from: "kakao-keyword" };
    }
    return { ok: false, reason: "주소로 위치를 찾지 못했습니다." };
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.name !== "TimeoutError" ? e.message : "카카오 API에 연결하지 못했습니다." };
  }
}
