"use client";

/**
 * 메인 화면 내용 — 세 가지만
 * 1) 내 점수와 성장 단계 한 줄  2) 내 점수로 노려볼 만한 단지 3개  3) 다가오는 분양공고 3개
 * (1년 뒤 달라지는 점은 단지 비교의 "시간이 지나면 판정이 좋아지는 단지"와 가점 계산의 계산 근거에서 볼 수 있음)
 * 판정은 lib/judge.ts를 그대로 쓰고, 이 파일은 요약해서 보여주기만 합니다.
 */

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useMy } from "@/components/Providers";
import { ddayText, md, nextEvent, todayKST } from "@/lib/mySchedule";
import type { Notice, NoticeResult } from "@/lib/applyhome";
import { growthStage } from "@/lib/growth";
import type { Complex, HouseType } from "@/lib/complexes";
import { judge, VERDICT_ORDER, type Verdict } from "@/lib/judge";
import { parseMyScore, readMyScoreRaw, subscribeMyScore } from "@/lib/myScore";
import { useComplexes } from "@/lib/useComplexes";

const TOP_N = 3; // 노려볼 단지·분양공고를 몇 개까지 보여줄지

type Row = { complex: Complex; type: HouseType; verdict: Verdict | null };

/** fallback: 청약홈 API가 실패할 때 쓰는 data/complexes.csv 단지 */
export default function HomeDashboard({ fallback }: { fallback: Complex[] }) {
  const savedRaw = useSyncExternalStore(subscribeMyScore, readMyScoreRaw, () => null);
  const saved = useMemo(() => parseMyScore(savedRaw), [savedRaw]);
  const cs = useComplexes(fallback);
  const complexes = cs.complexes;

  // 단지·주택형마다 지금 판정 (가점제 물량이 없으면 판정하지 않음)
  const rows: Row[] = useMemo(
    () =>
      complexes.flatMap((complex) =>
        complex.types.map((type) => ({
          complex,
          type,
          verdict: saved && type.gajeomSupply !== 0 ? (judge(saved.total, type)?.verdict ?? null) : null,
        })),
      ),
    [complexes, saved],
  );

  return (
    <div className="max-w-2xl space-y-10">
      <ScoreLine saved={saved} />
      <Targets hasScore={saved !== null} rows={rows} />
      <UpcomingNotices />
    </div>
  );
}

// ───────────────────────── 1. 내 점수와 성장 단계 한 줄 ─────────────────────────

function ScoreLine({ saved }: { saved: ReturnType<typeof parseMyScore> }) {
  if (!saved) {
    return (
      <div className="flex items-center justify-between gap-3 border-y border-line py-3 text-sm">
        <span className="text-muted">가점을 먼저 계산해 보세요.</span>
        <Link href="/score" className="shrink-0 rounded bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90">
          가점 계산하기
        </Link>
      </div>
    );
  }
  const stage = growthStage(saved.total);
  return (
    <div className="flex items-center justify-between gap-3 border-y border-line py-3 text-sm">
      <span className="min-w-0">
        <span className="mr-1.5 text-xs text-muted">내 점수</span>
        <b className="text-brand">{fmt(saved.total)}점</b>
        <span className="mr-1.5 ml-4 text-xs text-muted">성장 단계</span>
        {stage.name}{" "}
        <span className="text-xs text-muted">
          ({stage.step}/{stage.of})
        </span>
      </span>
      <Link href="/check" className="shrink-0 text-xs text-brand underline underline-offset-2">
        가능성 확인 →
      </Link>
    </div>
  );
}

// ───────────────────────── 2. 노려볼 만한 단지 ─────────────────────────

