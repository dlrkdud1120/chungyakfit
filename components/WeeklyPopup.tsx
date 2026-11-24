"use client";

/**
 * 홈 화면 "이번 주 청약 소식" 팝업 (카드뉴스)
 *
 * - 홈(app/page.tsx)에서만 붙입니다. 카드 내용은 lib/weekly-cards.ts가 만들고, 이 파일은 보여주기만 합니다.
 * - 좌우로 넘김: 모바일 스와이프, PC 화살표 버튼과 키보드 ←→. 아래 점으로 현재 위치 표시.
 * - 닫기: X 버튼, "닫기", ESC, 바깥 영역 클릭. "오늘 하루 보지 않기"는 브라우저 저장소에 오늘 날짜를 적습니다.
 *   저장소를 못 쓰는 환경(시크릿 모드 등)에서는 저장만 건너뛰고 팝업은 그대로 동작합니다.
 * - 열려 있는 동안 키보드 포커스는 팝업 안에서만 돌고, 닫으면 원래 자리로 돌아갑니다.
 * - 동작 줄이기 설정이면 넘김 효과 없이 바로 바뀝니다 (globals.css의 step-next/step-prev가 그 설정을 따름).
 * - 보여줄 카드가 하나도 없으면 띄우지 않습니다.
 * - 이번 주 파일(data/weekly, 매주 GitHub Actions가 만듦)이 있으면 공고 API 대신 그 파일을 읽고, 없으면 API를 직접 부릅니다.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import tipsData from "@/data/tips.json";
import ComplexThumb from "@/components/ComplexThumb";
import { useMy } from "@/components/Providers";
import { loadSimilar } from "@/components/useNoticeVerdict";
import { historyToComplexes, type NoticeResult, type RemndrResult } from "@/lib/applyhome";
import type { Complex } from "@/lib/complexes";
import { judge, type Verdict } from "@/lib/judge";
import { parseMyHome, readMyHomeRaw, subscribeMyHome } from "@/lib/myHome";
import { parseMyScore, readMyScoreRaw, subscribeMyScore } from "@/lib/myScore";
import { todayKST } from "@/lib/mySchedule";
import { useComplexes } from "@/lib/useComplexes";
import {
  buildWeeklyCards,
  noticesReceivingThisWeek,
  pickWeeklyFile,
  similarQuery,
  type CardRow,
  type ScheduleTag,
  type Tip,
  type WeeklyCard,
  type WeeklyFile,
} from "@/lib/weekly-cards";

const HIDE_KEY = "chungyakfit:weeklyPopupHiddenOn"; // 값: "오늘 하루 보지 않기"를 누른 날 (YYYY-MM-DD)
const WAIT_MS = 10_000; // 공고를 이만큼 기다려도 안 오면 있는 카드만으로 띄움
const SWIPE_PX = 50;

const TIPS = (tipsData as { tips: Tip[] }).tips;

function hiddenToday(today: string): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === today;
  } catch {
    return false;
  }
}

function hideToday(today: string) {
  try {
    localStorage.setItem(HIDE_KEY, today);
  } catch {
    // 저장이 막혀도 팝업 닫기는 그대로
  }
}

const noSubscribe = () => () => {};

type Loaded<T> = { status: "loading" } | { status: "done"; value: T | null };

/**
 * 제목·요일 칸·라벨용 글꼴 (design/popup 시안).
 * "210 네버랜드" 파일(public/fonts/)이 아직 없어 기본 글꼴 굵게로 대신합니다.
 * 파일을 넣으면 next/font/local로 불러와(display: "swap") 이 값을 그 className으로 바꾸면 됩니다.
 * 단지명 목록·표·본문·안내 문구는 기본 글꼴 보통 굵기 그대로입니다.
 */
const DISPLAY = "font-bold";

const RIGHT_TONE: Record<NonNullable<CardRow["rightTone"]>, string> = {
  ok: "text-ok font-semibold",
  accent: "text-accent-dark font-semibold",
  bad: "text-bad font-semibold",
  muted: "text-muted",
};

