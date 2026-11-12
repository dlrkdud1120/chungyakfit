/**
 * 청약홈 API 호출 (서버 전용)
 *
 * 공공데이터포털 두 서비스를 씁니다. 같은 인증키(APPLYHOME_API_KEY)로 부르지만 활용신청은 각각 필요합니다.
 *   ApplyhomeInfoDetailSvc  분양정보 — 공고(getAPTLttotPblancDetail), 주택형별 공급(getAPTLttotPblancMdl)
 *   ApplyhomeInfoCmpetRtSvc 경쟁률   — 당첨가점(getAptLttotPblancScore)
 * 당첨가점에는 지역이 없어서, 주택관리번호(HOUSE_MANAGE_NO)로 분양정보와 이어 붙여 지역·공고일을 알아냅니다.
 *
 * 이 파일은 app/api/ 아래 Route Handler(서버)에서만 불러야 합니다. 화면 컴포넌트에서는 타입만 가져다 씁니다.
 */

import type { Complex } from "./complexes";
import { parseRate, pickCmpet, type CmpetRow } from "./competition";
import { readRegulations, REGULATIONS, type RegulationFlags } from "./eligibility-check";
import { areaOf, bandOf, groupByType, pickRow, shortSido, shortType, unitFromAddress, type Home, type PastRow } from "./similar";

/** 활용명세의 Base URL. 테스트용으로 APPLYHOME_API_BASE로 바꿀 수 있습니다. */
const BASE_URL = process.env.APPLYHOME_API_BASE ?? "https://api.odcloud.kr/api";
const DETAIL = "ApplyhomeInfoDetailSvc/v1";
const CMPET = "ApplyhomeInfoCmpetRtSvc/v1";

export const NOTICE_SETTINGS = {
  regions: ["서울", "경기"], // 분양 공고 화면에 보여줄 공급지역
  daysBack: 60, // 분양 공고: 오늘부터 며칠 전 공고까지
  pageSize: 1000, // 한 번에 받을 개수 (API가 더 작게 주면 자동으로 맞춤)
  concurrency: 5, // 동시에 보내는 요청 수
  timeoutMs: 15000,
  noticeCacheSec: 60 * 60, // 분양 공고는 1시간마다 새로
  historyCacheSec: 60 * 60 * 24, // 과거 당첨가점은 하루에 한 번 새로
};

// ───────────────────────── 공용 호출 도구 ─────────────────────────

type Raw = Record<string, unknown>;
type Page = { data: Raw[]; count: number };

function apiKey(): string {
  const key = process.env.APPLYHOME_API_KEY;
  if (!key) throw new Error("API 키(APPLYHOME_API_KEY)가 설정되지 않았습니다.");
  return key;
}

