/**
 * 홈 "이번 주 청약 소식" 팝업의 카드 만들기 (화면 공용, 저장·계산 로직 변경 없음)
 *
 * 기준 주간은 한국시간 월요일~일요일입니다.
 * 카드는 아래 순서로 만들고, 보여줄 내용이 없는 카드는 빼고 돌려줍니다.
 *   1. 이번 주 청약 일정   2. 가점 없이 노려볼 만한 공고   3. 지난주 당첨 결과
 *   4. 내 점수 맞춤(저장된 가점이 있을 때)   5. 내 관심 공고(로그인 + 관심 공고)   6. 청약 상식
 * 판정은 lib/judge.ts 결과(verdicts)를 받아 세기만 하고, 숫자는 API·CSV·저장값에 있는 것만 씁니다.
 */

import type { Notice, RemndrNotice } from "./applyhome";
import { scheduleEvents } from "./calendar";
import { rateShort } from "./competition";
import type { Complex, HouseType } from "./complexes";
import { growthStage } from "./growth";
import type { Verdict } from "./judge";
import { lotteryRatio, percent } from "./lottery";
import { favoriteFromNotice, type Favorite } from "./meTypes";
import type { MyHome } from "./myHome";
import type { SavedScore } from "./myScore";
import { addDays, daysBetween, ddayText, md, nextEvent } from "./mySchedule";
import { areaOf, bandOf } from "./similar";

export const WEEKLY_SETTINGS = {
  scheduleMax: 6, // 이번 주 일정 최대 줄 수 (넘치면 "외 N건")
  listMax: 3, // 나머지 카드 목록 최대 개수
};

// ───────────────────────── 카드 모양 ─────────────────────────

export type CardTone = "brand" | "accent" | "beige";

export type CardRow = {
  key: string;
  lead?: string; // 왼쪽 작은 글자 (요일·날짜)
  title: string;
  sub?: string;
  right?: string;
  rightTone?: "ok" | "accent" | "bad" | "muted";
  href?: string;
  external?: boolean; // 청약홈 등 바깥 주소
};

export type WeeklyCard = {
  id: "schedule" | "lottery" | "results" | "mine" | "favorites" | "tip";
  tone: CardTone;
  label: string; // 맨 위 작은 분류 글자
  title: string;
  intro?: string; // 제목 아래 한 줄 설명
  rows: CardRow[];
  more?: string; // "외 N건"
  body?: string; // 청약 상식 본문
  extraLink?: { href: string; text: string };
  all: { href: string; text: string };
};

export type Tip = { title: string; body: string };

export type WeeklyInput = {
  today: string; // "YYYY-MM-DD" (한국시간)
  notices: Notice[] | null; // /api/notices (실패하면 null)
  remndr: RemndrNotice[] | null; // /api/remndr-notices (실패하면 null)
  history: Complex[] | null; // /api/complexes 과거 당첨가점 (API가 실패해 CSV로 대신하는 경우는 null)
  csv: Complex[]; // data/complexes.csv (가점제·추첨제 세대수가 적힌 단지만 추첨 비율 계산)
  score: SavedScore | null;
  home: MyHome;
  verdicts: Record<string, Verdict | null> | null; // 이번 주 공고별 내 판정 (불러오는 중이면 null)
  favorites: Favorite[] | null; // 로그인하지 않았으면 null
  tips: Tip[];
};

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
const dayText = (d: string) => `${DOW[dowOf(d)]} ${md(d)}`;
const norm = (s: string) => s.replace(/\s+/g, "");
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const noticeHref = (no: string) => `/notice?no=${encodeURIComponent(no)}`;

/** 이번 주에 특별공급·1순위 접수가 걸친 공고 (내 점수 맞춤 판정 대상) */
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
  return [scheduleCard(i), lotteryCard(i), resultsCard(i), mineCard(i), favoritesCard(i), tipCard(i)].filter(
    (c): c is WeeklyCard => c !== null,
  );
}

/** 1. 이번 주 청약 일정 */
function scheduleCard({ notices, today }: WeeklyInput): WeeklyCard | null {
  if (!notices) return null;
  const w = weekOf(today);
  const events: (CardRow & { date: string; order: number })[] = [];
  for (const n of notices) {
    for (const e of scheduleEvents(n.schedule)) {
      if (e.key !== "special" && e.key !== "rank1" && e.key !== "winner") continue;
      if (!overlaps(w, e.range.start, e.range.end)) continue;
      const date = e.range.start < w.start ? w.start : e.range.start;
      const span = e.range.start === e.range.end ? "" : ` (${md(e.range.start)}~${md(e.range.end)})`;
      events.push({
        key: `${n.houseManageNo}-${e.key}`,
        date,
        order: e.key === "special" ? 0 : e.key === "rank1" ? 1 : 2,
        lead: dayText(date),
        title: n.name,
        sub: `${e.label}${span} · ${n.region} ${n.unit}`.trim(),
        href: noticeHref(n.houseManageNo),
      });
    }
  }
  if (!events.length) return null;
  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.title.localeCompare(b.title, "ko"));
  const max = WEEKLY_SETTINGS.scheduleMax;
  return {
    id: "schedule",
    tone: "brand",
    label: "THIS WEEK",
    title: "이번 주 청약 일정",
    intro: `${md(w.start)}(월) ~ ${md(w.end)}(일) 서울·경기`,
    rows: events.slice(0, max),
    more: events.length > max ? `외 ${events.length - max}건` : undefined,
    all: { href: "/notice", text: "분양 공고 전체 보기" },
  };
}

