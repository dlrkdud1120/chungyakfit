"use client";

/**
 * 단지 비교 화면
 * 저장된 내 점수를 불러와 단지·주택형마다 판정(lib/judge.ts)을 붙이고, 지역·판정 필터와 정렬을 제공합니다.
 * 데이터는 app/compare/page.tsx가 CSV에서 읽어 넘겨줍니다.
 */

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Complex, ComplexData, HouseType } from "@/lib/complexes";
import { judge, VERDICT_ORDER, VERDICTS, type Judgement, type Verdict } from "@/lib/judge";
import { parseMyScore, readMyScoreRaw, subscribeMyScore, type SavedFuture } from "@/lib/myScore";
import { FUTURE_ASSUMPTIONS } from "@/lib/score";
import { hasManyHard, lotteryRatio, percent, recommendLotteryTypes, type JudgedRow } from "@/lib/lottery";
import { averageCutoff, gapText } from "@/lib/benchmark";
import { FUTURE_SECTION_ID, rowAnchor } from "@/lib/anchors";

const NO_DATA = "데이터 없음";
type Filter = "전체" | Verdict | typeof NO_DATA;

type Row = {
  complex: Complex;
  type: HouseType;
  judgement: Judgement | null;
  lotteryOnly: boolean; // 가점제 세대수가 0 → 추첨으로만 선정
};

type SortKey = "verdict" | "gap" | "avgDesc" | "avgAsc" | "recent";
const SORTS: [SortKey, string][] = [
  ["verdict", "판정 좋은 순"],
  ["gap", "내 점수와 가까운 순"],
  ["avgDesc", "평균 가점 높은 순"],
  ["avgAsc", "평균 가점 낮은 순"],
  ["recent", "공고일 최신 순"],
];

/** 가점 막대의 눈금 범위. 만점(84)이 아니라 실제 당첨 가점이 분포한 구간에 맞춥니다 */
type Scale = { lo: number; hi: number };

function scaleFor(rows: Row[], mine: number | null): Scale {
  const values = rows.flatMap((r) => [r.type.min, r.type.avg, r.type.max]).filter((v): v is number => v !== null);
  if (mine !== null) values.push(mine);
  if (values.length === 0) return { lo: 0, hi: 1 };
  const lo = Math.max(0, Math.floor(Math.min(...values) / 5) * 5 - 5);
  const hi = Math.ceil(Math.max(...values) / 5) * 5 + 5;
  return { lo, hi: hi > lo ? hi : lo + 10 };
}

/** 단지 비교 행에 붙이는 입지 점수 요약 (자세한 근거는 /location) */
export type LocationBrief = { anchor: string; total: number | null; max: number };