export default function WeeklyPopup({
  csv,
  weekly,
}: {
  csv: Complex[];
  weekly: WeeklyFile[];
}) {
  // 날짜와 "오늘 하루 보지 않기" 여부는 브라우저에서만 읽음 (서버에서 그릴 때는 null → 팝업 없음)
  const clientToday = useSyncExternalStore(noSubscribe, todayKST, () => null);
  const today = clientToday ?? "";
  const blocked = useSyncExternalStore(
    noSubscribe,
    () => hiddenToday(todayKST()),
    () => null,
  );
  const [closed, setClosed] = useState(false);
  const [notices, setNotices] = useState<Loaded<NoticeResult & { ok: true }>>({
    status: "loading",
  });
  const [remndr, setRemndr] = useState<Loaded<RemndrResult & { ok: true }>>({
    status: "loading",
  });
  const [timedOut, setTimedOut] = useState(false);
  const [verdicts, setVerdicts] = useState<{
    key: string;
    map: Record<string, Verdict | null>;
  } | null>(null);

  const scoreRaw = useSyncExternalStore(subscribeMyScore, readMyScoreRaw, () => null);
  const homeRaw = useSyncExternalStore(subscribeMyHome, readMyHomeRaw, () => null);
  const score = useMemo(() => parseMyScore(scoreRaw), [scoreRaw]);
  const home = useMemo(() => parseMyHome(homeRaw), [homeRaw]);
  const cs = useComplexes(csv);
  const my = useMy();

  // 매주 자동으로 만든 이번 주 파일이 있으면 공고 API를 부르지 않고 그 파일을 씀
  const file = useMemo(() => (today ? pickWeeklyFile(weekly, today) : null), [weekly, today]);
  const hasFile = file !== null;

  // 공고 불러오기 (보지 않기로 한 날은 부르지 않음)
  useEffect(() => {
    if (blocked !== false || !today || hasFile) return;
    let alive = true;
    fetch("/api/notices")
      .then((r) => r.json() as Promise<NoticeResult>)
      .catch((): NoticeResult => ({ ok: false, reason: "" }))
      .then((res) => alive && setNotices({ status: "done", value: res.ok ? res : null }));
    fetch("/api/remndr-notices")
      .then((r) => r.json() as Promise<RemndrResult>)
      .catch((): RemndrResult => ({ ok: false, reason: "" }))
      .then((res) => alive && setRemndr({ status: "done", value: res.ok ? res : null }));
    const t = setTimeout(() => alive && setTimedOut(true), WAIT_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [blocked, today, hasFile]);

  // 내 점수 맞춤: 이번 주 공고마다 분양 공고 목록과 같은 방법(/api/similar + lib/judge.ts)으로 판정
  const noticeList = file ? file.notices : notices.status === "done" ? (notices.value?.notices ?? null) : null;
  const remndrList = file ? file.remndr : remndr.status === "done" ? (remndr.value?.notices ?? null) : null;
  // 지난주 당첨 결과: 파일이 있으면 파일의 당첨가점을 내 거주 구분 기준으로 고름 (단지 비교와 같은 방법)
  const history = useMemo(
    () => (file ? historyToComplexes(file.lastWeekRows, home.sido ? home : null, file.generatedAt) : cs.source === "api" ? cs.complexes : null),
    [file, home, cs.source, cs.complexes],
  );
  const judgeTargets = useMemo(() => {
    if (!score || !noticeList || !today) return [];
    return noticesReceivingThisWeek(noticeList, today)
      .map((n) => ({ no: n.houseManageNo, qs: similarQuery(n, home) }))
      .filter((x): x is { no: string; qs: string } => x.qs !== null);
  }, [score, noticeList, home, today]);
  const verdictKey = `${score?.total ?? ""}|${judgeTargets.map((t) => t.qs).join(",")}`;

  useEffect(() => {
    if (!score || !judgeTargets.length) return;
    let alive = true;
    Promise.all(
      judgeTargets.map(async (t) => {
        const res = await loadSimilar(t.qs);
        const v = res.ok && res.result.stats ? (judge(score.total, res.result.stats)?.verdict ?? null) : null;
        return [t.no, v] as const;
      }),
    ).then((pairs) => alive && setVerdicts({ key: verdictKey, map: Object.fromEntries(pairs) }));
    return () => {
      alive = false;
    };
    // verdictKey가 대상·점수를 모두 담고 있음
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdictKey]);

  const cards = useMemo(
    () =>
      !today
        ? []
        : buildWeeklyCards({
            today,
            notices: noticeList,
            remndr: remndrList,
            history,
            csv,
            score,
            home,
            verdicts: judgeTargets.length === 0 ? {} : verdicts?.key === verdictKey ? verdicts.map : null,
            favorites: my.status === "user" && my.data ? my.data.favorites : null,
            tips: TIPS,
            tipIndex: file?.tipIndex,
          }),
    [today, noticeList, remndrList, history, csv, score, home, judgeTargets.length, verdicts, verdictKey, my.status, my.data, file],
  );

  const ready = hasFile || timedOut || (notices.status === "done" && remndr.status === "done" && !cs.loading);
  const open = blocked === false && !closed && ready && cards.length > 0;

  if (!open) return null;
  return (
    <Dialog
      cards={cards}
      onClose={() => setClosed(true)}
      onHideToday={() => (hideToday(today), setClosed(true))}
    />
  );
}

// ───────────────────────── 팝업 창 ─────────────────────────

function Dialog({
  cards,
  onClose,
  onHideToday,
}: {
  cards: WeeklyCard[];
  onClose: () => void;
  onHideToday: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  // 카드가 뒤늦게 더해져도(관심 공고 등) 보던 카드를 유지하도록 id로 기억
  const [currentId, setCurrentId] = useState(cards[0].id);
  const [dir, setDir] = useState<"next" | "prev" | null>(null);
  const touchX = useRef<number | null>(null);

  const found = cards.findIndex((c) => c.id === currentId);
  const index = found === -1 ? 0 : found;
  const card = cards[index];

  const go = useCallback(
    (to: number) => {
      if (to < 0 || to >= cards.length || to === index) return;
      setDir(to > index ? "next" : "prev");
      setCurrentId(cards[to].id);
    },
    [cards, index],
  );

  // 열릴 때: 원래 포커스 기억, 뒤 화면 스크롤 막기 / 닫힐 때: 되돌리기
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    boxRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (before && document.contains(before)) before.focus();
    };
  }, []);

  // 키보드: 포커스가 어디에 있든 팝업이 열려 있는 동안은 여기서 받음
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const box = boxRef.current;
      if (!box) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(index + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(index - 1);
      } else if (e.key === "Tab") {
        // 포커스 가두기: 팝업 안의 마지막 ↔ 처음으로 돌고, 밖에 있으면 안으로 데려옴
        const items = [...box.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        const inside = active instanceof Node && box.contains(active);
        if (!inside) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && (active === first || active === box)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [go, index, onClose]);

  return (
    <div
      className="menu-fade fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="weekly-popup-title"
        aria-roledescription="카드뉴스"
        tabIndex={-1}
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (dx <= -SWIPE_PX) go(index + 1);
          else if (dx >= SWIPE_PX) go(index - 1);
        }}
        className="relative flex max-h-[min(560px,calc(100dvh-32px))] w-full max-w-[420px] flex-col overflow-hidden rounded-lg bg-[#FAF8F3] shadow-xl outline-none"
      >
        {/* 머리줄: 모든 장 같은 모양 (앱 아이콘 + 청약핏 / 장 번호 / 닫기) */}
        <div className="flex shrink-0 items-center gap-2 px-5 pt-4 pb-1">
          <AppIcon />
          <span className={`text-sm text-brand ${DISPLAY}`}>청약핏</span>
          <span className="ml-auto text-sm text-brand tabular-nums" aria-label={`${cards.length}장 중 ${index + 1}번째`}>
            {index + 1}/{cards.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="팝업 닫기"
            className="-mr-2 flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-black/5 hover:text-ink"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 카드 내용 (넘길 때마다 다시 그려 넘김 효과) */}
        <div
          key={card.id}
          className={`min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-3 ${dir === "next" ? "step-next" : dir === "prev" ? "step-prev" : ""}`}
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <Label>{card.label}</Label>
              <h2 id="weekly-popup-title" className={`mt-2 text-xl leading-snug text-brand ${DISPLAY}`}>
                {card.title}
              </h2>
            </div>
            {card.id === "schedule" && <BuildingsDecor />}
          </div>

          {card.id === "schedule" && <ScheduleBody card={card} onNavigate={onClose} />}
          {card.id === "featured" && <FeaturedBody card={card} onNavigate={onClose} />}
          {card.id === "results" && <ResultsBody card={card} onNavigate={onClose} />}
          {(card.id === "mine" || card.id === "favorites") && <ListBody card={card} onNavigate={onClose} />}
          {card.id === "tip" && <TipBody card={card} onNavigate={onClose} />}

          <div className="mt-3 text-right">
            <Link href={card.all.href} onClick={onClose} aria-label={card.all.text} className="text-xs text-muted hover:text-brand">
              전체 보기 →
            </Link>
          </div>
        </div>

        {/* 넘김: 화살표와 위치 점 */}
        {cards.length > 1 && (
          <div className="flex shrink-0 items-center justify-between px-3 py-1.5">
            <Arrow dir="prev" disabled={index === 0} onClick={() => go(index - 1)} />
            <div className="flex items-center gap-1.5" role="group" aria-label={`카드 ${cards.length}장 중 ${index + 1}번째`}>
              {cards.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`${i + 1}번째 카드: ${c.title}`}
                  aria-current={i === index ? "true" : undefined}
                  className="flex h-6 w-4 items-center justify-center"
                >
                  <span className={`block h-1.5 w-1.5 rounded-full ${i === index ? "bg-brand" : "border border-muted/60"}`} />
                </button>
              ))}
            </div>
            <Arrow dir="next" disabled={index === cards.length - 1} onClick={() => go(index + 1)} />
          </div>
        )}

        <div className="flex shrink-0 items-center justify-between border-t border-line bg-white px-5 py-2.5 text-sm">
          <button type="button" onClick={onHideToday} className="text-xs text-muted hover:text-ink">
            오늘 하루 보지 않기
          </button>
          <button type="button" onClick={onClose} className="font-semibold text-brand hover:underline">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── 카드별 내용 ─────────────────────────

