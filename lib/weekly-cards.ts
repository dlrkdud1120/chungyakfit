/**
 * 홈 "이번 주 청약 소식" 팝업의 카드 만들기 (화면 공용, 저장·계산 로직 변경 없음)
 *
 * 기준 주간은 한국시간 월요일~일요일입니다.
 * 카드는 아래 순서로 만들고(design/popup 시안 4장 + 내 카드 2장), 보여줄 내용이 없는 카드는 빼고 돌려줍니다.
 *   1. 이번 주 청약 일정 (요일별, 무순위 포함)   2. 이번 주 주목할 단지   3. 지난주 당첨 결과
 *   4. 내 점수 맞춤(저장된 가점이 있을 때)   5. 내 관심 공고(로그인 + 관심 공고)   6. 청약 상식
 * 판정은 lib/judge.ts 결과(verdicts)를 받아 세기만 하고, 숫자는 API·CSV·저장값에 있는 것만 씁니다. 없는 값은 빼거나 숨깁니다.
 */

import type { Notice, RemndrNotice } from "./applyhome";
import { scheduleEvents } from "./calendar";
import { rateShort } from "./competition";
import type { Complex } from "./complexes";
import { growthStage } from "./growth";
import type { Verdict } from "./judge";
import { lotteryRatio, percent } from "./lottery";
import { favoriteFromNotice, type Favorite } from "./meTypes";
import type { MyHome } from "./myHome";
import type { SavedScore } from "./myScore";
import { addDays, daysBetween, ddayText, md, nextEvent } from "./mySchedule";
import { areaOf, bandOf, type PastRow } from "./similar";

export const WEEKLY_SETTINGS = {
  featuredMax: 3, // 이번 주 주목할 단지 최대 개수
  priceChipsMax: 3, // 단지마다 보여줄 타입별 분양가 개수
  resultsMax: 4, // 지난주 당첨 결과 최대 줄 수
  listMax: 3, // 내 점수 맞춤·관심 공고 목록 최대 개수
};

// ───────────────────────── 카드 모양 ─────────────────────────

/** 목록 한 줄 (내 점수 맞춤·관심 공고) */
export type CardRow = {
  key: string;
  lead?: string; // 왼쪽 작은 글자
  title: string;
  sub?: string;
  right?: string;
  rightTone?: "ok" | "accent" | "bad" | "muted";
  href?: string;
  external?: boolean; // 청약홈 등 바깥 주소
};

export type ScheduleTag = "특별공급" | "1순위" | "무순위" | "당첨발표";

export type ScheduleItem = {
  key: string;
  tag: ScheduleTag;
  name: string;
  sub: string; // 지역 · 기간
  href: string;
  external: boolean; // 무순위는 청약홈 공고로
  capped: boolean; // 분양가상한제 (API 값이 Y일 때만)
};

export type ScheduleDay = { date: string; dow: string; md: string; items: ScheduleItem[] };

export type FeaturedItem = {
  no: string;
  name: string;
  region: string;
  unit: string;
  address: string;
  dates: string; // "접수 11.24 · 발표 12.1" (있는 값만)
  chips: string[]; // "59타입 최고 4.2억", "추첨 60%"
  capped: boolean;
  href: string;
};

export type ResultRow = { key: string; name: string; type: string; min: number; rate: string | null; href: string };

type CardBase = { label: string; title: string; all: { href: string; text: string } };

export type WeeklyCard = CardBase &
  (
    | { id: "schedule"; range: string; days: ScheduleDay[]; defaultDay: string }
    | { id: "featured"; items: FeaturedItem[]; more?: string }
    | { id: "results"; intro: string; rows: ResultRow[]; more?: string }
    | { id: "mine" | "favorites"; intro?: string; rows: CardRow[] }
    | { id: "tip"; body: string; link: { href: string; text: string } }
  );

export type Tip = { title: string; body: string };

export type WeeklyInput = {
  today: string; // "YYYY-MM-DD" (한국시간)
  notices: Notice[] | null; // /api/notices 또는 주차별 파일 (실패하면 null)
  remndr: RemndrNotice[] | null; // /api/remndr-notices 또는 주차별 파일 (실패하면 null)
  history: Complex[] | null; // 과거 당첨가점 (API가 실패해 CSV로 대신하는 경우는 null)
  csv: Complex[]; // data/complexes.csv (가점제·추첨제 세대수가 적힌 단지만 추첨 비율 계산)
  score: SavedScore | null;
  home: MyHome;
  verdicts: Record<string, Verdict | null> | null; // 이번 주 공고별 내 판정 (불러오는 중이면 null)
  favorites: Favorite[] | null; // 로그인하지 않았으면 null
  tips: Tip[];
  tipIndex?: number; // 주차별 파일에 적힌 이번 주 팁 번호 (없으면 날짜로 계산)
};

