"use client";

/**
 * 마이페이지 (/mypage)
 * 위에서 아래로: 1) 내 점수 기록  2) 관심 분양 공고  3) 마이청약캘린더  4) 최근 열람한 공고  5) 계정
 *
 * - 로그인 전에는 기능 소개와 카카오 로그인 버튼만 보여줍니다.
 * - 판정은 lib/judge.ts를 그대로 씁니다. 과거 당첨가점이 있는 공고는 그 값으로,
 *   아직 결과가 없는 공고는 가능성 확인과 같은 "비슷한 사례"(/api/similar)로 판정합니다.
 * - 달력과 D-day는 관심 공고를 담을 때 함께 저장한 일정으로 계산합니다.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import FavoriteStar from "@/components/FavoriteStar";
import Fold from "@/components/Fold";
import { KakaoLoginButton } from "@/components/KakaoLogin";
import { useMy } from "@/components/Providers";
import { downloadIcsMany, scheduleEvents } from "@/lib/calendar";
import { growthStage } from "@/lib/growth";
import { judge, type Verdict } from "@/lib/judge";
import type { Favorite, MeData, ScoreRecord } from "@/lib/meTypes";
import { parseMyHome, readMyHomeRaw, subscribeMyHome, type MyHome } from "@/lib/myHome";
import { addDays, ddayText, md, nextEvent, todayKST, type Upcoming } from "@/lib/mySchedule";
import { parseMyScore, readMyScoreRaw, subscribeMyScore } from "@/lib/myScore";
import { areaOf, bandOf, shortType, SIDO_LIST, type SimilarResult } from "@/lib/similar";
import { useComplexes } from "@/lib/useComplexes";

const dot = (s: string) => s.replaceAll("-", ".");

export default function MyPage() {
  const my = useMy();
  const { status, reload } = my;

  // 마이페이지에 들어올 때마다 최신 데이터로
  useEffect(() => {
    if (status === "user") reload();
  }, [status, reload]);

  if (status === "loading") return <Note>불러오는 중…</Note>;
  if (status === "guest") return <GuestIntro />;
  if (my.dataState === "db-setup") {
    return <Note>로그인은 됐지만 저장소(Supabase) 설정이 아직 안 됐어요. README의 설정 순서를 확인해 주세요.</Note>;
  }
  if (my.dataState === "error") {
    return (
      <Note>
        내 데이터를 불러오지 못했어요.{" "}
        <button type="button" onClick={reload} className="text-brand underline">
          다시 시도
        </button>
      </Note>
    );
  }
  if (!my.data) return <Note>내 데이터를 불러오는 중…</Note>;
  return <Sections data={my.data} />;
}

// ───────────────────────── 로그인 전 ─────────────────────────

const INTRO = [
  ["내 점수 기록", "계산한 가점을 날짜별로 남기고 변화를 그래프로 봐요."],
  ["관심 분양 공고", "별 표시로 담은 공고의 내 판정과 다음 일정을 한 줄로 봐요."],
  ["마이청약캘린더", "관심 공고의 접수·발표·계약 일정을 달력으로 모아 봐요."],
  ["최근 열람한 공고", "가능성 확인에서 본 공고를 20개까지 다시 찾아요."],
];

function GuestIntro() {
  return (
    <section>
      <SectionTitle>로그인하면 쓸 수 있는 기능</SectionTitle>
      <table className="w-full text-sm">
        <tbody>
          {INTRO.map(([name, text]) => (
            <tr key={name} className="border-b border-line align-top">
              <td className="w-32 py-2.5 pr-3 font-medium whitespace-nowrap">{name}</td>
              <td className="py-2.5 text-muted">{text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-sm text-muted">
        로그인은 선택이에요. 가점 계산, 가능성 확인, 단지 비교, 분양 공고는 로그인 없이도 그대로 쓸 수 있어요. 로그인할 때는 닉네임만
        받아요.
      </p>
      <div className="mt-3">
        <KakaoLoginButton />
      </div>
    </section>
  );
}

// ───────────────────────── 로그인 후 ─────────────────────────

function Sections({ data }: { data: MeData }) {
  const localScoreRaw = useSyncExternalStore(subscribeMyScore, readMyScoreRaw, () => null);
  const localHomeRaw = useSyncExternalStore(subscribeMyHome, readMyHomeRaw, () => null);
  const score = data.scores[0]?.total ?? parseMyScore(localScoreRaw)?.total ?? null;
  const home = useMemo(() => (data.home.sido ? data.home : parseMyHome(localHomeRaw)), [data.home, localHomeRaw]);
  const today = todayKST();

  return (
    <div className="space-y-12">
      <ScoreSection scores={data.scores} />
      <FavoriteSection favorites={data.favorites} score={score} home={home} today={today} />
      <CalendarSection favorites={data.favorites} today={today} />
      {/* 한 화면에 세 섹션까지만: 나머지는 접어 둠 */}
      <div>
        <Fold label={`최근 열람한 공고 보기 (${data.recent.length})`}>
          <RecentSection data={data} />
        </Fold>
        <Fold label="계정 설정 보기">
          <AccountSection data={data} />
        </Fold>
      </div>
    </div>
  );
}

