/**
 * 단지 데이터 읽기 (data/complexes.csv)
 *
 * 배포할 때(빌드 시점) CSV를 읽어 화면용 데이터로 바꿉니다.
 * CSV를 고치고 GitHub에 올리면 Vercel이 다시 빌드하면서 바로 반영됩니다.
 *
 * 규칙
 * - 1행은 열 이름. 열 순서는 바뀌어도 되지만 이름은 COLUMNS와 같아야 합니다.
 * - 첫 칸이 #으로 시작하는 줄과 빈 줄은 무시합니다. (양식의 예시 줄)
 * - 숫자 칸이 비어 있거나 "-"면 "데이터 없음"(null)으로 처리합니다.
 * - 6단계에서 청약홈 API로 바꿀 때는 loadComplexes()만 바꾸면 됩니다.
 *
 * 이 파일은 서버(빌드)에서만 실행됩니다. 화면 컴포넌트에서는 타입만 가져다 씁니다.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv";
import { IMAGE_DIR, imageKey, type ComplexImages } from "./complexImage";

export const CSV_PATH = path.join(process.cwd(), "data", "complexes.csv");

/** CSV 열 이름 ↔ 프로그램 안에서 쓰는 이름 */
export const COLUMNS = {
  name: "단지명",
  region: "지역(시·구)",
  noticeDate: "공고일",
  type: "주택형(타입)",
  supply: "공급세대수",
  gajeomSupply: "가점제 세대수",
  lotterySupply: "추첨제 세대수",
  min: "당첨가점 최저",
  avg: "당첨가점 평균",
  max: "당첨가점 최고",
  checkedAt: "출처 확인일",
} as const;

/** 없어도 되는 열 (조감도) — 예전 양식 CSV도 그대로 읽힙니다 */
export const OPTIONAL_COLUMNS = {
  image: "조감도 파일명",
  imageSource: "이미지 출처",
} as const;

type Key = keyof typeof COLUMNS | keyof typeof OPTIONAL_COLUMNS;
const LABEL: Record<Key, string> = { ...COLUMNS, ...OPTIONAL_COLUMNS };

export type HouseType = {
  type: string;
  supply: number | null;
  gajeomSupply: number | null;
  lotterySupply: number | null;
  min: number | null;
  avg: number | null;
  max: number | null;
  checkedAt: string | null; // 출처 확인일 "YYYY-MM-DD"
  reside?: string; // 청약홈 API 데이터일 때: 이 값이 어느 거주 구분의 당첨가점인지 (해당지역 등)
};

export type Complex = {
  id: string;
  name: string;
  sido: string; // "서울"
  sigungu: string; // "강남구", "성남시 분당구"
  noticeDate: string | null; // 공고일 "YYYY-MM-DD"
  url?: string | null; // 청약홈 공고 링크 (API 데이터일 때)
  address?: string | null; // 공급 위치 주소 (API 데이터일 때, 지도 썸네일용)
  types: HouseType[];
};

export type ComplexData = {
  complexes: Complex[];
  warnings: string[]; // CSV에서 고쳐야 할 부분 (화면에 표시)
  images: ComplexImages; // 조감도 (파일이 실제로 있는 것만)
  imageWarnings: string[]; // 조감도 파일을 못 찾은 경우 등
};

export function loadComplexes(): ComplexData {
  let text: string;
  try {
    text = readFileSync(CSV_PATH, "utf8");
  } catch {
    return { complexes: [], warnings: ["data/complexes.csv 파일을 찾을 수 없습니다."], images: {}, imageWarnings: [] };
  }
  const data = buildComplexes(parseCsv(text));

  // 조감도: public/images/complexes/ 에 파일이 실제로 있는 것만 씁니다 (없으면 화면에서 지도로 대신 보여줌)
  const images: ComplexImages = {};
  const imageWarnings: string[] = [];
  for (const [key, img] of Object.entries(data.images)) {
    const file = decodeURIComponent(img.src.slice(IMAGE_DIR.length + 1));
    if (existsSync(path.join(process.cwd(), "public", "images", "complexes", file))) images[key] = img;
    else imageWarnings.push(`조감도 파일 '${file}'이 public/images/complexes/ 에 없어 지도로 대신 보여줍니다.`);
  }
  return { ...data, images, imageWarnings };
}

