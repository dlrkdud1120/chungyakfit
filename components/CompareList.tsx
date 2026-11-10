"use client";

/**
 * 단지 비교 화면
 * 저장된 내 점수를 불러와 단지·주택형마다 판정(lib/judge.ts)을 붙이고, 지역·판정 필터와 정렬을 제공합니다.
 */

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { splitSupply, type Complex, type ComplexData, type HouseType } from "@/lib/complexes";
import { judge, VERDICT_ORDER, VERDICTS, type Judgement, type Verdict } from "@/lib/judge";
import { parseMyScore, readMyScoreRaw, subscribeMyScore } from "@/lib/myScore";

type Row = { complex: Complex; type: HouseType; judgement: Judgement | null };

type SortKey = "verdict" | "avgDesc" | "avgAsc" | "gap" | "recent";
const SORTS: [SortKey, string][] = [
  ["verdict", "판정 좋은 순"],
  ["gap", "내 점수와 가까운 순"],
  ["avgDesc", "평균 가점 높은 순"],
  ["avgAsc", "평균 가점 낮은 순"],
  ["recent", "분양 최신 순"],
];

// 가점 막대의 눈금 범위
const SCALE_MIN = 20;
const SCALE_MAX = 84;

export default function CompareList({ data }: { data: ComplexData }) {
  // ── 내 점수: 저장값을 기본으로, 직접 바꿔 넣어 볼 수도 있음
  const savedRaw = useSyncExternalStore(subscribeMyScore, readMyScoreRaw, () => null);
  const saved = useMemo(() => parseMyScore(savedRaw), [savedRaw]);
  const [manual, setManual] = useState<string | null>(null);
  const manualNum = manual !== null && manual !== "" ? Number(manual) : null;
  const myScore =
    manualNum !== null && !Number.isNaN(manualNum) ? Math.min(Math.max(manualNum, 0), 84) : (saved?.total ?? null);

  // ── 필터·정렬
  const [sido, setSido] = useState("전체");
  const [sigungu, setSigungu] = useState("전체");
  const [verdict, setVerdict] = useState<Verdict | "전체">("전체");
  const [sort, setSort] = useState<SortKey>("verdict");

  const sidos = useMemo(() => unique(data.complexes.map((c) => c.region.sido)), [data]);
  const sigungus = useMemo(
    () => unique(data.complexes.filter((c) => sido === "전체" || c.region.sido === sido).map((c) => c.region.sigungu)),
    [data, sido],
  );

  // 모든 단지·타입에 판정 붙이기
  const allRows: Row[] = useMemo(
    () =>
      data.complexes.flatMap((complex) =>
        complex.types.map((type) => ({
          complex,
          type,
          judgement: myScore === null ? null : judge(myScore, type.score),
        })),
      ),
    [data, myScore],
  );

  // 지역 필터만 적용한 행 (판정별 개수 셀 때 사용)
  const regionRows = allRows.filter(
    (r) =>
      (sido === "전체" || r.complex.region.sido === sido) &&
      (sigungu === "전체" || r.complex.region.sigungu === sigungu),
  );

  const counts = Object.fromEntries(
    VERDICTS.map((v) => [v, regionRows.filter((r) => r.judgement?.verdict === v).length]),
  ) as Record<Verdict, number>;

  const rows = regionRows
    .filter((r) => verdict === "전체" || r.judgement?.verdict === verdict)
    .sort(compare(sort, myScore));

  return (
    <div>
      {data.meta.isSample && (
        <p className="mb-6 border-l-2 border-accent bg-accent/10 px-3 py-2 text-[13px] text-ink">
          지금 보이는 단지와 가점은 <b>수업용 가상 예시 데이터</b>입니다. 실제 단지가 아닙니다.
        </p>
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
              <Link href="/" className="text-brand underline">
                계산기에서 구하기
              </Link>
            </span>
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
          </div>
        </FilterLine>
        <FilterLine label="판정">
          <Segment
            value={verdict}
            options={[
              ["전체", `전체 ${regionRows.length}`],
              ...VERDICTS.map((v): [string, string] => [v, `${v} ${myScore === null ? "–" : counts[v]}`]),
            ]}
            onChange={(v) => setVerdict(v as Verdict | "전체")}
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

      {/* 표 머리 (넓은 화면에서만) */}
      <div className="hidden grid-cols-[1.4fr_0.9fr_1.6fr_0.9fr] gap-4 border-b-2 border-brand py-2 text-xs font-semibold text-brand md:grid">
        <span>단지</span>
        <span>주택형 · 공급</span>
        <span>과거 당첨 가점</span>
        <span className="text-right">판정</span>
      </div>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">조건에 맞는 단지가 없습니다.</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <ResultRow key={`${r.complex.id}-${r.type.type}`} row={r} myScore={myScore} />
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted">
        판정 기준: 안정 = 내 점수 ≥ 과거 평균, 도전 = 과거 최저 ≤ 내 점수 &lt; 평균, 어려움 = 내 점수 &lt; 과거 최저.
        과거 당첨 가점은 다음 분양의 결과를 보장하지 않습니다.
      </p>
    </div>
  );
}

// ───────────────────────── 한 줄 ─────────────────────────

function ResultRow({ row, myScore }: { row: Row; myScore: number | null }) {
  const { complex, type, judgement } = row;
  const { gajeom, lottery } = splitSupply(type);
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-b border-line py-4 md:grid-cols-[1.4fr_0.9fr_1.6fr_0.9fr] md:items-center">
      {/* 단지 */}
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold">{complex.name}</div>
        <div className="text-xs text-muted">
          {complex.region.sido} {complex.region.sigungu} · {complex.saleMonth.replace("-", ".")} 분양
        </div>
      </div>

      {/* 판정 (모바일에서는 오른쪽 위) */}
      <div className="text-right md:order-last">
        <VerdictBadge judgement={judgement} hasScore={myScore !== null} />
        {judgement && <div className="mt-1 text-[11px] leading-snug text-muted">{judgement.reason}</div>}
      </div>

      {/* 주택형 */}
      <div className="col-span-2 text-sm md:col-span-1">
        <span className="font-medium">{type.type}</span>
        <span className="text-muted"> · {type.area}㎡ · {type.supply}세대</span>
        <div className="text-xs text-muted">
          가점 {gajeom} · 추첨 {lottery}세대 ({Math.round(type.gajeomRatio * 100)}:{Math.round(type.lotteryRatio * 100)})
        </div>
      </div>

      {/* 가점 범위 */}
      <div className="col-span-2 md:col-span-1">
        {type.score ? (
          <>
            <ScoreBar min={type.score.min} avg={type.score.avg} max={type.score.max} mine={myScore} />
            <div className="mt-1 text-xs tabular-nums text-muted">
              최저 {type.score.min} · 평균 <b className="text-ink">{type.score.avg}</b> · 최고 {type.score.max}
            </div>
          </>
        ) : (
          <div className="text-xs text-muted">가점제 물량이 없어 추첨으로만 뽑습니다.</div>
        )}
      </div>
    </li>
  );
}

function ScoreBar({ min, avg, max, mine }: { min: number; avg: number; max: number; mine: number | null }) {
  const pos = (n: number) => `${((Math.min(Math.max(n, SCALE_MIN), SCALE_MAX) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100}%`;
  return (
    <div className="relative h-4" aria-hidden>
      <div className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-line" />
      <div className="absolute top-1/2 h-1.5 -translate-y-1/2 bg-brand/20" style={{ left: pos(min), width: `calc(${pos(max)} - ${pos(min)})` }} />
      <div className="absolute top-0.5 h-3 w-0.5 -translate-x-1/2 bg-brand" style={{ left: pos(avg) }} />
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

function VerdictBadge({ judgement, hasScore }: { judgement: Judgement | null; hasScore: boolean }) {
  if (!hasScore) return <span className="text-xs text-muted">점수 필요</span>;
  if (!judgement) return <span className="text-xs text-muted">추첨만</span>;
  return (
    <span className={`inline-block rounded-sm px-2 py-0.5 text-xs font-semibold ${BADGE[judgement.verdict]}`}>
      {judgement.verdict}
    </span>
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
    <div className="inline-flex overflow-hidden rounded border border-line text-sm">
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

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 정렬 규칙. 가점 정보가 없는 타입(추첨만)은 항상 맨 아래 */
function compare(sort: SortKey, myScore: number | null) {
  const avg = (r: Row) => r.type.score?.avg ?? null;
  return (a: Row, b: Row): number => {
    const aa = avg(a);
    const bb = avg(b);
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
        if (myScore === null) return bb - aa;
        return Math.abs(aa - myScore) - Math.abs(bb - myScore);
      case "avgDesc":
        return bb - aa;
      case "avgAsc":
        return aa - bb;
      case "recent":
        return b.complex.saleMonth.localeCompare(a.complex.saleMonth) || bb - aa;
    }
  };
}
