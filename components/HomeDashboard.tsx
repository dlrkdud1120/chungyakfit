"use client";

/**
 * 메인 화면 내용
 * 1) 내 청약 현황  2) 노려볼 만한 단지  3) 1년 뒤 달라지는 점  4) 다가오는 분양공고
 * 판정은 lib/judge.ts를 그대로 쓰고, 이 파일은 요약해서 보여주기만 합니다.
 */

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { FUTURE_SECTION_ID, rowAnchor } from "@/lib/anchors";
import type { Notice, NoticeResult } from "@/lib/applyhome";
import { averageCutoff, gapText } from "@/lib/benchmark";
import type { Complex, HouseType } from "@/lib/complexes";
import { judge, VERDICT_ORDER, VERDICTS, type Verdict } from "@/lib/judge";
import { parseMyScore, readMyScoreRaw, subscribeMyScore } from "@/lib/myScore";
import { useComplexes } from "@/lib/useComplexes";

const TOP_N = 5; // 노려볼 단지·분양공고를 몇 개까지 보여줄지

type Row = { complex: Complex; type: HouseType; verdict: Verdict | null };

/** fallback: 청약홈 API가 실패할 때 쓰는 data/complexes.csv 단지 */
export default function HomeDashboard({ fallback }: { fallback: Complex[] }) {
  const savedRaw = useSyncExternalStore(subscribeMyScore, readMyScoreRaw, () => null);
  const saved = useMemo(() => parseMyScore(savedRaw), [savedRaw]);
  const cs = useComplexes(fallback);
  const complexes = cs.complexes;
  const benchmark = useMemo(() => averageCutoff(complexes.flatMap((c) => c.types)), [complexes]);
  const benchLabel = cs.source === "api" && cs.scope ? cs.scope : "관심 단지";

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
    <div className="grid gap-x-12 gap-y-10 lg:grid-cols-2">
      <MyStatus saved={saved} rows={rows} benchmarkText={saved ? gapText(saved.total, benchmark, benchLabel) : ""} />
      <Targets hasScore={saved !== null} rows={rows} />
      <NextYear saved={saved} rows={rows} />
      <UpcomingNotices />
    </div>
  );
}

// ───────────────────────── 1. 내 청약 현황 ─────────────────────────

function MyStatus({
  saved,
  rows,
  benchmarkText,
}: {
  saved: ReturnType<typeof parseMyScore>;
  rows: Row[];
  benchmarkText: string;
}) {
  if (!saved) {
    return (
      <Section title="내 청약 현황" href="/score">
        <p className="py-4 text-sm text-muted">가점을 먼저 계산해 보세요.</p>
        <Link
          href="/score"
          className="inline-block rounded bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90"
        >
          가점 계산하기
        </Link>
      </Section>
    );
  }

  const counts = Object.fromEntries(VERDICTS.map((v) => [v, rows.filter((r) => r.verdict === v).length])) as Record<
    Verdict,
    number
  >;
  const judged = rows.filter((r) => r.verdict !== null).length;

  return (
    <Section title="내 청약 현황" href="/score">
      <table className="w-full text-sm tabular-nums">
        <tbody>
          <Line label="무주택기간" value={`${fmt(saved.homeless)}점`} />
          <Line label="부양가족" value={`${fmt(saved.dependents)}점`} />
          <Line label="청약통장 가입기간" value={`${fmt(saved.account)}점`} />
          <tr className="border-b border-line">
            <td className="py-2.5 font-semibold">합계</td>
            <td className="py-2.5 text-right">
              <b className="text-brand">{fmt(saved.total)}점</b>
              <div className="text-xs font-normal text-accent-dark">{benchmarkText}</div>
            </td>
          </tr>
          <tr className="border-b border-line">
            <td className="py-2.5">판정 요약</td>
            <td className="py-2.5 text-right">
              {judged === 0 ? (
                <span className="text-muted">판정할 단지 데이터가 아직 없습니다</span>
              ) : (
                <span>
                  안정 <b className="text-brand">{counts["안정"]}</b> · 도전 <b className="text-accent-dark">{counts["도전"]}</b> ·
                  어려움 <b>{counts["어려움"]}</b>
                  <span className="ml-1 text-xs text-muted">(주택형 기준)</span>
                </span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">{saved.savedAt} 기준으로 저장한 점수입니다.</p>
      <Link
        href="/check"
        className="mt-4 inline-block rounded bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90"
      >
        원하는 단지 가능성 확인하기 →
      </Link>
    </Section>
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
                  <Link href={`/compare#${rowAnchor(r.complex.id, r.type.type)}`} className="hover:underline">
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

// ───────────────────────── 3. 1년 뒤 달라지는 점 ─────────────────────────

function NextYear({ saved, rows }: { saved: ReturnType<typeof parseMyScore>; rows: Row[] }) {
  const oneYear = saved?.future?.find((f) => f.years === 1);

  let body: React.ReactNode;
  if (!saved) {
    body = <Empty>가점을 계산하면 1년 뒤 점수와 판정 변화를 알려드려요.</Empty>;
  } else if (!oneYear) {
    body = <Empty>미래 점수가 저장되어 있지 않아요. 가점 계산에서 &lsquo;이 점수로 단지 비교하기&rsquo;를 한 번 더 눌러 주세요.</Empty>;
  } else {
    const ups = rows
      .filter((r) => r.verdict !== null)
      .map((r) => ({ r, later: judge(oneYear.total, r.type)?.verdict ?? null }))
      .filter((x) => x.later && VERDICT_ORDER[x.later] < VERDICT_ORDER[x.r.verdict!]);

    const diff = oneYear.total - saved.total;
    body = (
      <>
        <p className="border-b border-line py-2.5 text-sm">
          1년 뒤 점수 <b className="text-brand">{fmt(oneYear.total)}점</b>
          {diff > 0 ? <span className="ml-1 text-accent-dark">(+{fmt(diff)}점)</span> : <span className="ml-1 text-muted">(변화 없음)</span>}
        </p>
        {ups.length === 0 ? (
          <Empty>1년 뒤 점수로 판정이 올라가는 단지는 없습니다.</Empty>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {ups.slice(0, TOP_N).map(({ r, later }) => (
                <tr key={`${r.complex.id}-${r.type.type}`} className="border-b border-line">
                  <td className="py-2.5 pr-2">
                    {r.complex.name} <span className="text-muted">{r.type.type}</span>
                  </td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    <VerdictText verdict={r.verdict!} /> <span className="text-muted">→</span> <VerdictText verdict={later!} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-muted">부양가족 수는 그대로라고 가정한 예측입니다.</p>
      </>
    );
  }

  return (
    <Section title="1년 뒤 달라지는 점" href={`/compare#${FUTURE_SECTION_ID}`}>
      {body}
    </Section>
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
                    <Link href={`/check?no=${encodeURIComponent(n.houseManageNo)}`} className="font-medium hover:underline">
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

function Line({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-line">
      <td className="py-2.5">{label}</td>
      <td className="py-2.5 text-right">{value}</td>
    </tr>
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