async function getPage(path: string, params: Record<string, string>, cacheSec: number): Promise<Page> {
  const qs = new URLSearchParams({ ...params, serviceKey: apiKey() });
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/${path}?${qs}`, {
      signal: AbortSignal.timeout(NOTICE_SETTINGS.timeoutMs),
      // Vercel에서는 이 캐시가 요청 사이에도 유지되어, 같은 요청을 cacheSec 동안 다시 보내지 않습니다
      next: { revalidate: cacheSec },
    });
  } catch {
    throw new Error("청약홈 API에 연결하지 못했습니다 (네트워크 오류 또는 시간 초과).");
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`API 키가 거부되었습니다 (HTTP ${res.status}). 활용신청 승인 상태를 확인하세요.`);
  }
  if (!res.ok) throw new Error(`청약홈 API가 오류를 돌려주었습니다 (HTTP ${res.status}).`);
  let body: { data?: unknown; matchCount?: number; totalCount?: number };
  try {
    body = await res.json();
  } catch {
    throw new Error("청약홈 API 응답을 읽지 못했습니다.");
  }
  if (!Array.isArray(body.data)) throw new NoDataError();
  return { data: body.data as Raw[], count: Number(body.matchCount ?? body.totalCount ?? body.data.length) };
}

/** 조건을 받지 않는 기능은 data 없이 {code, msg}만 돌려줍니다 */
class NoDataError extends Error {
  constructor() {
    super("청약홈 API 응답에 data 목록이 없습니다.");
  }
}

/** 여러 쪽에 나뉜 결과를 모두 받기 */
async function getAll(path: string, cond: Record<string, string>, cacheSec: number): Promise<Raw[]> {
  const size = NOTICE_SETTINGS.pageSize;
  const first = await getPage(path, { page: "1", perPage: String(size), ...cond }, cacheSec);
  // API가 요청보다 적게 주면 그 크기를 한 쪽 크기로 봅니다
  const step = first.data.length < size && first.data.length < first.count ? first.data.length : size;
  if (step === 0) return first.data;
  const pages = Math.ceil(first.count / step);
  const rest = await mapLimit(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2),
    NOTICE_SETTINGS.concurrency,
    (p) => getPage(path, { page: String(p), perPage: String(step), ...cond }, cacheSec).then((r) => r.data),
  );
  return [...first.data, ...rest.flat()];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v: unknown): number | null {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

/** 당첨가점: "-", "0", 빈 값은 가점 결과가 없는 것(추첨·미달 등)으로 봅니다 */
function score(v: unknown): number | null {
  const n = num(v);
  return n === null || n <= 0 ? null : n;
}

function daysAgo(n: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(Date.now() - n * 86400000));
}

// ───────────────────────── 1. 분양 공고 ─────────────────────────

export type NoticeType = {
  type: string; // HOUSE_TY (084.8860A)
  supply: number | null; // 일반공급
  special: number | null; // 특별공급
  topAmount: number | null; // 분양 최고가 (만원)
};

export type Notice = {
  houseManageNo: string;
  name: string;
  region: string; // 서울, 경기 …
  unit: string; // 시·군·구
  address: string;
  kind: string; // APT, 신혼희망타운 …
  supplyKind: string; // 민영, 국민 …
  noticeDate: string | null;
  receiptStart: string | null;
  receiptEnd: string | null;
  winnerDate: string | null;
  overheated: boolean;
  regulations: RegulationFlags | null; // 규제 조건 (투기과열지구 등). 응답에 해당 필드가 없으면 null
  homepage: string | null;
  url: string | null; // 청약홈 공고 페이지
  types: NoticeType[];
};

export type NoticeResult =
  | { ok: true; notices: Notice[]; fetchedAt: string; typesLoaded: boolean }
  | { ok: false; reason: string };

export async function fetchNotices(): Promise<NoticeResult> {
  let details: Raw[];
  try {
    details = await getAll(
      `${DETAIL}/getAPTLttotPblancDetail`,
      { "cond[RCRIT_PBLANC_DE::GTE]": daysAgo(NOTICE_SETTINGS.daysBack) },
      NOTICE_SETTINGS.noticeCacheSec,
    );
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  const notices: Notice[] = details
    .map((d) => {
      const address = str(d.HSSPLY_ADRES) ?? "";
      return {
        houseManageNo: str(d.HOUSE_MANAGE_NO) ?? "",
        name: str(d.HOUSE_NM) ?? "(이름 없음)",
        region: str(d.SUBSCRPT_AREA_CODE_NM) ?? "",
        unit: unitFromAddress(address),
        address,
        kind: str(d.HOUSE_SECD_NM) ?? "",
        supplyKind: str(d.HOUSE_DTL_SECD_NM) ?? "",
        noticeDate: str(d.RCRIT_PBLANC_DE),
        receiptStart: str(d.RCEPT_BGNDE),
        receiptEnd: str(d.RCEPT_ENDDE),
        winnerDate: str(d.PRZWNER_PRESNATN_DE),
        overheated: str(d.MDAT_TRGET_AREA_SECD) === "Y",
        regulations: readRegulations(Object.fromEntries(REGULATIONS.map((r) => [r.code, str(d[r.code])]))),
        homepage: str(d.HMPG_ADRES),
        url: str(d.PBLANC_URL),
        types: [] as NoticeType[],
      };
    })
    .filter((n) => n.houseManageNo && NOTICE_SETTINGS.regions.includes(n.region))
    .sort((a, b) => (b.noticeDate ?? "").localeCompare(a.noticeDate ?? ""));

  // 주택형별 정보는 공고일 조건을 받지 않아서 공고마다 따로 부릅니다. 실패해도 공고 목록은 보여줍니다.
  let typesLoaded = true;
  await mapLimit(notices, NOTICE_SETTINGS.concurrency, async (n) => {
    try {
      const rows = await getAll(
        `${DETAIL}/getAPTLttotPblancMdl`,
        { "cond[HOUSE_MANAGE_NO::EQ]": n.houseManageNo },
        NOTICE_SETTINGS.noticeCacheSec,
      );
      n.types = rows
        .filter((m) => str(m.HOUSE_MANAGE_NO) === n.houseManageNo) // 조건이 무시된 경우를 대비해 한 번 더 거름
        .map((m) => ({
          type: str(m.HOUSE_TY) ?? "",
          supply: num(m.SUPLY_HSHLDCO),
          special: num(m.SPSPLY_HSHLDCO),
          topAmount: num(m.LTTOT_TOP_AMOUNT),
        }));
    } catch {
      typesLoaded = false;
    }
  });

  return { ok: true, notices, fetchedAt: new Date().toISOString(), typesLoaded };
}

// ───────────────────────── 2. 과거 당첨가점 이력 ─────────────────────────

export type HistoryResult =
  | { ok: true; rows: PastRow[]; cmpet: Record<string, CmpetRow[]>; fetchedAt: string }
  | { ok: false; reason: string };

// 같은 서버가 살아 있는 동안은 계산 결과를 재사용 (Vercel에서는 위 fetch 캐시가 주 역할)
let memo: { at: number; result: HistoryResult } | null = null;
const MEMO_MS = 60 * 60 * 1000;

/**
 * 최근 N년 공고(분양정보) + 전체 당첨가점(경쟁률 API)을 주택관리번호로 이어 붙입니다.
 * yearsBack은 lib/similar.ts의 SIMILAR_RULES와 같은 값을 넘깁니다.
 */
export async function fetchHistory(yearsBack: number): Promise<HistoryResult> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.result;
  try {
    const since = daysAgo(Math.ceil(yearsBack * 365.25) + 31);
    const sinceYear = since.slice(0, 4);
    const cache = NOTICE_SETTINGS.historyCacheSec;

    const [details, scores, cmpetRaw] = await Promise.all([
      getAll(`${DETAIL}/getAPTLttotPblancDetail`, { "cond[RCRIT_PBLANC_DE::GTE]": since }, cache),
      // 주택관리번호가 연도로 시작해서(2026…) 그 이후 번호만 요청해 봅니다. 조건을 안 받으면 전체를 받습니다.
      getAll(`${CMPET}/getAptLttotPblancScore`, { "cond[HOUSE_MANAGE_NO::GTE]": `${sinceYear}000000` }, cache).catch(
        (e) => {
          if (e instanceof NoDataError) return getAll(`${CMPET}/getAptLttotPblancScore`, {}, cache);
          throw e;
        },
      ),
      // 청약 경쟁률: 같은 방식으로 받고, 실패해도 당첨가점 화면은 그대로 보이도록 빈 목록으로 둡니다
      getAll(`${CMPET}/getAPTLttotPblancCmpet`, { "cond[HOUSE_MANAGE_NO::GTE]": `${sinceYear}000000` }, cache)
        .catch((e) => {
          if (e instanceof NoDataError) return getAll(`${CMPET}/getAPTLttotPblancCmpet`, {}, cache);
          throw e;
        })
        .catch(() => [] as Raw[]),
    ]);

    // 경쟁률을 "주택관리번호|주택형"으로 묶기
    const cmpet: Record<string, CmpetRow[]> = {};
    for (const c of cmpetRaw) {
      const no = str(c.HOUSE_MANAGE_NO);
      const ty = str(c.HOUSE_TY);
      if (!no || !ty) continue;
      const key = cmpetKey(no, ty);
      (cmpet[key] ??= []).push({
        rank: num(c.SUBSCRPT_RANK_CODE),
        reside: str(c.RESIDE_SENM) ?? "",
        supply: num(c.SUPLY_HSHLDCO),
        req: num(c.REQ_CNT),
        ...parseRate(str(c.CMPET_RATE)),
      });
    }

    const byNo = new Map<string, Raw>();
    for (const d of details) {
      const no = str(d.HOUSE_MANAGE_NO);
      if (no) byNo.set(no, d);
    }

    const rows: PastRow[] = [];
    for (const s of scores) {
      const no = str(s.HOUSE_MANAGE_NO);
      const d = no ? byNo.get(no) : undefined;
      if (!d || !no) continue; // 기간 밖이거나 분양정보가 없는 공고
      if (str(d.HOUSE_SECD_NM) !== "APT") continue; // 신혼희망타운 등은 자격이 달라 제외
      const houseTy = str(s.HOUSE_TY) ?? "";
      const area = areaOf(houseTy);
      const noticeDate = str(d.RCRIT_PBLANC_DE);
      if (area === null || !noticeDate) continue;
      rows.push({
        no,
        name: str(d.HOUSE_NM) ?? "",
        sido: shortSido(str(d.SUBSCRPT_AREA_CODE_NM) ?? ""),
        unit: unitFromAddress(str(d.HSSPLY_ADRES) ?? ""),
        noticeDate,
        url: str(d.PBLANC_URL),
        address: str(d.HSSPLY_ADRES) ?? "",
        houseTy,
        band: bandOf(area),
        reside: str(s.RESIDE_SENM) ?? "",
        min: score(s.LWET_SCORE),
        avg: score(s.AVRG_SCORE),
        max: score(s.TOP_SCORE),
        cmpet: cmpet[cmpetKey(no, houseTy)] ?? [],
      });
    }

    const result: HistoryResult = { ok: true, rows, cmpet, fetchedAt: new Date().toISOString() };
    memo = { at: Date.now(), result };
    return result;
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** 경쟁률 묶음 열쇠: 주택관리번호|주택형 (두 API의 HOUSE_TY 표기가 같음) */
export const cmpetKey = (no: string, houseTy: string) => `${no.trim()}|${houseTy.trim()}`;

// ───────────────────────── 3. 단지 비교용 목록 ─────────────────────────

/**
 * 과거 당첨가점 이력을 단지 비교 화면이 쓰는 단지 목록(Complex) 형태로 바꿉니다.
 * - 분양 공고 화면과 같은 지역(NOTICE_SETTINGS.regions)만
 * - 주택형마다 내 거주지 기준 거주 구분(해당지역/기타경기/기타지역)의 값 한 줄만
 * - 평균 당첨가점이 '-'(미달·추첨 등)인 주택형은 뺍니다
 * 가점제·추첨제 세대수는 API에 없어 비워 둡니다.
 */
export function historyToComplexes(rows: PastRow[], home: Home | null, fetchedAt: string): Complex[] {
  const checkedAt = fetchedAt.slice(0, 10);
  const byNo = new Map<string, Complex>();
  const regions = NOTICE_SETTINGS.regions.map(shortSido);

  for (const group of groupByType(rows.filter((r) => regions.includes(r.sido)))) {
    const row = pickRow(group, home);
    if (!row || row.avg === null) continue;
    let c = byNo.get(row.no);
    if (!c) {
      c = {
        id: row.no,
        name: row.name,
        sido: row.sido,
        sigungu: row.unit,
        noticeDate: row.noticeDate,
        url: row.url,
        address: row.address,
        types: [],
      };
      byNo.set(row.no, c);
    }
    c.types.push({
      type: shortType(row.houseTy),
      supply: null,
      gajeomSupply: null,
      lotterySupply: null,
      min: row.min,
      avg: row.avg,
      max: row.max,
      checkedAt,
      reside: row.reside,
      cmpet: pickCmpet(row.cmpet, row.reside),
    });
  }
  for (const c of byNo.values()) c.types.sort((a, b) => a.type.localeCompare(b.type, "ko", { numeric: true }));
  return [...byNo.values()].sort((a, b) => (b.noticeDate ?? "").localeCompare(a.noticeDate ?? ""));
}
