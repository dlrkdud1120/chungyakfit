/**
 * 지도로 찾기 (/map) — 공고를 지도 한 점으로 바꾸고, 일정 상태·필터·정렬을 정하는 규칙 (화면·서버 공용, 저장 없음)
 *
 * 공고 데이터는 분양 공고 화면과 같은 청약홈 분양정보 + 무순위·잔여세대 공고입니다.
 * 판정은 lib/judge.ts 결과를 받아 색만 정하고, 계산·판정 규칙은 바꾸지 않습니다.
 */

import type { Notice, NoticeType, RemndrNotice } from "./applyhome";
import { scheduleEvents } from "./calendar";
import type { Verdict } from "./judge";
import { daysBetween, md } from "./mySchedule";

export type Coord = { lat: number; lng: number };

/** /api/map-items 응답의 한 줄 (좌표는 카카오 결과라 저장하지 않고 응답으로만 받음) */
export type MapNotice = (Notice & { source: "apt" }) | (RemndrNotice & { source: "remndr" });
export type MapItemsResponse =
  | { ok: true; items: (MapNotice & { coord: Coord | null })[]; fetchedAt: string }
  | { ok: false; reason: string };

export type MapEvent = { key: string; label: string; short: string; start: string; end: string; receipt: boolean };

export type Category = "민영" | "공공" | "무순위";
export type Status = "접수 중" | "접수 예정" | "발표 대기" | "마감";

export type MapItem = {
  id: string;
  source: "apt" | "remndr";
  name: string;
  region: string;
  unit: string;
  address: string;
  category: Category;
  events: MapEvent[];
  status: Status;
  next: { label: string; short: string; start: string; end: string; dday: number } | null;
  capped: boolean; // 분양가상한제 (청약홈 값이 Y일 때만)
  types: NoticeType[];
  url: string | null;
  notice: Notice | null; // 일반 분양 공고 원본 (판정·관심 공고용)
  coord: Coord | null;
};

const SHORT: Record<string, string> = { special: "특공", rank1: "1순위", rank2: "2순위", winner: "발표", contract: "계약", receipt: "접수" };

function eventsOf(n: MapNotice): MapEvent[] {
  if (n.source === "apt") {
    return scheduleEvents(n.schedule).map((e) => ({
      key: e.key,
      label: e.label,
      short: SHORT[e.key] ?? e.label,
      start: e.range.start,
      end: e.range.end,
      receipt: e.key === "special" || e.key === "rank1" || e.key === "rank2" || e.key === "receipt",
    }));
  }
  const list: MapEvent[] = [];
  if (n.receiptStart) list.push({ key: "receipt", label: `${n.kind || "무순위"} 접수`, short: "접수", start: n.receiptStart, end: n.receiptEnd ?? n.receiptStart, receipt: true });
  if (n.winnerDate) list.push({ key: "winner", label: "당첨자 발표", short: "발표", start: n.winnerDate, end: n.winnerDate, receipt: false });
  return list;
}

/** 일정 상태: 접수 중 > 접수 예정 > 발표 대기 > 마감 */
export function statusOf(events: MapEvent[], today: string): Status {
  const receipts = events.filter((e) => e.receipt);
  if (receipts.some((e) => e.start <= today && e.end >= today)) return "접수 중";
  if (receipts.some((e) => e.start > today)) return "접수 예정";
  if (events.some((e) => e.key === "winner" && e.end >= today)) return "발표 대기";
  return "마감";
}

/** 일반 분양 공고 한 건의 일정 상태 (분양 공고 목록 필터와 같은 규칙) */
export const noticeStatus = (n: Notice, today: string): Status => statusOf(eventsOf({ ...n, source: "apt" }), today);

/** 공급 구분: 민영 APT는 "민영", 국민주택·신혼희망타운 등은 "공공" (지도와 같은 규칙) */
export const noticeCategory = (n: Notice): Category => (n.remndr ? "무순위" : n.supplyKind === "민영" && n.kind === "APT" ? "민영" : "공공");