/** 2. 가점 없이 노려볼 만한 공고: 이번 주 무순위·잔여세대 접수 + 추첨제 비율이 높은 주택형 */
function lotteryCard({ notices, remndr, csv, today }: WeeklyInput): WeeklyCard | null {
  const w = weekOf(today);
  const rows: CardRow[] = [];

  for (const r of (remndr ?? [])
    .filter((r) => overlaps(w, r.receiptStart, r.receiptEnd))
    .sort((a, b) => (a.receiptStart ?? "").localeCompare(b.receiptStart ?? ""))) {
    rows.push({
      key: `r-${r.houseManageNo}`,
      lead: dayText(r.receiptStart! < w.start ? w.start : r.receiptStart!),
      title: r.name,
      sub: [r.kind, `${r.region} ${r.unit}`.trim(), r.supply !== null ? `${r.supply}세대` : ""].filter(Boolean).join(" · "),
      href: r.url ?? undefined,
      external: !!r.url,
    });
  }

  // 추첨 비율은 CSV에 가점제·추첨제 세대수를 적어 둔 단지만 계산됩니다 (청약홈 API에는 없음)
  const byName = new Map(csv.map((c) => [norm(c.name), c]));
  const lottery: { n: Notice; t: HouseType; ratio: number }[] = [];
  for (const n of noticesReceivingThisWeek(notices ?? [], today)) {
    const c = byName.get(norm(n.name));
    for (const t of c?.types ?? []) {
      const ratio = lotteryRatio(t);
      if (ratio !== null && ratio > 0) lottery.push({ n, t, ratio });
    }
  }
  lottery.sort((a, b) => b.ratio - a.ratio);
  for (const { n, t, ratio } of lottery) {
    rows.push({
      key: `l-${n.houseManageNo}-${t.type}`,
      title: `${n.name} ${t.type}`,
      sub: `${n.region} ${n.unit}`.trim(),
      right: `추첨 ${percent(ratio)}`,
      rightTone: "accent",
      href: noticeHref(n.houseManageNo),
    });
  }

  if (!rows.length) return null;
  return {
    id: "lottery",
    tone: "accent",
    label: "NO SCORE NEEDED",
    title: "가점 없이 노려볼 만한 공고",
    intro: "무순위·잔여세대는 가점이 아니라 추첨으로 뽑아요. 자격은 공고문에서 확인하세요.",
    rows: rows.slice(0, WEEKLY_SETTINGS.listMax),
    more: rows.length > WEEKLY_SETTINGS.listMax ? `외 ${rows.length - WEEKLY_SETTINGS.listMax}건` : undefined,
    all: { href: "/notice", text: "분양 공고 전체 보기" },
  };
}

/** 3. 지난주 당첨 결과: 지난주 당첨자 발표 단지의 최저 당첨가점과 경쟁률 */
function resultsCard({ notices, history, today }: WeeklyInput): WeeklyCard | null {
  if (!notices || !history) return null;
  const lw = lastWeekOf(today);
  const byId = new Map(history.map((c) => [c.id, c]));
  const rows: CardRow[] = [];
  for (const n of notices.filter((n) => inWeek(lw, n.schedule.winner)).sort((a, b) => a.schedule.winner!.localeCompare(b.schedule.winner!))) {
    const c = byId.get(n.houseManageNo);
    // 당첨가점이 있는 주택형 중 공급(1순위 경쟁률 기준)이 가장 많은 주택형 하나
    const t = c?.types
      .filter((t) => t.min !== null)
      .sort((a, b) => (b.cmpet?.supply ?? 0) - (a.cmpet?.supply ?? 0))[0];
    if (!c || !t) continue;
    const rate = t.cmpet ? rateShort(t.cmpet) : null;
    rows.push({
      key: n.houseManageNo,
      title: `${c.name} ${t.type}`,
      sub: [`${md(n.schedule.winner!)} 발표`, `${c.sido} ${c.sigungu}`.trim(), rate && rate !== "–" ? `경쟁률 ${rate}` : ""].filter(Boolean).join(" · "),
      right: `최저 ${fmt(t.min!)}점`,
      href: `/compare?${new URLSearchParams({ id: c.id, t: t.type })}`,
    });
  }
  if (!rows.length) return null;
  return {
    id: "results",
    tone: "beige",
    label: "LAST WEEK",
    title: "지난주 당첨 결과",
    intro: `${md(lw.start)}(월) ~ ${md(lw.end)}(일) 발표 · 내 거주 구분 기준 당첨가점`,
    rows: rows.slice(0, WEEKLY_SETTINGS.listMax),
    more: rows.length > WEEKLY_SETTINGS.listMax ? `외 ${rows.length - WEEKLY_SETTINGS.listMax}건` : undefined,
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
    tone: "brand",
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
    tone: "accent",
    label: "MY LIST",
    title: "내 관심 공고",
    intro: "가장 가까운 일정 순",
    rows,
    all: { href: "/mypage", text: "마이페이지 전체 보기" },
  };
}

/** 6. 청약 상식 (주마다 하나씩 돌아가며) */
function tipCard({ tips, today }: WeeklyInput): WeeklyCard | null {
  if (!tips.length) return null;
  const weekNo = Math.floor(daysBetween("1970-01-05", weekOf(today).start) / 7); // 1970-01-05는 월요일
  const tip = tips[((weekNo % tips.length) + tips.length) % tips.length];
  return {
    id: "tip",
    tone: "beige",
    label: "청약 상식",
    title: tip.title,
    rows: [],
    body: tip.body,
    extraLink: { href: "/eligibility", text: "부적격 점검하러 가기 →" },
    all: { href: "/score", text: "가점 계산 전체 보기" },
  };
}
