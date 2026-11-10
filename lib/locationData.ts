/**
 * 입지 데이터 읽기 (data/locations.csv)
 *
 * complexes.csv와 같은 방식으로 빌드할 때 읽습니다.
 * 단지명 + 지역(시·구)이 complexes.csv와 같으면 단지 비교 화면에도 입지 점수가 붙습니다.
 * 이 파일은 서버(빌드)에서만 실행됩니다.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv";
import { scoreLocation, type LocationInput, type LocationScore } from "./location";

const CSV_PATH = path.join(process.cwd(), "data", "locations.csv");

const COLUMNS = {
  name: "단지명",
  region: "지역(시·구)",
  stationName: "가장 가까운 지하철역",
  stationDistance: "지하철역 거리(m)",
  busStops: "버스정류장 수(500m)",
  marts: "마트 수(1km)",
  hospitals: "병원 수(1km)",
  schools: "학교 수(1km)",
  method: "측정 방법",
  checkedAt: "확인일",
} as const;

type Key = keyof typeof COLUMNS;

export type LocationEntry = {
  key: string; // 단지 연결용 (locationKey)
  anchor: string; // 페이지 안 링크용 id
  name: string;
  region: string;
  method: string | null;
  checkedAt: string | null;
  input: LocationInput;
  score: LocationScore;
};

export type LocationData = { entries: LocationEntry[]; warnings: string[] };

/** 단지명·지역의 띄어쓰기 차이는 같은 단지로 봅니다 */
export function locationKey(name: string, region: string): string {
  return `${name.replace(/\s+/g, "")}|${region.replace(/\s+/g, "")}`;
}

export function anchorId(key: string): string {
  let h = 5381;
  for (const ch of key) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `loc-${h.toString(36)}`;
}

export function loadLocations(): LocationData {
  let text: string;
  try {
    text = readFileSync(CSV_PATH, "utf8");
  } catch {
    return { entries: [], warnings: ["data/locations.csv 파일을 찾을 수 없습니다."] };
  }
  return buildLocations(parseCsv(text));
}

export function buildLocations(rows: string[][]): LocationData {
  const warnings: string[] = [];
  if (rows.length === 0) return { entries: [], warnings: ["locations.csv가 비어 있습니다."] };

  const header = rows[0].map((h) => h.trim());
  const index = {} as Record<Key, number>;
  const missing: string[] = [];
  for (const k of Object.keys(COLUMNS) as Key[]) {
    index[k] = header.indexOf(COLUMNS[k]);
    if (index[k] === -1) missing.push(COLUMNS[k]);
  }
  if (missing.length > 0) {
    return {
      entries: [],
      warnings: [`locations.csv 1행에 열 이름이 없습니다: ${missing.join(", ")}. "CSV UTF-8"로 저장했는지 확인하세요.`],
    };
  }

  const seen = new Set<string>();
  const entries: LocationEntry[] = [];
  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (k: Key) => (cells[index[k]] ?? "").trim();
    if (cells.every((c) => c.trim() === "")) return;
    if ((cells[0] ?? "").trim().startsWith("#")) return;

    const name = get("name");
    const region = get("region");
    if (!name || !region) {
      warnings.push(`locations.csv ${line}행: 단지명과 지역은 꼭 있어야 해서 건너뛰었습니다.`);
      return;
    }
    const key = locationKey(name, region);
    if (seen.has(key)) {
      warnings.push(`locations.csv ${line}행: '${name}'이 이미 위에 있어 건너뛰었습니다.`);
      return;
    }
    seen.add(key);

    const num = (k: Key) => {
      const raw = get(k).replace(/,/g, "").replace(/m$/i, "");
      if (raw === "" || raw === "-") return null;
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0) {
        warnings.push(`locations.csv ${line}행 '${COLUMNS[k]}': "${get(k)}"를 숫자로 읽지 못해 데이터 없음으로 처리했습니다.`);
        return null;
      }
      return n;
    };

    const input: LocationInput = {
      stationName: get("stationName") || null,
      stationDistance: num("stationDistance"),
      busStops: num("busStops"),
      marts: num("marts"),
      hospitals: num("hospitals"),
      schools: num("schools"),
    };
    entries.push({
      key,
      anchor: anchorId(key),
      name,
      region,
      method: get("method") || null,
      checkedAt: get("checkedAt") || null,
      input,
      score: scoreLocation(input),
    });
  });

  return { entries, warnings };
}