type Body<K extends WeeklyCard["id"]> = {
  card: Extract<WeeklyCard, { id: K }>;
  onNavigate: () => void;
};

const TAG_STYLE: Record<ScheduleTag, { bar: string; text: string }> = {
  특별공급: { bar: "bg-accent", text: "text-accent-dark" },
  "1순위": { bar: "bg-brand", text: "text-brand" },
  무순위: { bar: "bg-[#8A918D]", text: "text-[#6B726E]" },
  당첨발표: { bar: "bg-[#7FA395]", text: "text-[#4F7A6C]" },
};

/** 1장: 기간 알약 + 요일 칸 + 그날 목록 */
function ScheduleBody({ card, onNavigate }: Body<"schedule">) {
  const [day, setDay] = useState(card.defaultDay);
  const current = card.days.find((d) => d.date === day) ?? card.days[0];
  return (
    <>
      <p className="mt-3 inline-flex rounded-full border border-brand/50 px-3 py-1 text-sm text-ink tabular-nums">{card.range}</p>

      <div
        className="mt-4 grid gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${card.days.length}, minmax(0, 1fr))`,
        }}
        role="group"
        aria-label="요일 선택"
      >
        {card.days.map((d) => {
          const on = d.date === current.date;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => setDay(d.date)}
              aria-pressed={on}
              aria-label={`${d.dow}요일 ${d.md} 일정 ${d.items.length}건`}
              className={`rounded-md py-2 text-base ${DISPLAY} ${on ? "bg-brand text-white" : d.items.length ? "bg-[#EFEDE6] text-ink hover:bg-[#E6E3DA]" : "bg-[#EFEDE6] text-muted"}`}
            >
              {d.dow}
            </button>
          );
        })}
      </div>

      {current.items.length === 0 ? (
        <p className="mt-3 border-y border-line py-4 text-sm text-muted">
          {current.md}({current.dow})에는 일정이 없어요.
        </p>
      ) : (
        <ul className="mt-3 border-t border-line" aria-label={`${current.md}(${current.dow}) 일정`}>
          {current.items.map((e) => (
            <li key={e.key} className="flex items-center gap-3 border-b border-line py-2.5">
              <span className={`w-1 self-stretch rounded-full ${TAG_STYLE[e.tag].bar}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
                  <span className={`shrink-0 ${TAG_STYLE[e.tag].text}`}>[{e.tag}]</span>
                  <NameLink href={e.href} external={e.external} onNavigate={onNavigate} className="truncate">
                    {e.name}
                  </NameLink>
                </span>
                {e.sub && <span className="block truncate text-xs text-muted">{e.sub}</span>}
              </span>
              {e.capped && <Ribbon tone="beige">분상제</Ribbon>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 2장: 단지마다 같은 배치 (대표 이미지 | 이름·지역·일정·타입별 가격) */
function FeaturedBody({ card, onNavigate }: Body<"featured">) {
  return (
    <>
      <ul className="mt-3 border-t border-line">
        {card.items.map((it) => (
          <li key={it.no} className="flex gap-3 border-b border-line py-3">
            <ComplexThumb
              name={it.name}
              address={it.address}
              region={`${it.region} ${it.unit}`}
              size="md"
            />
            <div className="min-w-0 flex-1">
              {it.capped && (
                <div className="mb-1">
                  <Ribbon tone="accent">분양가상한제</Ribbon>
                </div>
              )}
              <NameLink href={it.href} onNavigate={onNavigate} className="line-clamp-2 text-[15px] font-semibold text-ink">
                {it.name}
              </NameLink>
              <p className="mt-0.5 text-xs text-muted">{`${it.region} ${it.unit}`.trim()}</p>
              {it.dates && <p className="mt-0.5 text-sm text-ink tabular-nums">{it.dates}</p>}
              {it.chips.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {it.chips.map((c) => (
                    <span key={c} className="rounded bg-[#ECEEE8] px-2 py-0.5 text-xs text-ink tabular-nums">
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {card.more && <p className="pt-2 text-xs text-muted">{card.more}</p>}
    </>
  );
}

/** 3장: 표 (단지명 · 주택형 · 최저 가점 · 경쟁률) */
function ResultsBody({ card, onNavigate }: Body<"results">) {
  return (
    <>
      <p className="mt-1 text-xs text-muted">{card.intro}</p>
      <table className="mt-3 w-full table-fixed text-sm">
        <thead>
          <tr className="border-y-2 border-y-brand/60 text-left text-brand">
            <th className={`w-[42%] py-2 font-normal ${DISPLAY}`}>단지명</th>
            <th className={`py-2 text-center font-normal ${DISPLAY}`}>주택형</th>
            <th className={`py-2 text-right font-normal ${DISPLAY}`}>최저 가점</th>
            <th className={`py-2 text-right font-normal ${DISPLAY}`}>경쟁률</th>
          </tr>
        </thead>
        <tbody>
          {card.rows.map((r) => (
            <tr key={r.key} className="border-b border-line">
              <td className="py-2.5 pr-2">
                <NameLink href={r.href} onNavigate={onNavigate} className="line-clamp-2 leading-snug">
                  {r.name}
                </NameLink>
              </td>
              <td className="py-2.5 text-center tabular-nums">{r.type}</td>
              <td className="py-2.5 text-right tabular-nums">{fmtScore(r.min)}점</td>
              <td className="py-2.5 text-right tabular-nums">{r.rate ?? <span className="text-xs text-muted">정보 없음</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {card.more && <p className="pt-2 text-xs text-muted">{card.more}</p>}
      <p className="mt-3 text-xs text-muted">※ 당첨 결과는 입주자모집공고 및 청약홈에서 확인하세요.</p>
      <SkylineDecor />
    </>
  );
}

/** 내 점수 맞춤·관심 공고: 행 목록 */
function ListBody({ card, onNavigate }: Body<"mine" | "favorites">) {
  return (
    <>
      {card.intro && <p className="mt-2 text-xs text-muted">{card.intro}</p>}
      <ul className="mt-3 border-t border-line">
        {card.rows.map((r) => (
          <Row key={r.key} row={r} onNavigate={onNavigate} />
        ))}
      </ul>
    </>
  );
}

/** 4장: 청약 상식 */
function TipBody({ card, onNavigate }: Body<"tip">) {
  return (
    <>
      <div className="mt-4 flex items-end gap-3 border-t border-ink/70 pt-4">
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink">{card.body}</p>
        <HouseSproutDecor />
      </div>
      <Link href={card.link.href} onClick={onNavigate} className="mt-4 inline-block border-b border-brand pb-0.5 text-sm font-semibold text-brand">
        {card.link.text}
      </Link>
    </>
  );
}

// ───────────────────────── 작은 부품 ─────────────────────────

/** 라벨: 주황 테두리 알약 (THIS WEEK, RESULT, TIP …) */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className={`inline-flex rounded-full border border-accent px-2.5 py-0.5 text-xs tracking-wide text-accent-dark ${DISPLAY}`}>
      {children}
    </span>
  );
}

/** 꼬리표: 오른쪽이 V자로 파인 모양 */
function Ribbon({ tone, children }: { tone: "beige" | "accent"; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block shrink-0 py-0.5 pr-3 pl-2 text-xs ${tone === "accent" ? "bg-accent text-white" : "bg-[#F1ECDF] text-ink"}`}
      style={{
        clipPath: "polygon(0 0, 100% 0, calc(100% - 6px) 50%, 100% 100%, 0 100%)",
      }}
    >
      {children}
    </span>
  );
}

function NameLink({
  href,
  external = false,
  onNavigate,
  className = "",
  children,
}: {
  href: string;
  external?: boolean;
  onNavigate: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={`hover:underline ${className}`}>
        {children}
        <span className="sr-only"> (청약홈, 새 창)</span>
        <span aria-hidden="true" className="ml-0.5 text-xs text-muted">
          ↗
        </span>
      </a>
    );
  }
  return (
    <Link href={href} onClick={onNavigate} className={`hover:underline ${className}`}>
      {children}
    </Link>
  );
}

function Row({ row, onNavigate }: { row: CardRow; onNavigate: () => void }) {
  const title = row.href ? (
    <NameLink href={row.href} external={row.external} onNavigate={onNavigate} className="font-medium">
      {row.title}
    </NameLink>
  ) : (
    <span className={row.sub || row.right ? "font-medium" : "text-muted"}>{row.title}</span>
  );
  return (
    <li className="flex items-baseline gap-3 border-b border-line py-2.5 text-sm">
      {row.lead && <span className="w-10 shrink-0 text-xs text-muted">{row.lead}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        {row.sub && <span className="block truncate text-xs text-muted">{row.sub}</span>}
      </span>
      {row.right && <span className={`shrink-0 text-xs ${RIGHT_TONE[row.rightTone ?? "muted"]}`}>{row.right}</span>}
    </li>
  );
}

function Arrow({ dir, disabled, onClick }: { dir: "prev" | "next"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "이전 카드" : "다음 카드"}
      className="flex h-8 w-8 items-center justify-center rounded text-brand hover:bg-black/5 disabled:text-line disabled:hover:bg-transparent"
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
        <path
          d={dir === "prev" ? "M12 4l-6 6 6 6" : "M8 4l6 6-6 6"}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

const fmtScore = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** 앱 아이콘 (B안 새싹 집, app/icon.svg와 같은 그림). 옆에 "청약핏" 글자가 있어 화면 읽기에서는 건너뜀 */
function AppIcon() {
  return (
    <svg viewBox="0 0 100 100" className="h-6 w-6 shrink-0" aria-hidden="true">
      <rect width="100" height="100" rx="22" fill="#1F4E46" />
      <path d="M20 50 L50 24 L80 50" fill="none" stroke="#F7F6F2" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M29 46 V78 H71 V46" fill="none" stroke="#F7F6F2" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 60 C50 52 44 47 37 47 C37 55 43 60 50 60 Z" fill="#F4A53F" />
      <path d="M50 62 C50 53 56 48 63 48 C63 56 57 62 50 62 Z" fill="#F4A53F" />
    </svg>
  );
}

// ───────────────────────── 장식 그림 (화면 읽기에서 건너뜀, 글자와 겹치지 않게 옆이나 아래에만 둠) ─────────────────────────

/** 1장 제목 옆: 연한 건물과 잎 */
function BuildingsDecor() {
  return (
    <svg viewBox="0 0 96 72" className="hidden h-16 w-20 shrink-0 min-[360px]:block" aria-hidden="true" focusable="false">
      <g fill="#E4E8DF" stroke="#C9D2C4" strokeWidth="1">
        <rect x="40" y="6" width="26" height="62" />
        <rect x="18" y="26" width="26" height="42" />
        <rect x="64" y="22" width="18" height="46" />
      </g>
      <g fill="#C9D2C4">
        {[14, 24, 34, 44, 54].map((y) => (
          <g key={y}>
            <rect x="46" y={y} width="4" height="5" />
            <rect x="56" y={y} width="4" height="5" />
          </g>
        ))}
        {[34, 44, 54].map((y) => (
          <g key={y}>
            <rect x="24" y={y} width="4" height="5" />
            <rect x="34" y={y} width="4" height="5" />
          </g>
        ))}
      </g>
      <path d="M86 68 C86 56 88 48 92 40" fill="none" stroke="#9DB394" strokeWidth="1.5" />
      <path d="M89 52 C84 50 82 46 83 42 C87 44 89 48 89 52 Z M90 46 C94 44 95 40 94 36 C91 38 89 42 90 46 Z" fill="#B5C8AC" />
    </svg>
  );
}

/** 3장 아래: 낮은 건물 줄 */
function SkylineDecor() {
  return (
    <svg viewBox="0 0 380 40" className="mt-3 h-8 w-full" preserveAspectRatio="xMaxYMax meet" aria-hidden="true" focusable="false">
      <path d="M0 38 C80 26 160 30 240 34 S340 30 380 28 V40 H0 Z" fill="#E7EBE3" />
      <g fill="#DDE3D8" stroke="#C9D2C4" strokeWidth="1">
        <rect x="282" y="8" width="22" height="30" />
        <rect x="306" y="16" width="16" height="22" />
        <rect x="324" y="4" width="20" height="34" />
      </g>
      <circle cx="356" cy="28" r="8" fill="#C5D3BF" />
      <circle cx="268" cy="30" r="6" fill="#C5D3BF" />
    </svg>
  );
}

/** 4장 본문 옆: 새싹 집 선 그림 */
function HouseSproutDecor() {
  return (
    <svg viewBox="0 0 80 80" className="h-20 w-20 shrink-0" aria-hidden="true" focusable="false">
      <circle cx="44" cy="48" r="28" fill="#EEF1EA" />
      <g fill="none" stroke="#1F4E46" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M14 46 L40 24 L66 46" />
        <path d="M20 41 V70 H60 V41" />
        <rect x="26" y="48" width="10" height="9" />
        <path d="M44 70 V54 H53 V70" />
        <path d="M52 32 V24 H57 V36" />
        <path d="M54.5 24 V12" />
        <path d="M54.5 14 C50 14 46 11 46 6 C51 6 54.5 9 54.5 14 Z" />
        <path d="M54.5 14 C59 14 63 11 63 6 C58 6 54.5 9 54.5 14 Z" />
        <path d="M8 70 H72" />
      </g>
    </svg>
  );
}
