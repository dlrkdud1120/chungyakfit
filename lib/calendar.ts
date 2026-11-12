/**
 * 공고 일정 → 캘린더 파일(.ics) 만들기 (화면·서버 공용, 저장 없음)
 *
 * 분양정보(getAPTLttotPblancDetail) 실제 응답 필드 (check-result.txt에서 확인)
 *   SPSPLY_RCEPT_BGNDE / SPSPLY_RCEPT_ENDDE           특별공급 접수 시작·종료일
 *   GNRL_RNK1_CRSPAREA_RCPTDE / _ENDDE                1순위 해당지역 접수 시작·종료일
 *   GNRL_RNK1_ETC_GG_RCPTDE / _ENDDE                  1순위 기타경기
 *   GNRL_RNK1_ETC_AREA_RCPTDE / _ENDDE                1순위 기타지역
 *   GNRL_RNK2_… (위와 같은 모양)                       2순위
 *   PRZWNER_PRESNATN_DE                               당첨자 발표일
 *   CNTRCT_CNCLS_BGNDE                                계약 시작일
 * 값은 "2026-11-16" 모양이고, 없으면 null입니다.
 */

export type DateRange = { start: string; end: string };

export type NoticeSchedule = {
  special: DateRange | null;
  rank1: DateRange | null;
  rank1Areas: string[]; // "해당지역 11.16" 처럼 거주 구분별 날짜 (메모용)
  rank2: DateRange | null;
  rank2Areas: string[];
  winner: string | null;
  contract: string | null;
};

const AREAS = [
  ["CRSPAREA", "해당지역"],
  ["ETC_GG", "기타경기"],
  ["ETC_AREA", "기타지역"],
] as const;

const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const md = (s: string) => `${Number(s.slice(5, 7))}.${Number(s.slice(8, 10))}`;
const span = (r: DateRange) => (r.start === r.end ? md(r.start) : `${md(r.start)}~${md(r.end)}`);

function range(start: string | null, end: string | null): DateRange | null {
  if (!isDate(start)) return null;
  return { start, end: isDate(end) && end >= start ? end : start };
}

/** 1·2순위: 거주 구분별 날짜를 모아 가장 이른 시작 ~ 가장 늦은 종료 */
function rank(get: (k: string) => string | null, n: 1 | 2): { all: DateRange | null; areas: string[] } {
  const parts: [string, DateRange][] = [];
  for (const [code, label] of AREAS) {
    const r = range(get(`GNRL_RNK${n}_${code}_RCPTDE`), get(`GNRL_RNK${n}_${code}_ENDDE`));
    if (r) parts.push([label, r]);
  }
  if (!parts.length) return { all: null, areas: [] };
  const start = parts.map(([, r]) => r.start).sort()[0];
  const end = parts.map(([, r]) => r.end).sort().at(-1)!;
  return { all: { start, end }, areas: parts.map(([label, r]) => `${label} ${span(r)}`) };
}

/** 분양정보 원본 한 건 → 일정 */
export function scheduleFromRaw(get: (k: string) => string | null): NoticeSchedule {
  const r1 = rank(get, 1);
  const r2 = rank(get, 2);
  const winner = get("PRZWNER_PRESNATN_DE");
  const contract = get("CNTRCT_CNCLS_BGNDE");
  return {
    special: range(get("SPSPLY_RCEPT_BGNDE"), get("SPSPLY_RCEPT_ENDDE")),
    rank1: r1.all,
    rank1Areas: r1.areas,
    rank2: r2.all,
    rank2Areas: r2.areas,
    winner: isDate(winner) ? winner : null,
    contract: isDate(contract) ? contract : null,
  };
}

// ───────────────────────── .ics 만들기 ─────────────────────────

export const CALENDAR_SETTINGS = {
  timeZone: "Asia/Seoul",
  utcOffsetHours: 9, // 한국은 서머타임이 없어 늘 UTC+9
  alarmHour: 9, // 하루 전 오전 9시 알림
  titlePrefix: "[청약핏]",
};

type CalEvent = { key: string; label: string; range: DateRange; memo?: string };

/** 값이 있는 일정만 골라 순서대로 */
export function scheduleEvents(s: NoticeSchedule): CalEvent[] {
  const one = (d: string | null): DateRange | null => (d ? { start: d, end: d } : null);
  const list: (CalEvent | null)[] = [
    s.special && { key: "special", label: "특별공급 접수", range: s.special },
    s.rank1 && { key: "rank1", label: "1순위 접수", range: s.rank1, memo: s.rank1Areas.join(", ") },
    s.rank2 && { key: "rank2", label: "2순위 접수", range: s.rank2, memo: s.rank2Areas.join(", ") },
    one(s.winner) && { key: "winner", label: "당첨자 발표", range: one(s.winner)! },
    one(s.contract) && { key: "contract", label: "계약 시작", range: one(s.contract)! },
  ];
  return list.filter((e): e is CalEvent => e !== null);
}

const ymd = (s: string) => s.replaceAll("-", "");

function addDays(s: string, n: number): string {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 일정 시작 하루 전 한국시간 오전 9시를 UTC로 ("20261115T000000Z") */
function alarmUtc(start: string): string {
  const { alarmHour, utcOffsetHours } = CALENDAR_SETTINGS;
  const [y, m, d] = start.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1, alarmHour - utcOffsetHours));
  return t.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** iCalendar 글자 규칙: \ ; , 줄바꿈 이스케이프 */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** 한 줄이 75바이트를 넘으면 접기 (한글은 3바이트라 글자 단위로 셈) */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // 이어지는 줄은 앞에 공백 1바이트
    if (bytes + b > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export type IcsNotice = { houseManageNo: string; name: string; url: string | null; schedule: NoticeSchedule };

/** 공고 하나의 일정을 .ics 글자로. 일정이 하나도 없으면 null */
export function buildIcs(n: IcsNotice, now = new Date()): string | null {
  const events = scheduleEvents(n.schedule);
  if (!events.length) return null;
  const { timeZone, titlePrefix } = CALENDAR_SETTINGS;
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const link = n.url ?? "https://www.applyhome.co.kr";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//chungyakfit//ko",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(`${titlePrefix} ${n.name}`)}`,
    `X-WR-TIMEZONE:${timeZone}`,
    // 한국 표준시 정의 (서머타임 없음)
    "BEGIN:VTIMEZONE",
    `TZID:${timeZone}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0900",
    "TZOFFSETTO:+0900",
    "TZNAME:KST",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
  for (const e of events) {
    const title = `${titlePrefix} ${n.name} ${e.label}`;
    const memo = [e.memo ? `일정: ${e.memo}` : "", `청약홈 공고: ${link}`].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${n.houseManageNo}-${e.key}@chungyakfit`,
      `DTSTAMP:${stamp}`,
      // 하루 종일 일정 (끝나는 날은 다음 날로 적는 것이 규칙)
      `DTSTART;VALUE=DATE:${ymd(e.range.start)}`,
      `DTEND;VALUE=DATE:${ymd(addDays(e.range.end, 1))}`,
      `SUMMARY:${esc(title)}`,
      `DESCRIPTION:${esc(memo)}`,
      `URL:${link}`,
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(title)}`,
      `TRIGGER;VALUE=DATE-TIME:${alarmUtc(e.range.start)}`,
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** 브라우저에서 .ics 파일 내려받기 (서버에 보내지 않음) */
export function downloadIcs(n: IcsNotice): boolean {
  const text = buildIcs(n);
  if (!text) return false;
  const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `chungyakfit-${n.houseManageNo}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return true;
}