export function toMapItem(n: MapNotice & { coord: Coord | null }, today: string): MapItem {
  const events = eventsOf(n);
  const upcoming = events.filter((e) => e.end >= today).sort((a, b) => a.start.localeCompare(b.start))[0];
  const isApt = n.source === "apt";
  return {
    id: n.houseManageNo,
    source: n.source,
    name: n.name,
    region: n.region,
    unit: n.unit,
    address: n.address ?? "",
    category: !isApt ? "무순위" : noticeCategory(n),
    events,
    status: statusOf(events, today),
    next: upcoming ? { label: upcoming.label, short: upcoming.short, start: upcoming.start, end: upcoming.end, dday: daysBetween(today, upcoming.start) } : null,
    capped: isApt && n.regulations?.["분양가상한제"] === true,
    types: n.types ?? [],
    url: n.url,
    notice: isApt ? n : null,
    coord: n.coord,
  };
}

/** 마커·목록의 다음 일정 한 줄: "1순위 D-3", "접수 D-day", "1순위 진행 중", "마감" */
export function nextText(it: MapItem): string {
  if (!it.next) return "마감";
  const { short, dday } = it.next;
  return dday > 0 ? `${short} D-${dday}` : dday === 0 ? `${short} D-day` : `${short} 진행 중`;
}

/** 목록용 긴 문장: "1순위 접수 D-3 (11.27)" */
export function nextLong(it: MapItem): string {
  if (!it.next) return "일정 마감";
  const { label, dday, start, end } = it.next;
  const when = start === end ? md(start) : `${md(start)}~${md(end)}`;
  return `${label} ${dday > 0 ? `D-${dday}` : dday === 0 ? "D-day" : "진행 중"} (${when})`;
}

/** 마커 말풍선 단지명: 최대 8자, 넘치면 말줄임 */
export const shortName = (s: string) => {
  const chars = [...s.replace(/\s+/g, " ").trim()];
  return chars.length > 8 ? `${chars.slice(0, 8).join("")}…` : chars.join("");
};

// ───────────────────────── 필터 ─────────────────────────

export type Filters = {
  status: ("접수 중" | "접수 예정" | "발표 대기")[]; // 비우면 전체
  hideClosed: boolean; // 마감 제외
  category: Category[]; // 비우면 전체
  verdict: Verdict[]; // 비우면 전체
};

export const EMPTY_FILTERS: Filters = { status: [], hideClosed: false, category: [], verdict: [] };

export function passes(it: MapItem, f: Filters, verdict: Verdict | null): boolean {
  if (f.hideClosed && it.status === "마감") return false;
  if (f.status.length && !f.status.includes(it.status as Filters["status"][number])) return false;
  if (f.category.length && !f.category.includes(it.category)) return false;
  if (f.verdict.length && (verdict === null || !f.verdict.includes(verdict))) return false;
  return true;
}

export const filterCount = (f: Filters) => f.status.length + (f.hideClosed ? 1 : 0) + f.category.length + f.verdict.length;

/** 다음 일정이 가까운 순 (진행 중이 먼저, 마감은 맨 뒤) */
export function byNext(a: MapItem, b: MapItem): number {
  if (!a.next || !b.next) return a.next ? -1 : b.next ? 1 : a.name.localeCompare(b.name, "ko");
  return a.next.start.localeCompare(b.next.start) || a.name.localeCompare(b.name, "ko");
}

export const VERDICT_HEX: Record<Verdict | "none", string> = { 안정: "#2e9e6a", 도전: "#f4a53f", 어려움: "#d9534f", none: "#9aa3a0" };

/** 타입별 분양 최고가 (만원 → 억, 소수 첫째 자리) */
export const eok = (manwon: number) => `${(manwon / 10000).toFixed(1)}억`;