// ───────────────────────── 1. 내 점수 기록 ─────────────────────────

function ScoreSection({ scores }: { scores: ScoreRecord[] }) {
  const latest = scores[0];
  if (!latest) {
    return (
      <section>
        <SectionTitle>내 점수 기록</SectionTitle>
        <Note>
          아직 저장된 점수가 없어요.{" "}
          <Link href="/score" className="text-brand underline">
            가점 계산하기 →
          </Link>
        </Note>
      </section>
    );
  }
  const stage = growthStage(latest.total);
  return (
    <section>
      <SectionTitle right={<Link href="/score" className="text-xs text-muted hover:text-brand">다시 계산하기 →</Link>}>내 점수 기록</SectionTitle>
      <table className="w-full text-sm">
        <tbody>
          <Line label="저장된 점수">
            <span className="font-semibold text-brand">{latest.total}점</span>
            <span className="ml-2 text-xs text-muted">
              무주택 {latest.homeless} · 부양가족 {latest.dependents} · 통장 {latest.account}
            </span>
          </Line>
          <Line label="성장 단계">
            {stage.name} <span className="text-xs text-muted">({stage.step}/{stage.of}단계 · {stage.note})</span>
            {stage.next && (
              <span className="ml-2 text-xs text-muted">
                다음 &lsquo;{stage.next.name}&rsquo;까지 {stage.next.need}점
              </span>
            )}
          </Line>
          <Line label="마지막 계산 날짜">{dot(latest.calcDate)}</Line>
        </tbody>
      </table>
      <ScoreChart scores={scores} />
    </section>
  );
}

