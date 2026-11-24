/**
 * 분양 공고 검색 규칙 (화면 공용, 저장 없음)
 *
 * 찾는 대상: 단지명, 시·도·시·군·구, 건설사(시공사), 공급기관(LH·GH·SH), 공고 종류(신혼희망타운, 공공분양, 민영 …)
 * - 띄어쓰기·대소문자 무시, 일부만 쳐도 찾음
 * - 초성만 치면 초성으로 찾음 ("ㅎㄹㅌ" → 해링턴)
 * - ㅐ/ㅔ처럼 헷갈리기 쉬운 모음은 같게 봄 ("레미안" → 래미안)
 * - 일치한 글자 위치를 돌려줘 화면에서 주황색으로 표시
 * 건설사는 청약홈 분양정보의 CNSTRCT_ENTRPS_NM, 공급기관은 사업주체 BSNS_MBY_NM에서 읽습니다 (실제 응답에서 확인).
 */

import type { Notice } from "./applyhome";
import { agencyOf } from "./public-source";

// ───────────────────────── 글자 비교 ─────────────────────────

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const SYL_START = 0xac00;
const SYL_END = 0xd7a3;
// 헷갈리기 쉬운 모음을 하나로 (ㅐ=ㅔ, ㅒ=ㅖ, ㅙ=ㅚ=ㅞ)
const VOWEL_FOLD: Record<number, number> = { 5: 1, 7: 3, 11: 10, 15: 10 };

const isSyllable = (c: number) => c >= SYL_START && c <= SYL_END;
const isChoChar = (ch: string) => CHO.includes(ch);

/** 한 글자 비교용으로 다듬기 (소문자, 모음 접기) */
function foldChar(ch: string): string {
  const c = ch.codePointAt(0)!;
  if (!isSyllable(c)) return ch.toLowerCase();
  const i = c - SYL_START;
  const cho = Math.floor(i / 588);
  const jung = Math.floor((i % 588) / 28);
  const jong = i % 28;
  return String.fromCodePoint(SYL_START + cho * 588 + (VOWEL_FOLD[jung] ?? jung) * 28 + jong);
}

/** 한 글자의 초성 (한글이 아니면 그대로) */
function choOf(ch: string): string {
  const c = ch.codePointAt(0)!;
  return isSyllable(c) ? CHO[Math.floor((c - SYL_START) / 588)] : ch.toLowerCase();
}

export type Query = { raw: string; chars: string[]; chosung: boolean };

/** 검색어 준비: 띄어쓰기를 빼고, 모두 초성이면 초성 검색 */
export function makeQuery(raw: string): Query | null {
  const chars = [...raw.replace(/\s+/g, "")];
  if (!chars.length) return null;
  const chosung = chars.every(isChoChar);
  return { raw: raw.trim(), chars: chosung ? chars : chars.map(foldChar), chosung };
}