/** CSV 줄 목록 → 단지 목록 (테스트하기 쉽도록 파일 읽기와 분리) */
export function buildComplexes(rows: string[][]): ComplexData {
  const warnings: string[] = [];
  if (rows.length === 0) return { complexes: [], warnings: ["CSV가 비어 있습니다."], images: {}, imageWarnings: [] };

  // 1) 열 위치 찾기
  const header = rows[0].map((h) => h.trim());
  const index = {} as Record<Key, number>;
  const missing: string[] = [];
  for (const key of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) {
    index[key] = header.indexOf(COLUMNS[key]);
    if (index[key] === -1) missing.push(COLUMNS[key]);
  }
  for (const key of Object.keys(OPTIONAL_COLUMNS) as (keyof typeof OPTIONAL_COLUMNS)[]) {
    index[key] = header.indexOf(OPTIONAL_COLUMNS[key]);
  }
  const images: ComplexImages = {};
  if (missing.length > 0) {
    return {
      complexes: [],
      warnings: [
        `CSV 1행에 열 이름이 없습니다: ${missing.join(", ")}. 엑셀에서 저장했다면 "CSV UTF-8" 형식인지 확인하세요.`,
      ],
      images: {},
      imageWarnings: [],
    };
  }

  // 2) 줄마다 읽어서 같은 단지(단지명+지역+공고일)끼리 묶기
  const byId = new Map<string, Complex>();
  rows.slice(1).forEach((cells, i) => {
    const line = i + 2; // 엑셀에서 보이는 행 번호
    const get = (k: Key) => (index[k] === -1 ? "" : (cells[index[k]] ?? "")).trim();
    if (cells.every((c) => c.trim() === "")) return;
    if (get("name").startsWith("#") || (cells[0] ?? "").trim().startsWith("#")) return;

    const name = get("name");
    const region = get("region");
    const type = get("type");

    // 조감도: 파일 이름만 받습니다 (폴더 경로가 섞여 있으면 마지막 이름만)
    const imageFile = get("image").split(/[\\/]/).pop() ?? "";
    if (name && imageFile) {
      images[imageKey(name)] = { src: `${IMAGE_DIR}/${encodeURIComponent(imageFile)}`, source: get("imageSource") || null };
    }
    // 단지명과 조감도만 적은 줄(주택형 없음)은 조감도 등록용으로만 쓰고 넘어갑니다
    if (name && imageFile && !type) return;

    if (!name || !region || !type) {
      warnings.push(`${line}행: 단지명, 지역, 주택형은 꼭 있어야 해서 이 줄은 건너뛰었습니다.`);
      return;
    }

    const num = (k: Key) => {
      const raw = get(k).replace(/,/g, "");
      if (raw === "" || raw === "-") return null;
      const n = Number(raw);
      if (Number.isNaN(n)) {
        warnings.push(`${line}행 '${LABEL[k]}': "${get(k)}"는 숫자가 아니라 데이터 없음으로 처리했습니다.`);
        return null;
      }
      return n;
    };
    const date = (k: Key) => {
      const raw = get(k);
      if (raw === "") return null;
      const d = normalizeDate(raw);
      if (!d) warnings.push(`${line}행 '${LABEL[k]}': "${raw}"를 날짜로 읽지 못했습니다. 2026-01-15 형식으로 적어 주세요.`);
      return d;
    };

    const t: HouseType = {
      type,
      supply: num("supply"),
      gajeomSupply: num("gajeomSupply"),
      lotterySupply: num("lotterySupply"),
      min: num("min"),
      avg: num("avg"),
      max: num("max"),
      checkedAt: date("checkedAt"),
    };
    if (t.min !== null && t.avg !== null && t.min > t.avg) {
      warnings.push(`${line}행: 최저(${t.min})가 평균(${t.avg})보다 큽니다. 열 순서를 확인해 주세요.`);
    }
    if (t.avg !== null && t.max !== null && t.avg > t.max) {
      warnings.push(`${line}행: 평균(${t.avg})이 최고(${t.max})보다 큽니다. 열 순서를 확인해 주세요.`);
    }
    for (const v of [t.min, t.avg, t.max]) {
      if (v !== null && (v < 0 || v > 84)) {
        warnings.push(`${line}행: 가점 ${v}은 0~84 범위를 벗어납니다.`);
        break;
      }
    }

    const noticeDate = date("noticeDate");
    const id = `${name}|${region}|${noticeDate ?? ""}`;
    let complex = byId.get(id);
    if (!complex) {
      const [sido, ...rest] = region.split(/\s+/);
      complex = { id, name, sido, sigungu: rest.join(" "), noticeDate, types: [] };
      byId.set(id, complex);
    }
    complex.types.push(t);
  });

  return { complexes: [...byId.values()], warnings, images, imageWarnings: [] };
}

/** "2026.1.5", "2026/01/05", "2026-01-05" → "2026-01-05" */
function normalizeDate(s: string): string | null {
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?$/.exec(s.trim());
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}