export default function CompareList({
  data,
  locations,
}: {
  data: ComplexData;
  locations: Record<string, LocationBrief>;
}) {
  // ── 내 점수: 저장값을 기본으로, 직접 바꿔 넣어 볼 수도 있음
  const savedRaw = useSyncExternalStore(subscribeMyScore, readMyScoreRaw, () => null);
  const saved = useMemo(() => parseMyScore(savedRaw), [savedRaw]);
  const [manual, setManual] = useState<string | null>(null);
  const manualNum = manual !== null && manual !== "" ? Number(manual) : null;
  const manualActive = manualNum !== null && !Number.isNaN(manualNum);
  const myScore = manualActive ? Math.min(Math.max(manualNum, 0), 84) : (saved?.total ?? null);

  // ── 메인 화면에서 /compare#줄id로 들어오면 그 줄로 내려가 잠깐 강조
  useEffect(() => {
    const go = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const el = id ? document.getElementById(id) : null;
      if (!el) return;
      el.scrollIntoView({ block: "start" });
      el.dataset.flash = "1";
      window.setTimeout(() => delete el.dataset.flash, 2500);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);

  // ── 필터·정렬
  const [sido, setSido] = useState("전체");
  const [sigungu, setSigungu] = useState("전체");
  const [filter, setFilter] = useState<Filter>("전체");
  const [sort, setSort] = useState<SortKey>("verdict");

  const sidos = useMemo(() => unique(data.complexes.map((c) => c.sido)), [data]);
  const sigungus = useMemo(
    () => unique(data.complexes.filter((c) => sido === "전체" || c.sido === sido).map((c) => c.sigungu).filter(Boolean)),
    [data, sido],
  );

  // 모든 단지·주택형에 판정 붙이기
  const allRows: Row[] = useMemo(
    () =>
      data.complexes.flatMap((complex) =>
        complex.types.map((type) => {
          const lotteryOnly = type.gajeomSupply === 0;
          return {
            complex,
            type,
            lotteryOnly,
            judgement: myScore === null || lotteryOnly ? null : judge(myScore, type),
          };
        }),
      ),
    [data, myScore],
  );

  const regionRows = allRows.filter(
    (r) => (sido === "전체" || r.complex.sido === sido) && (sigungu === "전체" || r.complex.sigungu === sigungu),
  );

  const counts: Record<Filter, number> = {
    전체: regionRows.length,
    안정: 0,
    도전: 0,
    어려움: 0,
    [NO_DATA]: 0,
  };
  for (const r of regionRows) counts[r.judgement ? r.judgement.verdict : NO_DATA] += 1;

  // 지금 보고 있는 지역의 평균 당첨 가점 (내 점수와 비교용)
  const benchmark = averageCutoff(regionRows.map((r) => r.type));
  const scale = scaleFor(allRows, myScore);

  const rows = regionRows
    .filter((r) => filter === "전체" || (r.judgement ? r.judgement.verdict === filter : filter === NO_DATA))
    .sort(compare(sort, myScore));

  return (
    <div>
      {/* 안내 */}
      <p className="mb-6 border-l-2 border-accent bg-accent/10 px-3 py-2 text-[13px] leading-relaxed text-ink">
        아래 가점은 <b>이미 끝난 분양의 당첨 결과</b>입니다. 다음 분양의 경쟁률과 당첨 가점은 공급 물량, 시세, 규제에 따라 달라지므로
        판정은 참고용이며 당첨을 보장하지 않습니다.
      </p>

      {data.warnings.length > 0 && (
        <details className="mb-6 border-l-2 border-line px-3 py-2 text-[13px]">
          <summary className="cursor-pointer font-semibold text-accent-dark">
            CSV에서 확인할 부분 {data.warnings.length}건
          </summary>
          <ul className="mt-2 space-y-1 text-muted">
            {data.warnings.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        </details>
      )}

      {/* 내 점수 */}
      <div className="flex flex-col gap-3 border-y border-line py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <span className="font-semibold">내 가점</span>
          {saved ? (
            <span className="ml-2 text-muted">
              계산기에서 저장한 점수 {fmt(saved.total)}점 ({saved.savedAt} 기준)
            </span>
          ) : (
            <span className="ml-2 text-muted">
              저장된 점수가 없어요.{" "}
              <Link href="/score" className="text-brand underline">
                계산기에서 구하기
              </Link>
            </span>
          )}
          {myScore !== null && (
            <p className="mt-1 text-xs text-accent-dark">
              {manualActive ? `${fmt(myScore)}점은 ` : ""}
              {gapText(myScore, benchmark)}
              {benchmark && sido !== "전체" && ` · ${sigungu !== "전체" ? sigungu : sido} 기준`}
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">직접 넣어보기</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={84}
            step={0.5}
            placeholder={saved ? fmt(saved.total) : "점수"}
            value={manual ?? ""}
            onChange={(e) => setManual(e.target.value)}
            className="w-20 rounded border border-line bg-white px-2 py-1.5 text-right tabular-nums focus:border-brand focus:outline-none"
          />
          <span>점</span>
          {manual !== null && manual !== "" && (
            <button type="button" onClick={() => setManual(null)} className="text-xs text-muted underline">
              되돌리기
            </button>
          )}
        </label>
      </div>

      {data.complexes.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* 필터 */}
          <div className="flex flex-col gap-3 border-b border-line py-4">
            <FilterLine label="지역">
              <div className="flex flex-wrap items-center gap-2">
                <Segment
                  value={sido}
                  options={["전체", ...sidos].map((s) => [s, s])}
                  onChange={(v) => {
                    setSido(v);
                    setSigungu("전체");
                  }}
                />
                {sigungus.length > 0 && (
                  <select
                    value={sigungu}
                    onChange={(e) => setSigungu(e.target.value)}
                    className="rounded border border-line bg-white px-2 py-1.5 text-sm"
                  >
                    <option>전체</option>
                    {sigungus.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                )}
              </div>
            </FilterLine>
            <FilterLine label="판정">
              <Segment
                value={filter}
                options={(["전체", ...VERDICTS, NO_DATA] as Filter[]).map((v): [string, string] => [
                  v,
                  `${v} ${myScore === null && v !== "전체" && v !== NO_DATA ? "–" : counts[v]}`,
                ])}
                onChange={(v) => setFilter(v as Filter)}
              />
            </FilterLine>
            <FilterLine label="정렬">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rounded border border-line bg-white px-2 py-1.5 text-sm"
              >
                {SORTS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </FilterLine>
          </div>

          {/* 미래 점수로 판정이 좋아지는 단지 */}
          <FutureImprovements
            rows={regionRows}
            nowScore={myScore}
            future={manualActive ? null : (saved?.future ?? null)}
            manualActive={manualActive}
            hasSaved={saved !== null}
          />

          {/* 어려움이 많을 때 추첨제 물량 안내 */}
          {myScore !== null && <LotteryGuide rows={regionRows} />}

          <h2 className="mt-10 text-sm font-semibold text-brand">지금 점수로 본 전체 단지</h2>

          {/* 표 머리 (넓은 화면에서만) */}
          <div className="hidden grid-cols-[1.4fr_0.9fr_1.6fr_0.9fr] gap-4 border-b-2 border-brand py-2 text-xs font-semibold text-brand md:grid">
            <span>단지 · 공고일 · 출처</span>
            <span>주택형 · 공급</span>
            <span>과거 당첨 가점</span>
            <span className="text-right">판정</span>
          </div>

          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">조건에 맞는 단지가 없습니다.</p>
          ) : (
            <ul>
              {rows.map((r, i) => (
                <ResultRow
                  key={`${r.complex.id}-${r.type.type}-${i}`}
                  row={r}
                  myScore={myScore}
                  location={locations[r.complex.id]}
                  scale={scale}
                />
              ))}
            </ul>
          )}
        </>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted">
        판정 기준: 안정 = 내 점수 ≥ 과거 평균, 도전 = 과거 최저 ≤ 내 점수 &lt; 평균, 어려움 = 내 점수 &lt; 과거 최저. 최저나 평균이
        비어 있는 주택형은 &ldquo;데이터 없음&rdquo;으로 판정하지 않습니다. 당첨 가점 출처: 청약홈 &gt; 청약일정 및 통계 &gt; 당첨가점.
      </p>
    </div>
  );
}

// ───────────────────────── 미래 판정 ─────────────────────────

function FutureImprovements({
  rows,
  nowScore,
  future,
  manualActive,
  hasSaved,
}: {
  rows: Row[];
  nowScore: number | null;
  future: SavedFuture[] | null;
  manualActive: boolean;
  hasSaved: boolean;
}) {
  const heading = (
    <h2 className="border-b-2 border-brand pb-2 text-sm font-semibold text-brand">
      시간이 지나면 판정이 좋아지는 단지
    </h2>
  );

  if (nowScore === null || !future || future.length === 0) {
    return (
      <section id={FUTURE_SECTION_ID} className="mt-8 scroll-mt-6">
        {heading}
        <p className="py-4 text-sm text-muted">
          {manualActive
            ? "직접 넣은 점수에는 미래 예측이 없습니다. 되돌리기를 누르면 저장된 점수 기준으로 보여드려요."
            : hasSaved
              ? "미래 점수가 저장되어 있지 않아요. 계산기에서 '이 점수로 단지 비교하기'를 한 번 더 눌러 주세요."
              : "계산기에서 점수를 구하면 1년 뒤, 3년 뒤 판정도 함께 보여드려요."}
        </p>
      </section>
    );
  }

  // 지금 판정이 있는 행 중에서, 미래 어느 시점에라도 판정이 한 단계 이상 좋아지는 것
  const improved = rows
    .filter((r) => !r.lotteryOnly && r.judgement)
    .map((r) => {
      const now = r.judgement!;
      const later = future.map((f) => judge(f.total, r.type));
      const firstBetter = later.findIndex((j) => j && VERDICT_ORDER[j.verdict] < VERDICT_ORDER[now.verdict]);
      return { row: r, now, later, firstBetter };
    })
    .filter((x) => x.firstBetter !== -1)
    .sort((a, b) => a.firstBetter - b.firstBetter || (b.row.type.avg ?? 0) - (a.row.type.avg ?? 0));

  return (
    <section id={FUTURE_SECTION_ID} className="mt-8 scroll-mt-6">
      {heading}

      {/* 점수 변화 요약 */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line py-3 text-sm tabular-nums">
        <span>
          지금 <b className="text-brand">{fmt(nowScore)}</b>점
        </span>
        {future.map((f) => (
          <span key={f.years}>
            {f.years}년 뒤 <b className="text-brand">{fmt(f.total)}</b>점
            {f.total > nowScore && <span className="ml-1 text-xs text-accent-dark">+{fmt(f.total - nowScore)}</span>}
          </span>
        ))}
      </div>

      {improved.length === 0 ? (
        <p className="py-4 text-sm text-muted">
          {future.every((f) => f.total === nowScore)
            ? "앞으로도 점수가 그대로라 판정이 바뀌는 단지가 없습니다."
            : "지금 조건의 단지 중 판정이 바뀌는 곳은 없습니다."}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="py-2 text-left font-normal">단지 · 주택형</th>
              <th className="py-2 text-center font-normal">지금</th>
              {future.map((f) => (
                <th key={f.years} className="py-2 text-center font-normal">
                  {f.years}년 뒤
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {improved.map(({ row, now, later }, i) => (
              <tr key={`${row.complex.id}-${row.type.type}-${i}`} className="border-b border-line">
                <td className="py-2.5 pr-2">
                  <div className="font-medium">
                    {row.complex.name} <span className="text-muted">{row.type.type}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {row.complex.sido} {row.complex.sigungu} · 최저 {val(row.type.min)} · 평균 {val(row.type.avg)}
                  </div>
                </td>
                <td className="py-2.5 text-center">
                  <MiniBadge verdict={now.verdict} />
                </td>
                {later.map((j, k) => {
                  const prev = k === 0 ? now : later[k - 1];
                  const changed = j && prev && j.verdict !== prev.verdict;
                  return (
                    <td key={k} className="py-2.5 text-center">
                      {j ? <MiniBadge verdict={j.verdict} changed={!!changed} /> : <span className="text-xs text-muted">–</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ul className="mt-3 space-y-0.5 text-xs leading-relaxed text-muted">
        {FUTURE_ASSUMPTIONS.map((a) => (
          <li key={a}>· {a}</li>
        ))}
        <li>· 단지의 당첨 가점도 지금 CSV 값 그대로라고 보고 비교합니다. 실제 커트라인은 해마다 달라집니다.</li>
      </ul>
    </section>
  );
}

// ───────────────────────── 추첨제 안내 ─────────────────────────

function LotteryGuide({ rows }: { rows: Row[] }) {
  const judgedRows: JudgedRow[] = rows.map((r) => ({
    complex: r.complex,
    type: r.type,
    verdict: r.judgement?.verdict ?? null,
  }));
  const { hard, judged, many } = hasManyHard(judgedRows);
  if (!many) return null;

  const picks = recommendLotteryTypes(judgedRows);

  return (
    <section className="mt-10">
      <h2 className="border-b-2 border-brand pb-2 text-sm font-semibold text-brand">추첨제로 노려볼 타입</h2>
      <p className="border-b border-line py-3 text-sm leading-relaxed">
        판정이 나온 {judged}개 주택형 중 <b>{hard}개가 어려움</b>입니다. 가점이 부족해도 추첨제 물량은 점수와 상관없이 뽑으므로, 같은
        단지 안에서 추첨 비율이 높은 타입을 함께 살펴보세요.
      </p>

      <ul>
        {picks.map((p) => (
          <li key={p.complex.id} className="border-b border-line py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-semibold">{p.complex.name}</span>
              <span className="text-xs text-muted">
                {p.complex.sido} {p.complex.sigungu} · 공고일 {p.complex.noticeDate ? dot(p.complex.noticeDate) : NO_DATA}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {p.best ? (
                <>
                  어려움: {p.hardTypes.join(", ")} → 추천{" "}
                  <b className="text-accent-dark">{p.best.type.type}</b> (추첨 {percent(p.best.ratio!)},{" "}
                  {cnt(p.best.type.lotterySupply)})
                </>
              ) : (
                <>어려움: {p.hardTypes.join(", ")} → 가점제·추첨제 세대수가 비어 있어 비율을 계산할 수 없습니다.</>
              )}
            </p>

            <table className="mt-2 w-full text-[13px] tabular-nums">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="py-1 text-left font-normal">주택형</th>
                  <th className="py-1 text-right font-normal">추첨 비율</th>
                  <th className="py-1 text-right font-normal">추첨 세대</th>
                  <th className="py-1 text-right font-normal">가점 판정</th>
                </tr>
              </thead>
              <tbody>
                {p.options.map((o) => {
                  const isBest = p.best && o.type === p.best.type;
                  return (
                    <tr key={o.type.type} className={`border-t border-line ${isBest ? "bg-accent/10" : ""}`}>
                      <td className="py-1.5 pl-1">
                        {o.type.type}
                        {isBest && <span className="ml-1.5 text-xs font-semibold text-accent-dark">추천</span>}
                      </td>
                      <td className="py-1.5 text-right">
                        {o.ratio === null ? NO_DATA : percent(o.ratio)}
                        {o.ratio !== null && (
                          <span className="ml-2 inline-block h-1.5 w-12 bg-line align-middle">
                            <span className="block h-1.5 bg-accent" style={{ width: percent(o.ratio) }} />
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right">{cnt(o.type.lotterySupply)}</td>
                      <td className="py-1.5 pr-1 text-right text-xs">
                        {o.verdict ?? (o.type.gajeomSupply === 0 ? "추첨만" : NO_DATA)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </li>
        ))}
      </ul>

      <ul className="mt-3 space-y-0.5 text-xs leading-relaxed text-muted">
        <li>· 추첨 비율은 CSV에 적은 공고별 가점제·추첨제 세대수로 계산합니다. 세대수가 비어 있는 타입은 비율을 계산하지 않습니다.</li>
        <li>· 추첨제도 청약 1순위 자격이 필요하고, 무주택자 우선 배정 같은 조건이 공고마다 다르므로 입주자모집공고를 꼭 확인하세요.</li>
        <li>· 추첨은 점수와 상관없이 뽑지만 경쟁률이 높으면 당첨 확률은 낮습니다. 물량이 많을수록 기회가 늘어난다는 뜻으로 봐 주세요.</li>
      </ul>
    </section>
  );
}

function MiniBadge({ verdict, changed = false }: { verdict: Verdict; changed?: boolean }) {
  return (
    <span
      className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-semibold ${BADGE[verdict]} ${
        changed ? "ring-2 ring-accent ring-offset-1" : ""
      }`}
    >
      {changed && "↑ "}
      {verdict}
    </span>
  );
}

// ───────────────────────── 한 줄 ─────────────────────────

function ResultRow({
  row,
  myScore,
  location,
  scale,
}: {
  row: Row;
  myScore: number | null;
  location: LocationBrief | undefined;
  scale: Scale;
}) {
  const { complex, type, judgement, lotteryOnly } = row;
  return (
    <li
      id={rowAnchor(complex.id, type.type)}
      className="grid scroll-mt-6 grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-b border-line py-4 transition-colors duration-700 data-[flash]:bg-accent/15 md:grid-cols-[1.4fr_0.9fr_1.6fr_0.9fr] md:items-center"
    >
      {/* 단지 */}
      <div className="min-w-0">
        <div className="text-[15px] font-semibold">{complex.name}</div>
        <div className="text-xs text-muted">
          {complex.sido} {complex.sigungu} · 공고일 {complex.noticeDate ? dot(complex.noticeDate) : NO_DATA}
        </div>
        <div className="text-[11px] text-muted">
          청약홈 당첨가점 기준{type.checkedAt ? ` (${dot(type.checkedAt)} 확인)` : ""}
        </div>
        {location && (
          <Link href={`/location#${location.anchor}`} className="mt-0.5 inline-block text-xs text-brand underline-offset-2 hover:underline">
            입지 {location.total === null ? NO_DATA : `${location.total}/${location.max}점`} · 근거 보기
          </Link>
        )}
      </div>

      {/* 판정 (모바일에서는 오른쪽 위) */}
      <div className="text-right md:order-last">
        <VerdictBadge judgement={judgement} hasScore={myScore !== null} lotteryOnly={lotteryOnly} />
        {judgement && <div className="mt-1 text-[11px] leading-snug text-muted">{judgement.reason}</div>}
      </div>

      {/* 주택형 */}
      <div className="col-span-2 text-sm md:col-span-1">
        <span className="font-medium">{type.type}</span>
        <span className="text-muted"> · 공급 {cnt(type.supply)}</span>
        <div className="text-xs text-muted">
          가점제 {cnt(type.gajeomSupply)} · 추첨제 {cnt(type.lotterySupply)}
          {lotteryRatio(type) !== null && ` (추첨 ${percent(lotteryRatio(type)!)})`}
        </div>
      </div>

      {/* 가점 범위 */}
      <div className="col-span-2 md:col-span-1">
        {lotteryOnly ? (
          <div className="text-xs text-muted">가점제 물량이 없어 추첨으로만 선정합니다.</div>
        ) : (
          <>
            <ScoreBar type={type} mine={myScore} scale={scale} />
            <div className="mt-1 text-xs tabular-nums text-muted">
              최저 {val(type.min)} · 평균 <b className="text-ink">{val(type.avg)}</b> · 최고 {val(type.max)}
            </div>
          </>
        )}
      </div>
    </li>
  );
}

/** 최저~최고 당첨 가점 범위(연한 초록), 평균(세로선), 내 점수(주황 점). 눈금은 실제 당첨 가점 분포 구간 */
function ScoreBar({ type, mine, scale }: { type: HouseType; mine: number | null; scale: Scale }) {
  const pos = (n: number) => `${((Math.min(Math.max(n, scale.lo), scale.hi) - scale.lo) / (scale.hi - scale.lo)) * 100}%`;
  const { min, avg, max } = type;
  return (
    <div className="relative h-4" aria-hidden>
      <div className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-line" />
      {min !== null && max !== null && (
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 bg-brand/20"
          style={{ left: pos(min), width: `calc(${pos(max)} - ${pos(min)})` }}
        />
      )}
      {avg !== null && <div className="absolute top-0.5 h-3 w-0.5 -translate-x-1/2 bg-brand" style={{ left: pos(avg) }} />}
      {mine !== null && (
        <div
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent ring-1 ring-accent"
          style={{ left: pos(mine) }}
        />
      )}
    </div>
  );
}

const BADGE: Record<Verdict, string> = {
  안정: "bg-brand text-white",
  도전: "bg-accent text-ink",
  어려움: "bg-line text-muted",
};

function VerdictBadge({
  judgement,
  hasScore,
  lotteryOnly,
}: {
  judgement: Judgement | null;
  hasScore: boolean;
  lotteryOnly: boolean;
}) {
  if (lotteryOnly) return <span className="text-xs text-muted">추첨만</span>;
  if (!hasScore) return <span className="text-xs text-muted">점수 필요</span>;
  if (!judgement) return <span className="text-xs text-muted">{NO_DATA}</span>;
  return (
    <span className={`inline-block rounded-sm px-2 py-0.5 text-xs font-semibold ${BADGE[judgement.verdict]}`}>
      {judgement.verdict}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="py-10 text-sm leading-relaxed text-muted">
      <p className="font-semibold text-ink">아직 등록된 단지가 없습니다.</p>
      <p className="mt-2">
        청약홈 &gt; 청약일정 및 통계 &gt; 당첨가점에서 확인한 값을 <code className="text-ink">data/complexes.csv</code>에 한 줄씩
        추가하고 다시 배포하면 여기에 나타납니다.
      </p>
    </div>
  );
}

// ───────────────────────── 작은 부품·도우미 ─────────────────────────

function FilterLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-10 shrink-0 text-xs font-semibold text-muted">{label}</span>
      {children}
    </div>
  );
}

function Segment({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex max-w-full flex-wrap overflow-hidden rounded border border-line text-sm">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`border-l border-line px-3 py-1.5 whitespace-nowrap first:border-l-0 ${
            value === v ? "bg-brand text-white" : "bg-white text-ink hover:bg-brand/5"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const unique = (list: string[]) => [...new Set(list)];
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const val = (n: number | null) => (n === null ? NO_DATA : fmt(n));
const cnt = (n: number | null) => (n === null ? NO_DATA : `${n}세대`);
const dot = (d: string) => d.replaceAll("-", ".");

/** 정렬 규칙. 평균 가점이 없는 행(데이터 없음·추첨만)은 항상 맨 아래 */
function compare(sort: SortKey, myScore: number | null) {
  return (a: Row, b: Row): number => {
    const aa = a.lotteryOnly ? null : a.type.avg;
    const bb = b.lotteryOnly ? null : b.type.avg;
    if (sort === "recent") {
      return (b.complex.noticeDate ?? "").localeCompare(a.complex.noticeDate ?? "");
    }
    if (aa === null || bb === null) {
      if (aa === bb) return a.complex.name.localeCompare(b.complex.name, "ko");
      return aa === null ? 1 : -1;
    }
    switch (sort) {
      case "verdict": {
        const va = a.judgement ? VERDICT_ORDER[a.judgement.verdict] : 9;
        const vb = b.judgement ? VERDICT_ORDER[b.judgement.verdict] : 9;
        return va - vb || bb - aa; // 같은 판정이면 평균 높은(인기 많은) 단지 먼저
      }
      case "gap":
        return myScore === null ? bb - aa : Math.abs(aa - myScore) - Math.abs(bb - myScore);
      case "avgDesc":
        return bb - aa;
      case "avgAsc":
        return aa - bb;
    }
  };
}
