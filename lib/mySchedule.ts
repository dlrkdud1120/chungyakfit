/** 관심 공고의 다음 일정·D-day 계산 (화면 공용, 저장 없음) */

import { scheduleEvents, type NoticeSchedule } from "./calendar";

export const todayKST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

export function daysBetween(from: string, to: string): number {
  const t = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(to) - t(from)) / 86400000);
}

export function addDays(s: string, n: number): string {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export type Upcoming = { key: string; label: string; start: string; end: string; dday: number };

/** 아직 끝나지 않은 일정 중 가장 빠른 것 (없으면 null = 마감) */
export function nextEvent(s: NoticeSchedule | null, today: string): Upcoming | null {
  if (!s) return null;
  const e = scheduleEvents(s)
    .filter((x) => x.range.end >= today)
    .sort((a, b) => a.range.start.localeCompare(b.range.start))[0];
  return e ? { key: e.key, label: e.label, start: e.range.start, end: e.range.end, dday: daysBetween(today, e.range.start) } : null;
}

/** "1순위 접수 D-3", "당첨자 발표 D-day", "1순위 접수 진행 중" */
export function ddayText(u: Upcoming): string {
  if (u.dday > 0) return `${u.label} D-${u.dday}`;
  return u.dday === 0 ? `${u.label} D-day` : `${u.label} 진행 중`;
}

export const md = (s: string) => `${Number(s.slice(5, 7))}.${Number(s.slice(8, 10))}`;