// ───────────────────────── 주차별 파일 (data/weekly/2026-W48.json) ─────────────────────────

/**
 * 매주 GitHub Actions(scripts/weekly-data.ts)가 만드는 파일 모양
 * 팝업은 이번 주 파일이 있으면 공고 API를 부르지 않고 이 파일을 씁니다.
 */
export type WeeklyFile = {
  week: string; // "2026-W48"
  start: string; // 월요일
  end: string; // 일요일
  generatedAt: string;
  tipIndex: number;
  notices: Notice[]; // 이번 주 일정이 있거나 지난주 당첨자 발표가 있는 공고
  remndr: RemndrNotice[]; // 이번 주 접수하는 무순위·잔여세대
  lastWeekRows: PastRow[]; // 지난주 당첨자 발표 공고의 당첨가점 (거주 구분별)
};

/** 이번 주(한국시간)에 맞는 파일만 고름. 없으면 null → API를 직접 부름 */
export function pickWeeklyFile(files: WeeklyFile[], today: string): WeeklyFile | null {
  const { start } = weekOf(today);
  return files.find((f) => f.start === start) ?? null;
}

/** ISO 주차 이름 ("2026-W48"). 그 주의 목요일이 속한 해를 씀 */
export function isoWeekId(today: string): string {
  const thu = addDays(weekOf(today).start, 3);
  const year = Number(thu.slice(0, 4));
  const week = Math.floor(daysBetween(`${year}-01-01`, thu) / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** 이번 주 팁 번호 (주마다 하나씩 차례로) */
export function tipIndexFor(today: string, count: number): number {
  if (count <= 0) return 0;
  const weekNo = Math.floor(daysBetween("1970-01-05", weekOf(today).start) / 7); // 1970-01-05는 월요일
  return ((weekNo % count) + count) % count;
}

// ───────────────────────── 주간 계산 ─────────────────────────

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function dowOf(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export type Week = { start: string; end: string };

/** 한국시간 기준 이번 주 월요일~일요일 */
export function weekOf(today: string): Week {
  const back = (dowOf(today) + 6) % 7; // 월요일까지 며칠 전인지
  const start = addDays(today, -back);
  return { start, end: addDays(start, 6) };
}

export const lastWeekOf = (today: string): Week => weekOf(addDays(weekOf(today).start, -7));

const overlaps = (w: Week, start: string | null, end: string | null) => !!start && start <= w.end && (end ?? start) >= w.start;
const inWeek = (w: Week, d: string | null) => !!d && d >= w.start && d <= w.end;
const dayText = (d: string) => `${md(d)}(${DOW[dowOf(d)]})`;
const norm = (s: string) => s.replace(/\s+/g, "");
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const noticeHref = (no: string) => `/notice?no=${encodeURIComponent(no)}`;
const capped = (n: Notice) => n.regulations?.["분양가상한제"] === true;

/** 이번 주에 특별공급·1순위 접수가 걸친 공고 (주목할 단지·내 점수 맞춤 대상) */
export function noticesReceivingThisWeek(notices: Notice[], today: string): Notice[] {
  const w = weekOf(today);
  return notices.filter((n) => {
    const s = n.schedule;
    return overlaps(w, s.special?.start ?? null, s.special?.end ?? null) || overlaps(w, s.rank1?.start ?? null, s.rank1?.end ?? null);
  });
}

/**
 * 판정에 쓰는 /api/similar 주소 조건 (분양 공고 목록의 판정과 같은 조건)
 * 판정할 수 없는 공고(APT가 아님, 주택형 없음, 거주지 없음)는 null
 */
export function similarQuery(n: Notice, home: MyHome): string | null {
  if (n.kind !== "APT" || !home.sido) return null;
  const fav = favoriteFromNotice(n);
  const area = fav.houseTy ? areaOf(fav.houseTy) : null;
  if (area === null || !fav.sido || !fav.unit) return null;
  return new URLSearchParams({
    sido: fav.sido,
    unit: fav.unit,
    band: bandOf(area),
    homeSido: home.sido,
    homeUnit: home.unit,
    exclude: n.houseManageNo,
  }).toString();
}

// ───────────────────────── 카드 만들기 ─────────────────────────

export function buildWeeklyCards(i: WeeklyInput): WeeklyCard[] {
  return [scheduleCard(i), featuredCard(i), resultsCard(i), mineCard(i), favoritesCard(i), tipCard(i)].filter(
    (c): c is WeeklyCard => c !== null,
  );
}

export type WeekEvent = ScheduleItem & { date: string; order: number };

const TAG_ORDER: Record<ScheduleTag, number> = { 특별공급: 0, "1순위": 1, 무순위: 2, 당첨발표: 3 };

/** 이번 주 특별공급·1순위 접수, 당첨자 발표 일정 (날짜순). 주간 자동화의 점검에도 씀 */
export function weekScheduleEvents(notices: Notice[], today: string): WeekEvent[] {
  const w = weekOf(today);
  const events: WeekEvent[] = [];
  for (const n of notices) {
    for (const e of scheduleEvents(n.schedule)) {
      if (e.key !== "special" && e.key !== "rank1" && e.key !== "winner") continue;
      if (!overlaps(w, e.range.start, e.range.end)) continue;
      const tag: ScheduleTag = e.key === "special" ? "특별공급" : e.key === "rank1" ? "1순위" : "당첨발표";
      const span = e.range.start === e.range.end ? "" : `${md(e.range.start)}~${md(e.range.end)}`;
      events.push({
        key: `${n.houseManageNo}-${e.key}`,
        date: e.range.start < w.start ? w.start : e.range.start,
        order: TAG_ORDER[tag],
        tag,
        name: n.name,
        sub: [`${n.region} ${n.unit}`.trim(), span].filter(Boolean).join(" · "),
        href: noticeHref(n.houseManageNo),
        external: false,
        capped: capped(n),
      });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.name.localeCompare(b.name, "ko"));
}

/** 1. 이번 주 청약 일정: 요일 칸별 목록 (특별공급·1순위·당첨자 발표 + 무순위 접수) */
function scheduleCard({ notices, remndr, today }: WeeklyInput): WeeklyCard | null {
  if (!notices && !remndr) return null;
  const w = weekOf(today);
  const events: WeekEvent[] = weekScheduleEvents(notices ?? [], today);
  for (const r of remndr ?? []) {
    if (!overlaps(w, r.receiptStart, r.receiptEnd)) continue;
    const end = r.receiptEnd ?? r.receiptStart!;
    events.push({
      key: `r-${r.houseManageNo}`,
      date: r.receiptStart! < w.start ? w.start : r.receiptStart!,
      order: TAG_ORDER["무순위"],
      tag: "무순위",
      name: r.name,
      sub: [`${r.region} ${r.unit}`.trim(), r.kind, r.receiptStart !== end ? `${md(r.receiptStart!)}~${md(end)}` : ""].filter(Boolean).join(" · "),
      href: r.url ?? "/notice",
      external: !!r.url,
      capped: false, // 무순위 API에는 분양가상한제 값이 없음
    });
  }
  if (!events.length) return null;
  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.name.localeCompare(b.name, "ko"));

  // 월~금은 늘 보이고, 토·일은 일정이 있을 때만
  const days: ScheduleDay[] = Array.from({ length: 7 }, (_, i) => addDays(w.start, i))
    .map((date) => ({ date, dow: DOW[dowOf(date)], md: md(date), items: events.filter((e) => e.date === date) }))
    .filter((d, i) => i < 5 || d.items.length > 0);
  const last = days[days.length - 1].date;
  const defaultDay =
    days.find((d) => d.date === today && d.items.length)?.date ?? days.find((d) => d.date >= today && d.items.length)?.date ?? days.find((d) => d.items.length)!.date;

  return {
    id: "schedule",
    label: "THIS WEEK",
    title: "이번 주 청약 일정",
    range: `${dayText(w.start)} ~ ${dayText(last)} · 총 ${events.length}건`,
    days,
    defaultDay,
    all: { href: "/notice", text: "분양 공고 전체 보기" },
  };
}

/** 타입별 최고 분양가: 전용면적 정수(59, 84…)로 묶어 그중 가장 높은 값 (API의 분양 최고가, 만원) */
function priceChips(n: Notice): string[] {
  const byArea = new Map<number, number>();
  for (const t of n.types) {
    const area = areaOf(t.type);
    if (area === null || t.topAmount === null || t.topAmount <= 0) continue;
    const a = Math.floor(area);
    byArea.set(a, Math.max(byArea.get(a) ?? 0, t.topAmount));
  }
  return [...byArea]
    .sort((a, b) => a[0] - b[0])
    .slice(0, WEEKLY_SETTINGS.priceChipsMax)
    .map(([a, v]) => `${a}타입 최고 ${(v / 10000).toFixed(1)}억`);
}

/** 2. 이번 주 주목할 단지: 이번 주 특별공급·1순위 접수 공고 (접수가 빠른 순) */
function featuredCard({ notices, csv, today }: WeeklyInput): WeeklyCard | null {
  if (!notices) return null;
  const receiptOf = (n: Notice) => [n.schedule.special?.start, n.schedule.rank1?.start].filter((d): d is string => !!d).sort()[0] ?? null;
  const list = noticesReceivingThisWeek(notices, today).sort((a, b) => (receiptOf(a) ?? "").localeCompare(receiptOf(b) ?? ""));
  if (!list.length) return null;

  // 추첨 비율은 CSV에 가점제·추첨제 세대수를 적어 둔 단지만 (청약홈 API에는 없음)
  const byName = new Map(csv.map((c) => [norm(c.name), c]));
  const items: FeaturedItem[] = list.map((n) => {
    const receipt = receiptOf(n);
    const winner = n.schedule.winner;
    const ratios = (byName.get(norm(n.name))?.types ?? []).map(lotteryRatio).filter((r): r is number => r !== null && r > 0);
    return {
      no: n.houseManageNo,
      name: n.name,
      region: n.region,
      unit: n.unit,
      address: n.address,
      dates: [receipt ? `접수 ${md(receipt)}` : "", winner ? `발표 ${md(winner)}` : ""].filter(Boolean).join(" · "),
      chips: [...priceChips(n), ...(ratios.length ? [`추첨 최대 ${percent(Math.max(...ratios))}`] : [])],
      capped: capped(n),
      href: noticeHref(n.houseManageNo),
    };
  });
  const max = WEEKLY_SETTINGS.featuredMax;
  return {
    id: "featured",
    label: "THIS WEEK",
    title: "이번 주 주목할 단지",
    items: items.slice(0, max),
    more: items.length > max ? `외 ${items.length - max}곳` : undefined,
    all: { href: "/notice", text: "분양 공고 전체 보기" },
  };
}

/** 3. 지난주 당첨 결과: 지난주 당첨자 발표 단지의 최저 당첨가점과 경쟁률 */
function resultsCard({ notices, history, today }: WeeklyInput): WeeklyCard | null {
  if (!notices || !history) return null;
  const lw = lastWeekOf(today);
  const byId = new Map(history.map((c) => [c.id, c]));
  const rows: ResultRow[] = [];
  for (const n of notices.filter((n) => inWeek(lw, n.schedule.winner)).sort((a, b) => a.schedule.winner!.localeCompare(b.schedule.winner!))) {
    const c = byId.get(n.houseManageNo);
    // 당첨가점이 있는 주택형 중 공급(1순위 경쟁률 기준)이 가장 많은 주택형 하나
    const t = c?.types.filter((t) => t.min !== null).sort((a, b) => (b.cmpet?.supply ?? 0) - (a.cmpet?.supply ?? 0))[0];
    if (!c || !t) continue;
    const rate = t.cmpet ? rateShort(t.cmpet) : null;
    rows.push({
      key: n.houseManageNo,
      name: c.name,
      type: t.type,
      min: t.min!,
      rate: rate && rate !== "–" ? rate : null,
      href: `/compare?${new URLSearchParams({ id: c.id, t: t.type })}`,
    });
  }
  if (!rows.length) return null;
  const max = WEEKLY_SETTINGS.resultsMax;
  return {
    id: "results",
    label: "RESULT",
    title: "지난주 당첨 결과",
    intro: `${dayText(lw.start)} ~ ${dayText(lw.end)} 발표 · 내 거주 구분 기준`,
    rows: rows.slice(0, max),
    more: rows.length > max ? `외 ${rows.length - max}곳` : undefined,
    all: { href: "/compare", text: "단지 비교 전체 보기" },
  };
}

/** 4. 내 점수 맞춤 (저장된 가점이 있을 때만) */
function mineCard({ score, home, notices, verdicts, today }: WeeklyInput): WeeklyCard | null {
  if (!score) return null;
  const stage = growthStage(score.total);
  const rows: CardRow[] = [];
  let intro = `내 점수 ${fmt(score.total)}점 · 성장 단계 ${stage.name}`;

  if (!home.sido) {
    rows.push({ key: "home", title: "거주지를 정하면 이번 주 공고의 판정을 볼 수 있어요.", href: "/check", right: "가능성 확인 →", rightTone: "muted" });
  } else if (notices) {
    const targets = noticesReceivingThisWeek(notices, today).filter((n) => similarQuery(n, home) !== null);
    if (verdicts === null) {
      if (targets.length) rows.push({ key: "loading", title: "이번 주 공고의 판정을 불러오는 중…" });
    } else {
      const picks = targets
        .map((n) => ({ n, v: verdicts[n.houseManageNo] ?? null }))
        .filter((x): x is { n: Notice; v: Verdict } => x.v === "안정" || x.v === "도전")
        .sort((a, b) => (a.v === b.v ? 0 : a.v === "안정" ? -1 : 1));
      const ok = picks.filter((p) => p.v === "안정").length;
      intro += ` · 이번 주 안정 ${ok}곳, 도전 ${picks.length - ok}곳`;
      for (const { n, v } of picks.slice(0, WEEKLY_SETTINGS.listMax)) {
        rows.push({
          key: n.houseManageNo,
          title: n.name,
          sub: `${n.region} ${n.unit}`.trim(),
          right: v,
          rightTone: v === "안정" ? "ok" : "accent",
          href: noticeHref(n.houseManageNo),
        });
      }
      if (!picks.length && targets.length) rows.push({ key: "none", title: "이번 주 공고 중 안정·도전인 단지가 없어요." });
    }
  }

  // 다음 성장 단계까지 남은 기간: 가점 계산에서 저장한 1년·3년 뒤 예상 점수로만 알려줌
  if (stage.next) {
    const nextFrom = score.total + stage.next.need;
    const reach = (score.future ?? []).filter((f) => f.total >= nextFrom).sort((a, b) => a.years - b.years)[0];
    const last = (score.future ?? []).at(-1);
    const sub = reach
      ? `저장한 예상 점수로 약 ${reach.years}년 뒤 (${fmt(reach.total)}점)`
      : last
        ? `저장한 ${last.years}년 뒤 예상 점수(${fmt(last.total)}점)로는 아직이에요`
        : "가점 계산에서 점수를 다시 저장하면 남은 기간을 알려 드려요";
    rows.push({ key: "growth", lead: "성장", title: `다음 단계 ${stage.next.name}까지 ${fmt(stage.next.need)}점`, sub });
  }

  return {
    id: "mine",
    label: "FOR ME",
    title: "내 점수 맞춤",
    intro,
    rows,
    all: { href: "/check", text: "가능성 확인 전체 보기" },
  };
}

/** 5. 내 관심 공고 (로그인 + 관심 공고가 있을 때만) */
function favoritesCard({ favorites, today }: WeeklyInput): WeeklyCard | null {
  if (!favorites?.length) return null;
  const rows = favorites
    .map((f) => ({ f, u: nextEvent(f.schedule, today) }))
    .filter((x): x is { f: Favorite; u: NonNullable<(typeof x)["u"]> } => x.u !== null)
    .sort((a, b) => a.u.start.localeCompare(b.u.start))
    .slice(0, WEEKLY_SETTINGS.listMax)
    .map(({ f, u }) => ({
      key: f.no,
      title: f.name,
      sub: `${f.sido} ${f.unit}`.trim(),
      right: ddayText(u),
      rightTone: (u.dday <= 0 ? "accent" : "muted") as CardRow["rightTone"],
      href: noticeHref(f.no),
    }));
  if (!rows.length) return null;
  return {
    id: "favorites",
    label: "MY LIST",
    title: "내 관심 공고",
    intro: "가장 가까운 일정 순",
    rows,
    all: { href: "/mypage", text: "마이페이지 전체 보기" },
  };
}

/** 6. 청약 상식 (주마다 하나씩 돌아가며) */
function tipCard({ tips, today, tipIndex }: WeeklyInput): WeeklyCard | null {
  if (!tips.length) return null;
  const tip = tips[tipIndex !== undefined && tipIndex >= 0 && tipIndex < tips.length ? tipIndex : tipIndexFor(today, tips.length)];
  return {
    id: "tip",
    label: "TIP",
    title: tip.title,
    body: tip.body,
    link: { href: "/eligibility", text: "부적격 점검하러 가기 →" },
    all: { href: "/score", text: "가점 계산 전체 보기" },
  };
}
