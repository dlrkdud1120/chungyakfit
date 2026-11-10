/**
 * 청약홈 분양정보 API 호출 (서버 전용)
 *
 * 공공데이터포털 "한국부동산원_청약홈 분양정보 조회 서비스"
 *   - getAPTLttotPblancDetail : APT 분양 공고 (단지명, 지역, 공고일, 접수일 등)
 *   - getAPTLttotPblancMdl    : 주택형별 공급세대수, 분양가
 * 이 API에는 당첨가점이 없습니다. 당첨가점 판정은 계속 data/complexes.csv를 씁니다.
 *
 * API 키는 환경변수 APPLYHOME_API_KEY에서만 읽습니다.
 * 이 파일은 app/api/notices/route.ts(서버)에서만 불러야 합니다. 화면 컴포넌트에서 import하지 마세요.
 */

/** 활용명세(Swagger) 화면의 Base URL과 같아야 합니다. 테스트용으로 APPLYHOME_API_BASE로 바꿀 수 있습니다. */
const BASE_URL = process.env.APPLYHOME_API_BASE ?? "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1";

export const NOTICE_SETTINGS = {
  regions: ["서울", "경기"], // 보여줄 공급지역 (SUBSCRPT_AREA_CODE_NM)
  daysBack: 60, // 오늘부터 며칠 전 공고까지 가져올지
  perPage: 200, // 한 번에 받을 개수
  timeoutMs: 8000, // 응답이 이 시간 안에 안 오면 실패로 처리
};

export type NoticeType = {
  type: string; // HOUSE_TY
  supply: number | null; // SUPLY_HSHLDCO 일반공급
  special: number | null; // SPSPLY_HSHLDCO 특별공급
  topAmount: number | null; // LTTOT_TOP_AMOUNT 분양 최고가 (만원)
};

export type Notice = {
  houseManageNo: string;
  name: string;
  region: string; // 공급지역 (서울, 경기 …)
  address: string;
  noticeDate: string | null; // 모집공고일
  receiptStart: string | null; // 청약접수 시작
  receiptEnd: string | null;
  winnerDate: string | null; // 당첨자 발표일
  overheated: boolean; // 투기과열지구 여부 (MDAT_TRGET_AREA_SECD = Y)
  homepage: string | null;
  types: NoticeType[];
};

export type NoticeResult =
  | { ok: true; notices: Notice[]; fetchedAt: string; typesLoaded: boolean }
  | { ok: false; reason: string };

type Raw = Record<string, unknown>;

export async function fetchNotices(): Promise<NoticeResult> {
  const key = process.env.APPLYHOME_API_KEY;
  if (!key) return { ok: false, reason: "API 키(APPLYHOME_API_KEY)가 설정되지 않았습니다." };

  const from = daysAgo(NOTICE_SETTINGS.daysBack);
  let details: Raw[];
  try {
    details = await call("getAPTLttotPblancDetail", key, { "cond[RCRIT_PBLANC_DE::GTE]": from });
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }

  // 주택형별 정보는 실패해도 공고 목록은 보여줍니다
  let models: Raw[] = [];
  let typesLoaded = true;
  try {
    models = await call("getAPTLttotPblancMdl", key, { "cond[RCRIT_PBLANC_DE::GTE]": from });
  } catch {
    typesLoaded = false;
  }

  const typesByHouse = new Map<string, NoticeType[]>();
  for (const m of models) {
    const id = str(m.HOUSE_MANAGE_NO);
    if (!id) continue;
    const list = typesByHouse.get(id) ?? [];
    list.push({
      type: str(m.HOUSE_TY) ?? "",
      supply: num(m.SUPLY_HSHLDCO),
      special: num(m.SPSPLY_HSHLDCO),
      topAmount: num(m.LTTOT_TOP_AMOUNT),
    });
    typesByHouse.set(id, list);
  }

  const notices: Notice[] = details
    .map((d): Notice => {
      const id = str(d.HOUSE_MANAGE_NO) ?? "";
      return {
        houseManageNo: id,
        name: str(d.HOUSE_NM) ?? "(이름 없음)",
        region: str(d.SUBSCRPT_AREA_CODE_NM) ?? "",
        address: str(d.HSSPLY_ADRES) ?? "",
        noticeDate: str(d.RCRIT_PBLANC_DE),
        receiptStart: str(d.RCEPT_BGNDE),
        receiptEnd: str(d.RCEPT_ENDDE),
        winnerDate: str(d.PRZWNER_PRESNATN_DE),
        overheated: str(d.MDAT_TRGET_AREA_SECD) === "Y",
        homepage: str(d.HMPG_ADRES),
        types: typesByHouse.get(id) ?? [],
      };
    })
    .filter((n) => NOTICE_SETTINGS.regions.includes(n.region))
    .sort((a, b) => (b.noticeDate ?? "").localeCompare(a.noticeDate ?? ""));

  return { ok: true, notices, fetchedAt: new Date().toISOString(), typesLoaded };
}

async function call(operation: string, key: string, cond: Record<string, string>): Promise<Raw[]> {
  const params = new URLSearchParams({
    page: "1",
    perPage: String(NOTICE_SETTINGS.perPage),
    serviceKey: key, // 공공데이터포털의 "일반 인증키(Decoding)"를 넣으세요. 여기서 자동으로 인코딩됩니다.
    ...cond,
  });

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/${operation}?${params}`, {
      signal: AbortSignal.timeout(NOTICE_SETTINGS.timeoutMs),
      cache: "no-store",
    });
  } catch {
    throw new Error("청약홈 API에 연결하지 못했습니다 (네트워크 오류 또는 시간 초과).");
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(`API 키가 거부되었습니다 (HTTP ${res.status}). 키 값과 활용신청 승인 상태를 확인하세요.`);
  }
  if (!res.ok) throw new Error(`청약홈 API가 오류를 돌려주었습니다 (HTTP ${res.status}).`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("청약홈 API 응답을 읽지 못했습니다 (JSON 형식이 아님).");
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error("청약홈 API 응답에 data 목록이 없습니다.");
  return data as Raw[];
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

/** 한국 시간 기준 N일 전 "YYYY-MM-DD" */
function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
}