function Targets({ hasScore, rows }: { hasScore: boolean; rows: Row[] }) {
  const picks = rows
    .filter((r) => r.verdict === "안정" || r.verdict === "도전")
    .sort(
      (a, b) =>
        VERDICT_ORDER[a.verdict!] - VERDICT_ORDER[b.verdict!] || (b.type.avg ?? 0) - (a.type.avg ?? 0), // 같은 판정이면 인기(평균 가점) 높은 곳 먼저
    )
    .slice(0, TOP_N);

  return (
    <Section title="내 점수로 노려볼 만한 단지" href="/compare">
      {!hasScore ? (
        <Empty>가점을 계산하면 안정·도전 단지를 골라 드려요.</Empty>
      ) : picks.length === 0 ? (
        <Empty>지금 점수로 안정·도전인 단지가 없습니다. 추첨제 물량은 단지 비교에서 확인해 보세요.</Empty>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="py-2 text-left font-normal">단지 · 주택형</th>
              <th className="py-2 text-right font-normal">평균 가점</th>
              <th className="py-2 text-right font-normal">판정</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((r) => (
              <tr key={`${r.complex.id}-${r.type.type}`} className="border-b border-line">
                <td className="py-2.5 pr-2">
                  <Link href={`/compare?${new URLSearchParams({ id: r.complex.id, t: r.type.type })}`} className="hover:underline">
                    <span className="font-medium">{r.complex.name}</span> <span className="text-muted">{r.type.type}</span>
                  </Link>
                  <div className="text-xs text-muted">
                    {r.complex.sido} {r.complex.sigungu}
                  </div>
                </td>
                <td className="py-2.5 text-right tabular-nums">{r.type.avg !== null ? `${fmt(r.type.avg)}점` : "–"}</td>
                <td className="py-2.5 text-right">
                  <VerdictText verdict={r.verdict!} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

// ───────────────────────── 로그인한 사용자: 내 관심 공고 다음 일정 한 줄 ─────────────────────────

function MyNextEvent() {
  const my = useMy();
  if (my.status !== "user" || !my.data) return null;
  const today = todayKST();
  const next = my.data.favorites
    .map((f) => ({ f, u: nextEvent(f.schedule, today) }))
    .filter((x): x is { f: (typeof x)["f"]; u: NonNullable<(typeof x)["u"]> } => x.u !== null)
    .sort((a, b) => a.u.start.localeCompare(b.u.start))[0];
  return (
    <Link
      href="/mypage"
      className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 text-sm hover:bg-brand/5"
    >
      <span className="min-w-0 truncate">
        <span className="mr-2 text-xs text-muted">내 관심 공고 다음 일정</span>
        {next ? `${next.f.name} ${ddayText(next.u)} (${md(next.u.start)})` : "예정된 일정이 없어요"}
      </span>
      <span className="shrink-0 text-xs text-muted">마이페이지 →</span>
    </Link>
  );
}

// ───────────────────────── 4. 다가오는 분양공고 ─────────────────────────

type NoticeState = { status: "loading" } | { status: "fail"; reason: string } | { status: "ok"; list: Notice[]; today: string };

function UpcomingNotices() {
  const [state, setState] = useState<NoticeState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    fetch("/api/notices")
      .then((r) => r.json() as Promise<NoticeResult>)
      .catch((): NoticeResult => ({ ok: false, reason: "서버에 연결하지 못했습니다." }))
      .then((result) => {
        if (!alive) return;
        if (!result.ok) return setState({ status: "fail", reason: result.reason });
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
        // 접수가 아직 끝나지 않은 일반 APT 공고를 접수 시작일이 가까운 순으로
        const list = result.notices
          .filter((n) => n.kind === "APT" && n.receiptEnd && n.receiptEnd >= today)
          .sort((a, b) => (a.receiptStart ?? "").localeCompare(b.receiptStart ?? ""))
          .slice(0, TOP_N);
        setState({ status: "ok", list, today });
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Section title="다가오는 분양공고" href="/notice">
      {/* 로그인한 사용자: 내 관심 공고의 다음 일정 한 줄 */}
      <MyNextEvent />
      {state.status === "loading" && <Empty>청약홈에서 공고를 불러오는 중…</Empty>}
      {state.status === "fail" && <Empty>공고를 불러오지 못했습니다. ({state.reason})</Empty>}
      {state.status === "ok" &&
        (state.list.length === 0 ? (
          <Empty>접수 예정이거나 접수 중인 서울·경기 공고가 없습니다.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="py-2 text-left font-normal">단지</th>
                <th className="py-2 text-right font-normal">청약접수</th>
              </tr>
            </thead>
            <tbody>
              {state.list.map((n) => (
                <tr key={n.houseManageNo || n.name} className="border-b border-line">
                  <td className="py-2.5 pr-2">
                    <Link href={`/notice?no=${encodeURIComponent(n.houseManageNo)}`} className="font-medium hover:underline">
                      {n.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {n.region} {n.unit}
                    </div>
                  </td>
                  <td className="py-2.5 text-right whitespace-nowrap tabular-nums">
                    {dot(n.receiptStart)} ~ {dot(n.receiptEnd)}
                    <div className="text-xs text-accent-dark">{dday(n.receiptStart, n.receiptEnd, state.today)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </Section>
  );
}

// ───────────────────────── 작은 부품 ─────────────────────────

function Section({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between border-b-2 border-brand pb-2">
        <h2 className="text-sm font-semibold text-brand">{title}</h2>
        <Link href={href} className="text-xs text-muted hover:text-brand">
          전체 보기 →
        </Link>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-sm text-muted">{children}</p>;
}

function VerdictText({ verdict }: { verdict: Verdict }) {
  const color = verdict === "안정" ? "text-brand" : verdict === "도전" ? "text-accent-dark" : "text-muted";
  return <span className={`text-xs font-semibold ${color}`}>{verdict}</span>;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const dot = (d: string | null) => (d ? d.slice(5).replace("-", ".") : "–");

function dday(start: string | null, end: string | null, today: string): string {
  if (start && start > today) {
    const days = Math.round((Date.parse(start) - Date.parse(today)) / 86400000);
    return `접수 D-${days}`;
  }
  if (end && end >= today) return "접수 중";
  return "";
}