/** text 안에서 검색어가 처음 일치하는 원래 글자 위치 [시작, 끝) (띄어쓰기는 건너뜀). 없으면 null */
export function findRange(text: string, q: Query): [number, number] | null {
  const src = [...text];
  const pos: number[] = [];
  const keys: string[] = [];
  src.forEach((ch, i) => {
    if (/\s/.test(ch)) return;
    pos.push(i);
    keys.push(q.chosung ? choOf(ch) : foldChar(ch));
  });
  const n = q.chars.length;
  for (let s = 0; s + n <= keys.length; s++) {
    let ok = true;
    for (let k = 0; k < n; k++) {
      if (keys[s + k] !== q.chars[k]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      // 코드 포인트 위치 → 문자열 위치
      const start = [...src.slice(0, pos[s])].join("").length;
      const end = src.slice(0, pos[s + n - 1] + 1).join("").length;
      return [start, end];
    }
  }
  return null;
}

// ───────────────────────── 공고에서 찾을 값 ─────────────────────────

/** "지에스건설(주)" → "지에스건설", "주식회사 시티건설" → "시티건설" */
export function cleanCompany(s: string): string {
  return s
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 시공사 목록 (쉼표로 이어진 여러 곳을 나눔) */
export function buildersOf(n: Notice): string[] {
  return (n.builder ?? "")
    .split(/[,，/]/)
    .map(cleanCompany)
    .filter(Boolean);
}

/** 공급기관 (사업주체 이름 → 없으면 홈페이지 주소로) */
export function agencyKeyOf(n: Notice): "LH" | "GH" | "SH" | null {
  const d = n.developer ?? "";
  if (/한국토지주택공사/.test(d)) return "LH";
  if (/경기주택도시공사/.test(d)) return "GH";
  if (/서울주택도시개발공사|SH공사/.test(d)) return "SH";
  return agencyOf(n.homepage)?.key ?? null;
}

const AGENCY_NAME = { LH: "LH 한국토지주택공사", GH: "GH 경기주택도시공사", SH: "SH 서울주택도시개발공사" } as const;

/** 공고 종류 낱말 (청약홈 값 그대로 + 국민주택은 "공공분양") */
export function kindsOf(n: Notice): string[] {
  const out = [n.kind, n.supplyKind].filter(Boolean);
  if (n.supplyKind === "국민") out.push("공공분양");
  return out;
}

export type MatchField = "name" | "region" | "builder" | "agency" | "kind";
export type Match = { field: MatchField; text: string; range: [number, number] };

/** 한 공고가 검색어에 맞는지. 맞으면 어디에서 맞았는지 (단지명 → 지역 → 건설사 → 공급기관 → 종류 순) */
export function matchNotice(n: Notice, q: Query): Match | null {
  const tryField = (field: MatchField, texts: string[]): Match | null => {
    for (const text of texts) {
      const range = findRange(text, q);
      if (range) return { field, text, range };
    }
    return null;
  };
  const agency = agencyKeyOf(n);
  return (
    tryField("name", [n.name]) ??
    tryField("region", [`${n.region} ${n.unit}`.trim()]) ??
    tryField("builder", buildersOf(n)) ??
    tryField("agency", agency ? [AGENCY_NAME[agency], n.developer ?? ""] : n.developer ? [n.developer] : []) ??
    tryField("kind", kindsOf(n))
  );
}

// ───────────────────────── 자동완성 ─────────────────────────

export type Suggestion =
  | { kind: "단지"; label: string; no: string; range: [number, number] }
  | { kind: "지역"; label: string; region: string; unit: string; range: [number, number] }
  | { kind: "건설사"; label: string; range: [number, number] };

export const SUGGEST_MAX = 8;

/** 분류별 후보 (단지 → 지역 → 건설사, 모두 합쳐 최대 8개) */
export function suggest(notices: Notice[], q: Query): Suggestion[] {
  const complexes: Suggestion[] = [];
  const regions = new Map<string, Suggestion>();
  const builders = new Map<string, Suggestion>();
  for (const n of notices) {
    const r = findRange(n.name, q);
    if (r) complexes.push({ kind: "단지", label: n.name, no: n.houseManageNo, range: r });
    for (const [label, unit] of [
      [n.region, ""],
      [`${n.region} ${n.unit}`.trim(), n.unit],
    ] as const) {
      if (!label || regions.has(label)) continue;
      const rr = findRange(label, q);
      if (rr) regions.set(label, { kind: "지역", label, region: n.region, unit, range: rr });
    }
    for (const b of buildersOf(n)) {
      if (builders.has(b)) continue;
      const rb = findRange(b, q);
      if (rb) builders.set(b, { kind: "건설사", label: b, range: rb });
    }
  }
  // 분류마다 고르게: 단지 4, 지역 2, 건설사 2를 먼저 채우고 남는 자리는 순서대로
  const groups = [complexes, [...regions.values()], [...builders.values()]];
  const quota = [4, 2, 2];
  const picked = groups.map((g, i) => g.slice(0, quota[i]));
  let left = SUGGEST_MAX - picked.reduce((a, g) => a + g.length, 0);
  groups.forEach((g, i) => {
    const more = g.slice(picked[i].length, picked[i].length + Math.max(0, left));
    picked[i].push(...more);
    left -= more.length;
  });
  return picked.flat();
}

// ───────────────────────── 최근 검색어 (브라우저 저장소, 못 쓰면 조용히 건너뜀) ─────────────────────────

const RECENT_KEY = "chungyakfit:noticeSearchRecent";
export const RECENT_MAX = 5;

export function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function writeRecent(list: string[]): string[] {
  const next = list.slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // 시크릿 모드 등: 저장만 건너뜀
  }
  return next;
}

export const addRecent = (list: string[], word: string) => writeRecent([word, ...list.filter((w) => w !== word)]);