/** 날짜별 점수 변화: 작은 선 그래프와 최근 기록 몇 줄 */
function ScoreChart({ scores }: { scores: ScoreRecord[] }) {
  const pts = [...scores].reverse(); // 오래된 것부터
  if (pts.length < 2) return <p className="mt-2 text-xs text-muted">다시 계산해서 저장하면 기록이 쌓이고, 2개부터 변화 그래프가 보여요.</p>;
  const W = 320;
  const H = 64;
  const PAD = 6;
  const lo = Math.min(...pts.map((p) => p.total));
  const hi = Math.max(...pts.map((p) => p.total));
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / (pts.length - 1);
  const y = (v: number) => (hi === lo ? H / 2 : H - PAD - ((v - lo) * (H - PAD * 2)) / (hi - lo));
  const first = pts[0];
  const last = pts[pts.length - 1];
  const diff = Math.round((last.total - first.total) * 100) / 100;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-16 w-full max-w-xs"
          role="img"
          aria-label={`점수 변화 그래프: ${dot(first.calcDate)} ${first.total}점에서 ${dot(last.calcDate)} ${last.total}점`}
        >
          <line x1={PAD} x2={W - PAD} y1={H - 1} y2={H - 1} stroke="#e3e8e6" />
          <polyline fill="none" stroke="#1f4e46" strokeWidth="1.5" points={pts.map((p, i) => `${x(i)},${y(p.total)}`).join(" ")} />
          {pts.map((p, i) => (
            <circle key={p.id} cx={x(i)} cy={y(p.total)} r={i === pts.length - 1 ? 3 : 2} fill={i === pts.length - 1 ? "#f4a53f" : "#1f4e46"}>
              <title>{`${dot(p.calcDate)} ${p.total}점`}</title>
            </circle>
          ))}
        </svg>
        <p className="text-xs text-muted">
          {md(first.calcDate)} {first.total}점 → {md(last.calcDate)} {last.total}점
          {diff !== 0 && <span className={diff > 0 ? "text-ok" : "text-bad"}> ({diff > 0 ? "+" : ""}{diff}점)</span>} · 기록 {pts.length}개
        </p>
      </div>
      <table className="mt-2 w-full text-[13px] tabular-nums">
        <tbody>
          {scores.slice(0, 5).map((s) => (
            <tr key={s.id} className="border-b border-line text-muted">
              <td className="py-1.5">{dot(s.calcDate)}</td>
              <td className="py-1.5 text-right text-ink">{s.total}점</td>
              <td className="hidden py-1.5 pl-4 text-right sm:table-cell">
                무주택 {s.homeless} · 부양가족 {s.dependents} · 통장 {s.account}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────── 2. 관심 분양 공고 ─────────────────────────

type Judged = { verdict: Verdict | null; basis: string };
type SimilarResponse = { ok: true; result: SimilarResult } | { ok: false; reason: string };
const NO_COMPLEXES: never[] = [];

/** 관심 공고마다 지금 판정 구하기 (판정 규칙은 lib/judge.ts) */
function useVerdicts(favorites: Favorite[], score: number | null, home: MyHome): Record<string, Judged> | null {
  const cs = useComplexes(NO_COMPLEXES);
  const key = JSON.stringify([favorites.map((f) => [f.no, f.houseTy, f.sido, f.unit]), score, home, cs.loading, cs.complexes.length]);
  const [done, setDone] = useState<{ key: string; map: Record<string, Judged> } | null>(null);

  useEffect(() => {
    if (score === null || cs.loading) return;
    let alive = true;
    const one = async (f: Favorite): Promise<Judged> => {
      if (!f.houseTy) return { verdict: null, basis: "주택형 정보가 없어 판정하지 않아요" };
      // 1) 이미 당첨가점이 나온 공고: 그 주택형의 실제 값으로
      const type = cs.complexes
        .find((c) => c.id === f.no)
        ?.types.find((t) => t.type === f.houseTy || t.type === shortType(f.houseTy!));
      if (type) {
        const j = judge(score, type);
        if (j) return { verdict: j.verdict, basis: `${shortType(f.houseTy)} 실제 당첨가점 기준` };
      }
      // 2) 아직 결과가 없는 공고: 가능성 확인과 같은 "비슷한 사례"로
      const area = areaOf(f.houseTy);
      if (!home.sido) return { verdict: null, basis: "거주지를 정하면 판정해요" };
      if (area === null || !f.sido || !f.unit) return { verdict: null, basis: "판정에 필요한 정보가 부족해요" };
      const qs = new URLSearchParams({ sido: f.sido, unit: f.unit, band: bandOf(area), homeSido: home.sido, homeUnit: home.unit, exclude: f.no });
      const res = await fetch(`/api/similar?${qs}`)
        .then((r) => r.json() as Promise<SimilarResponse>)
        .catch((): SimilarResponse => ({ ok: false, reason: "" }));
      if (!res.ok) return { verdict: null, basis: "과거 사례를 불러오지 못했어요" };
      const j = res.result.stats ? judge(score, res.result.stats) : null;
      return j
        ? { verdict: j.verdict, basis: `${shortType(f.houseTy)} 비슷한 사례 ${res.result.cases.length}건 기준` }
        : { verdict: null, basis: "비슷한 과거 사례가 부족해요" };
    };
    Promise.all(favorites.map(async (f) => [f.no, await one(f)] as const)).then((list) => {
      if (alive) setDone({ key, map: Object.fromEntries(list) });
    });
    return () => {
      alive = false;
    };
    // key가 같으면 다시 계산하지 않음
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return done?.key === key ? done.map : null;
}

const VERDICT_COLOR: Record<Verdict, string> = { 안정: "text-ok", 도전: "text-accent-dark", 어려움: "text-bad" };

function FavoriteSection({ favorites, score, home, today }: { favorites: Favorite[]; score: number | null; home: MyHome; today: string }) {
  const my = useMy();
  const verdicts = useVerdicts(favorites, score, home);

  // 이 화면에 들어왔을 때의 "지난번 판정". 방금 본 판정을 저장한 뒤에도 이번 방문 동안은 변경 표시를 유지
  const [before] = useState(() => Object.fromEntries(favorites.map((f) => [f.no, f.lastVerdict])));

  // 이번에 본 판정을 기억해 두었다가 다음에 달라졌는지 비교 (같은 내용은 한 번만 보냄)
  const sent = useRef("");
  useEffect(() => {
    if (!verdicts) return;
    const list = favorites
      .filter((f) => verdicts[f.no]?.verdict && verdicts[f.no].verdict !== f.lastVerdict)
      .map((f) => ({ no: f.no, verdict: verdicts[f.no].verdict }));
    const sig = JSON.stringify(list);
    if (list.length && sig !== sent.current) {
      sent.current = sig;
      my.rememberVerdicts(list);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdicts]);

  // 일정이 남은 공고를 다음 일정이 가까운 순으로, 마감된 공고는 아래로
  const rows = favorites
    .map((f) => ({ f, next: nextEvent(f.schedule, today) }))
    .sort((a, b) => (a.next ? a.next.start : "9999").localeCompare(b.next ? b.next.start : "9999"));

  return (
    <section>
      <SectionTitle right={<span className="text-xs font-normal text-muted">{favorites.length}개</span>}>관심 분양 공고</SectionTitle>
      {favorites.length === 0 ? (
        <Note>
          분양 공고, 단지 비교, 가능성 확인 화면에서 별 표시를 누르면 여기에 담겨요.{" "}
          <Link href="/notice" className="text-brand underline">
            분양 공고 보기 →
          </Link>
        </Note>
      ) : (
        <ul>
          {rows.map(({ f, next }) => {
            const v = verdicts?.[f.no];
            const last = before[f.no] ?? null;
            const changed = !!(v?.verdict && last && v.verdict !== last);
            return (
              <li key={f.no} className={`flex items-start gap-2 border-b border-line py-3 ${next ? "" : "opacity-55"}`}>
                <span className="pt-0.5">
                  <FavoriteStar item={f} />
                </span>
                <div className="min-w-0 flex-1">
                  {f.schedule ? (
                    <Link
                      href={`/check?no=${f.no}${f.houseTy ? `&type=${encodeURIComponent(f.houseTy)}` : ""}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {f.name}
                    </Link>
                  ) : f.url ? (
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline">
                      {f.name}
                    </a>
                  ) : (
                    <span className="text-sm font-medium">{f.name}</span>
                  )}
                  <div className="text-xs text-muted">
                    {f.sido} {f.unit}
                    {v && ` · ${v.basis}`}
                  </div>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <div>
                    {changed && (
                      <>
                        <span className="mr-1.5 text-xs text-accent-dark">판정 변경</span>
                        <span className="text-xs text-muted">{last} → </span>
                      </>
                    )}
                    {score === null ? (
                      <Link href="/score" className="text-xs text-brand underline">
                        점수 계산 필요
                      </Link>
                    ) : !v ? (
                      <span className="text-xs text-muted">판정 중…</span>
                    ) : v.verdict ? (
                      <span className={`font-semibold ${VERDICT_COLOR[v.verdict]}`}>{v.verdict}</span>
                    ) : (
                      <span className="text-xs text-muted">판정 없음</span>
                    )}
                  </div>
                  <div className="text-xs whitespace-nowrap text-muted">{next ? <Dday u={next} /> : "마감"}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Dday({ u }: { u: Upcoming }) {
  return (
    <>
      <span className={u.dday <= 3 ? "text-accent-dark" : ""}>{ddayText(u)}</span> ({md(u.start)})
    </>
  );
}

// ───────────────────────── 3. 마이청약캘린더 ─────────────────────────

type CalEvent = { no: string; name: string; key: string; label: string; start: string; end: string };
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const weekday = (s: string) => new Date(`${s}T00:00:00Z`).getUTCDay();

function CalendarSection({ favorites, today }: { favorites: Favorite[]; today: string }) {
  const my = useMy();
  const withSchedule = favorites.filter((f) => f.schedule);
  const events: CalEvent[] = useMemo(
    () =>
      favorites.flatMap((f) =>
        f.schedule ? scheduleEvents(f.schedule).map((e) => ({ no: f.no, name: f.name, key: e.key, label: e.label, start: e.range.start, end: e.range.end })) : [],
      ),
    [favorites],
  );
  const on = (day: string) => events.filter((e) => e.start <= day && day <= e.end);

  const [month, setMonth] = useState(today.slice(0, 7)); // "2026-11"
  const [picked, setPicked] = useState<string | null>(today);
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array<null>(weekday(first)).fill(null),
    ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  const move = (n: number) => {
    setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
    setPicked(null);
  };

  // 이번 주(월~일) 일정 한 줄 요약
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const sunday = addDays(monday, 6);
  const week = events.filter((e) => e.start <= sunday && e.end >= monday).sort((a, b) => a.start.localeCompare(b.start));

  const pickedList = picked ? on(picked) : [];

  return (
    <section>
      <SectionTitle
        right={
          withSchedule.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const ok = downloadIcsMany(withSchedule.map((f) => ({ houseManageNo: f.no, name: f.name, url: f.url, schedule: f.schedule! })));
                if (ok) my.saveCalendar(events.map(({ no, key, label, start, end }) => ({ no, key, label, start, end })));
              }}
              className="rounded border border-line bg-white px-2 py-0.5 text-xs font-normal text-brand hover:border-brand"
            >
              전체를 내 캘린더에 추가
            </button>
          )
        }
      >
        마이청약캘린더
      </SectionTitle>

      <p className="border-b border-line py-2.5 text-sm">
        <span className="mr-2 text-xs text-muted">이번 주 일정</span>
        {week.length === 0
          ? "없어요"
          : week
              .slice(0, 3)
              .map((e) => `${md(e.start)} ${e.name} ${e.label}`)
              .join(" · ") + (week.length > 3 ? ` 외 ${week.length - 3}개` : "")}
      </p>

      <div className="flex items-center justify-between py-2 text-sm">
        <button type="button" onClick={() => move(-1)} aria-label="이전 달" className="px-2 py-1 text-muted hover:text-ink">
          ‹
        </button>
        <span className="font-medium tabular-nums">
          {y}년 {m}월
        </span>
        <button type="button" onClick={() => move(1)} aria-label="다음 달" className="px-2 py-1 text-muted hover:text-ink">
          ›
        </button>
      </div>

      {/* 달력: 화면 너비에 맞춘 7칸. 날짜 칸에는 일정 개수만 작은 점으로 */}
      <div className="grid grid-cols-7 border-t border-l border-line text-center text-xs">
        {WEEKDAYS.map((w) => (
          <div key={w} className="border-r border-b border-line py-1 text-muted">
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} className="border-r border-b border-line" />;
          const count = on(day).length;
          const isPicked = day === picked;
          return (
            <button
              key={day}
              type="button"
              onClick={() => setPicked(day)}
              aria-label={`${Number(day.slice(8))}일, 일정 ${count}개`}
              aria-pressed={isPicked}
              className={`flex h-11 flex-col items-center justify-start gap-1 border-r border-b border-line pt-1.5 tabular-nums sm:h-12 ${
                isPicked ? "bg-brand/10" : "hover:bg-brand/5"
              }`}
            >
              <span className={day === today ? "font-bold text-brand underline underline-offset-2" : ""}>{Number(day.slice(8))}</span>
              <span className="flex h-1.5 items-center gap-0.5">
                {Array.from({ length: Math.min(count, 3) }, (_, k) => (
                  <span key={k} className="h-1.5 w-1.5 rounded-full bg-accent" />
                ))}
                {count > 3 && <span className="text-[9px] leading-none text-accent-dark">+</span>}
              </span>
            </button>
          );
        })}
      </div>

      {picked && (
        <div className="mt-2">
          <div className="border-b border-line pb-1.5 text-xs text-muted">
            {dot(picked)} ({WEEKDAYS[weekday(picked)]}) 일정 {pickedList.length}개
          </div>
          {pickedList.map((e) => (
            <div key={`${e.no}-${e.key}`} className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-sm">
              <span className="min-w-0 truncate">
                <Link href={`/check?no=${e.no}`} className="hover:underline">
                  {e.name}
                </Link>
              </span>
              <span className="shrink-0 text-xs whitespace-nowrap text-muted">
                {e.label} {e.start === e.end ? md(e.start) : `${md(e.start)}~${md(e.end)}`}
              </span>
            </div>
          ))}
        </div>
      )}
      {events.length === 0 && <p className="mt-2 text-xs text-muted">일정이 있는 분양 공고를 관심 공고로 담으면 달력에 표시돼요.</p>}
    </section>
  );
}

// ───────────────────────── 4. 최근 열람한 공고 ─────────────────────────

function RecentSection({ data }: { data: MeData }) {
  const my = useMy();
  return (
    <section>
      <SectionTitle
        right={
          data.recent.length > 0 && (
            <button type="button" onClick={() => my.removeRecent()} className="text-xs font-normal text-muted hover:text-bad">
              전체 삭제
            </button>
          )
        }
      >
        최근 열람한 공고
      </SectionTitle>
      {data.recent.length === 0 ? (
        <Note>가능성 확인에서 공고를 고르면 최근 20개까지 여기에 남아요.</Note>
      ) : (
        <ul>
          {data.recent.map((r) => (
            <li key={r.no} className="flex items-baseline gap-3 border-b border-line py-2.5 text-sm">
              <Link href={`/check?no=${r.no}`} className="min-w-0 flex-1 truncate hover:underline">
                {r.name}
              </Link>
              <span className="shrink-0 text-xs whitespace-nowrap text-muted">
                {r.sido} {r.unit} · {md(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(r.viewedAt)))}
              </span>
              <button
                type="button"
                onClick={() => my.removeRecent(r.no)}
                aria-label={`${r.name} 열람 기록 삭제`}
                className="shrink-0 text-xs text-muted hover:text-bad"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ───────────────────────── 5. 계정 ─────────────────────────

function AccountSection({ data }: { data: MeData }) {
  const my = useMy();
  const [edit, setEdit] = useState<MyHome | null>(null);
  const home = edit ?? data.home;
  const dirty = edit !== null && (edit.sido !== data.home.sido || edit.unit !== data.home.unit);
  const [deleting, setDeleting] = useState<"" | "run" | "fail">("");

  return (
    <section>
      <SectionTitle>계정</SectionTitle>
      <div className="flex flex-col gap-2 border-b border-line py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          거주지 <span className="ml-1 text-xs text-muted">시·군 단위까지만 저장해요</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={home.sido}
            onChange={(e) => setEdit({ ...home, sido: e.target.value })}
            aria-label="거주지 시·도"
            className="rounded border border-line bg-white px-2 py-1.5 text-sm"
          >
            <option value="">시·도</option>
            {SIDO_LIST.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <input
            value={home.unit}
            onChange={(e) => setEdit({ ...home, unit: e.target.value })}
            placeholder={home.sido === "서울" ? "예: 강남구" : "예: 수원시"}
            aria-label="거주지 시·군·구"
            className="w-28 rounded border border-line bg-white px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
          <button
            type="button"
            disabled={!dirty}
            onClick={() => {
              my.setHome(home.sido, home.unit.trim());
              setEdit(null);
            }}
            className="rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:bg-line disabled:text-muted"
          >
            저장
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between border-b border-line py-3 text-sm">
        <span>
          {data.nickname}님 <span className="ml-1 text-xs text-muted">카카오 로그인</span>
        </span>
        <button type="button" onClick={my.logout} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
          로그아웃
        </button>
      </div>
      <div className="flex flex-col gap-1 border-b border-line py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-muted">점수 기록, 관심 공고, 최근 열람, 캘린더 일정, 닉네임과 거주지가 모두 지워져요.</span>
        <button
          type="button"
          disabled={deleting === "run"}
          onClick={async () => {
            if (!window.confirm("저장된 내 정보를 모두 삭제할까요? 되돌릴 수 없어요.")) return;
            setDeleting("run");
            if (!(await my.deleteAll())) setDeleting("fail");
          }}
          className="self-start text-xs text-bad underline-offset-2 hover:underline sm:self-auto"
        >
          {deleting === "run" ? "삭제하는 중…" : "내 정보 전체 삭제"}
        </button>
      </div>
      {deleting === "fail" && <p className="mt-1 text-xs text-bad">삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.</p>}
    </section>
  );
}

// ───────────────────────── 작은 부품들 ─────────────────────────

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b-2 border-brand pb-2">
      <h2 className="text-sm font-semibold text-brand">{children}</h2>
      {right}
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-line align-top">
      <td className="w-32 py-2.5 pr-3 whitespace-nowrap text-muted">{label}</td>
      <td className="py-2.5">{children}</td>
    </tr>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-sm text-muted">{children}</p>;
}
