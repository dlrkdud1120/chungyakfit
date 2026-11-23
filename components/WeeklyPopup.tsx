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
  type CardTone,
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

/** 카드 톤: 위쪽 색 띠, 배경, 분류 글자 색 */
const TONE: Record<CardTone, { band: string; bg: string; label: string }> = {
  brand: { band: "bg-brand", bg: "bg-white", label: "text-brand" },
  accent: { band: "bg-accent", bg: "bg-[#FFF9F0]", label: "text-accent-dark" },
  beige: { band: "bg-[#D8D1BF]", bg: "bg-[#F7F6F2]", label: "text-[#7A6F55]" },
};

const RIGHT_TONE: Record<NonNullable<CardRow["rightTone"]>, string> = {
  ok: "text-ok font-semibold",
  accent: "text-accent-dark font-semibold",
  bad: "text-bad font-semibold",
  muted: "text-muted",
};

export default function WeeklyPopup({ csv, weekly }: { csv: Complex[]; weekly: WeeklyFile[] }) {
  // 날짜와 "오늘 하루 보지 않기" 여부는 브라우저에서만 읽음 (서버에서 그릴 때는 null → 팝업 없음)
  const clientToday = useSyncExternalStore(noSubscribe, todayKST, () => null);
  const today = clientToday ?? "";
  const blocked = useSyncExternalStore(
    noSubscribe,
    () => hiddenToday(todayKST()),
    () => null,
  );
  const [closed, setClosed] = useState(false);
  const [notices, setNotices] = useState<Loaded<NoticeResult & { ok: true }>>({ status: "loading" });
  const [remndr, setRemndr] = useState<Loaded<RemndrResult & { ok: true }>>({ status: "loading" });
  const [timedOut, setTimedOut] = useState(false);
  const [verdicts, setVerdicts] = useState<{ key: string; map: Record<string, Verdict | null> } | null>(null);

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
    () =>
      file
        ? historyToComplexes(file.lastWeekRows, home.sido ? home : null, file.generatedAt)
        : cs.source === "api"
          ? cs.complexes
          : null,
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
      !today ? [] : buildWeeklyCards({
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
  return <Dialog cards={cards} onClose={() => setClosed(true)} onHideToday={() => (hideToday(today), setClosed(true))} />;
}

// ───────────────────────── 팝업 창 ─────────────────────────

function Dialog({ cards, onClose, onHideToday }: { cards: WeeklyCard[]; onClose: () => void; onHideToday: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  // 카드가 뒤늦게 더해져도(관심 공고 등) 보던 카드를 유지하도록 id로 기억
  const [currentId, setCurrentId] = useState(cards[0].id);
  const [dir, setDir] = useState<"next" | "prev" | null>(null);
  const touchX = useRef<number | null>(null);

  const found = cards.findIndex((c) => c.id === currentId);
  const index = found === -1 ? 0 : found;
  const card = cards[index];
  const tone = TONE[card.tone];

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
        className={`relative flex max-h-[min(560px,calc(100dvh-32px))] w-full max-w-[420px] flex-col overflow-hidden rounded-md shadow-xl outline-none ${tone.bg}`}
      >
        <div className={`h-1.5 shrink-0 ${tone.band}`} aria-hidden="true" />

        <button
          type="button"
          onClick={onClose}
          aria-label="팝업 닫기"
          className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-black/5 hover:text-ink"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        {/* 카드 내용 (넘길 때마다 다시 그려 넘김 효과) */}
        <div
          key={card.id}
          className={`min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-3 ${dir === "next" ? "step-next" : dir === "prev" ? "step-prev" : ""}`}
          aria-live="polite"
        >
          {index === 0 && <AppIcon />}
          <p className={`text-[11px] font-semibold tracking-wider ${tone.label}`}>{card.label}</p>
          <h2 id="weekly-popup-title" className="mt-1 pr-8 text-base font-bold text-ink">
            {card.title}
          </h2>
          {card.intro && <p className="mt-1 text-xs text-muted">{card.intro}</p>}

          {card.body && <p className="mt-3 border-t border-line pt-3 text-sm leading-relaxed text-ink">{card.body}</p>}

          {card.rows.length > 0 && (
            <ul className="mt-3 border-t border-line">
              {card.rows.map((r) => (
                <Row key={r.key} row={r} onNavigate={onClose} />
              ))}
            </ul>
          )}
          {card.more && <p className="pt-2 text-xs text-muted">{card.more}</p>}

          <div className="mt-3 flex items-center justify-between gap-3 text-xs">
            {card.extraLink ? (
              <Link href={card.extraLink.href} onClick={onClose} className="font-semibold text-brand underline underline-offset-2">
                {card.extraLink.text}
              </Link>
            ) : (
              <span />
            )}
            <Link href={card.all.href} onClick={onClose} aria-label={card.all.text} className="text-muted hover:text-brand">
              전체 보기 →
            </Link>
          </div>
        </div>

        {/* 넘김: 화살표와 위치 점 */}
        {cards.length > 1 && (
          <div className="flex shrink-0 items-center justify-between px-3 py-2">
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

function Row({ row, onNavigate }: { row: CardRow; onNavigate: () => void }) {
  const title = row.href ? (
    row.external ? (
      <a href={row.href} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
        {row.title}
        <span className="sr-only"> (청약홈, 새 창)</span>
        <span aria-hidden="true" className="ml-0.5 text-xs text-muted">↗</span>
      </a>
    ) : (
      <Link href={row.href} onClick={onNavigate} className="font-medium hover:underline">
        {row.title}
      </Link>
    )
  ) : (
    <span className={row.sub || row.right ? "font-medium" : "text-muted"}>{row.title}</span>
  );
  return (
    <li className="flex items-baseline gap-3 border-b border-line py-2 text-sm">
      {row.lead && <span className="w-12 shrink-0 text-xs text-muted tabular-nums">{row.lead}</span>}
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
        <path d={dir === "prev" ? "M12 4l-6 6 6 6" : "M8 4l6 6-6 6"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** 앱 아이콘 (B안 새싹 집, app/icon.svg와 같은 그림) */
function AppIcon() {
  return (
    <svg viewBox="0 0 100 100" className="mb-2 h-7 w-7" role="img" aria-label="청약핏">
      <rect width="100" height="100" rx="22" fill="#1F4E46" />
      <path d="M20 50 L50 24 L80 50" fill="none" stroke="#F7F6F2" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M29 46 V78 H71 V46" fill="none" stroke="#F7F6F2" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 60 C50 52 44 47 37 47 C37 55 43 60 50 60 Z" fill="#F4A53F" />
      <path d="M50 62 C50 53 56 48 63 48 C63 56 57 62 50 62 Z" fill="#F4A53F" />
    </svg>
  );
}
