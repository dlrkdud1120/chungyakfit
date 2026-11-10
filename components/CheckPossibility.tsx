"use client";

/**
 * 당첨 가능성 확인 화면 (앱의 핵심 기능)
 *  1) 내 가점과 거주지
 *  2) 원하는 단지 고르기 — 다가오는 분양공고에서 / 지역·면적 직접
 *  3) 비슷한 과거 사례(/api/similar)로 lib/judge.ts 판정 + 근거 사례 표
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Notice, NoticeResult } from "@/lib/applyhome";
import { judge, type Verdict } from "@/lib/judge";
import { parseMyHome, readMyHomeRaw, saveMyHome, subscribeMyHome } from "@/lib/myHome";
import { parseMyScore, readMyScoreRaw, subscribeMyScore } from "@/lib/myScore";
import {
  areaOf,
  bandLabel,
  bandOf,
  resideFor,
  shortSido,
  shortType,
  SIDO_LIST,
  SIMILAR_RULES,
  type BandId,
  type Reside,
  type SimilarResult,
} from "@/lib/similar";

type Mode = "notice" | "manual";
type Target = { sido: string; unit: string; band: BandId; exclude?: string; label: string };
type SimilarResponse =
  | { ok: true; result: SimilarResult; fetchedAt: string; totalRows: number }
  | { ok: false; reason: string };

export default function CheckPossibility() {
  const params = useSearchParams();

  // ── 1. 내 가점 (저장값, 직접 바꿔볼 수 있음)
  const savedRaw = useSyncExternalStore(subscribeMyScore, readMyScoreRaw, () => null);
  const saved = useMemo(() => parseMyScore(savedRaw), [savedRaw]);
  const [manualScore, setManualScore] = useState("");
  const manualNum = manualScore === "" ? null : Number(manualScore);
  const myScore = manualNum !== null && !Number.isNaN(manualNum) ? manualNum : (saved?.total ?? null);

  // ── 내 거주지 (브라우저에 저장)
  const homeRaw = useSyncExternalStore(subscribeMyHome, readMyHomeRaw, () => null);
  const home = useMemo(() => parseMyHome(homeRaw), [homeRaw]);

  // ── 2. 원하는 단지
  const [mode, setMode] = useState<Mode>("notice");
  const [noticeNo, setNoticeNo] = useState(params.get("no") ?? "");
  const [noticeType, setNoticeType] = useState(params.get("type") ?? "");
  const [noticeBand, setNoticeBand] = useState<BandId>("m"); // 주택형 정보가 없을 때만 사용
  const [manual, setManual] = useState<{ sido: string; unit: string; band: BandId }>({ sido: "서울", unit: "", band: "m" });
  const [resideOverride, setResideOverride] = useState<Reside | null>(null);

  // 분양 공고 불러오기
  const [notices, setNotices] = useState<{ status: "loading" } | { status: "fail"; reason: string } | { status: "ok"; list: Notice[] }>({
    status: "loading",
  });
  useEffect(() => {
    let alive = true;
    fetch("/api/notices")
      .then((r) => r.json() as Promise<NoticeResult>)
      .catch((): NoticeResult => ({ ok: false, reason: "서버에 연결하지 못했습니다." }))
      .then((res) => {
        if (!alive) return;
        if (!res.ok) return setNotices({ status: "fail", reason: res.reason });
        // 가점제가 있는 일반 APT만, 공고일 최신 순
        setNotices({ status: "ok", list: res.notices.filter((n) => n.kind === "APT") });
      });
    return () => {
      alive = false;
    };
  }, []);

  const noticeList = notices.status === "ok" ? notices.list : [];
  const notice = noticeList.find((n) => n.houseManageNo === noticeNo) ?? null;
  const selectedType = notice ? (notice.types.find((t) => t.type === noticeType) ?? notice.types[0] ?? null) : null;

  // 지금 고른 단지를 비교 기준으로 정리
  const target: Target | null = useMemo(() => {
    if (mode === "notice") {
      if (!notice) return null;
      const area = selectedType ? areaOf(selectedType.type) : null;
      const band = area !== null ? bandOf(area) : noticeBand;
      return {
        sido: shortSido(notice.region),
        unit: notice.unit,
        band,
        exclude: notice.houseManageNo,
        label: `${notice.name}${selectedType ? ` ${shortType(selectedType.type)}` : ""}`,
      };
    }
    if (!manual.unit.trim()) return null;
    return { ...manual, unit: manual.unit.trim(), label: `${manual.sido} ${manual.unit.trim()} ${bandLabel(manual.band)}` };
  }, [mode, notice, selectedType, noticeBand, manual]);

  const autoReside: Reside | null = target && home.sido ? resideFor(home, target.sido, target.unit) : null;
  const reside = resideOverride ?? autoReside;

  // ── 3. 비슷한 사례 불러오기 (조건이 바뀔 때마다)
  const query =
    target && home.sido
      ? new URLSearchParams({
          sido: target.sido,
          unit: target.unit,
          band: target.band,
          homeSido: home.sido,
          homeUnit: home.unit,
          ...(resideOverride ? { reside: resideOverride } : {}),
          ...(target.exclude ? { exclude: target.exclude } : {}),
        }).toString()
      : null;
  const [similar, setSimilar] = useState<{ key: string; data: SimilarResponse } | null>(null);
  useEffect(() => {
    if (!query) return;
    let alive = true;
    fetch(`/api/similar?${query}`)
      .then((r) => r.json() as Promise<SimilarResponse>)
      .catch((): SimilarResponse => ({ ok: false, reason: "서버에 연결하지 못했습니다." }))
      .then((data) => {
        if (alive) setSimilar({ key: query, data });
      });
    return () => {
      alive = false;
    };
  }, [query]);
  const similarData = similar && similar.key === query ? similar.data : null;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:gap-14">
      {/* ───────── 입력 ───────── */}
      <div>
        <Section title="1. 내 가점과 거주지">
          <Row label="내 가점">
            <div className="flex items-center gap-2 text-sm">
              <input
                type="number"
                inputMode="decimal"
                step={0.5}
                min={0}
                placeholder={saved ? String(saved.total) : "점수"}
                value={manualScore}
                onChange={(e) => setManualScore(e.target.value)}
                className="w-20 rounded border border-line bg-white px-2 py-1.5 text-right tabular-nums focus:border-brand focus:outline-none"
              />
              <span>점</span>
            </div>
          </Row>
          <p className="py-2 text-xs text-muted">
            {saved ? (
              <>가점 계산에서 저장한 {saved.total}점을 씁니다. 다른 점수로 보고 싶으면 위에 넣어 보세요.</>
            ) : (
              <>
                저장된 점수가 없어요.{" "}
                <Link href="/score" className="text-brand underline">
                  가점 계산하기
                </Link>{" "}
                또는 위에 직접 넣어 보세요.
              </>
            )}
          </p>
          <Row label="거주지" hint="해당지역 구분용">
            <div className="flex gap-2">
              <select
                value={home.sido}
                onChange={(e) => saveMyHome({ ...home, sido: e.target.value })}
                className="rounded border border-line bg-white px-2 py-1.5 text-sm"
              >
                <option value="">시·도</option>
                {SIDO_LIST.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <input
                value={home.unit}
                onChange={(e) => saveMyHome({ ...home, unit: e.target.value })}
                placeholder={home.sido === "서울" ? "예: 강남구" : "예: 수원시"}
                className="w-28 rounded border border-line bg-white px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
              />
            </div>
          </Row>
        </Section>

        <Section title="2. 원하는 단지">
          <div className="border-b border-line py-3">
            <Segment
              value={mode}
              options={[
                ["notice", "분양공고에서 고르기"],
                ["manual", "지역·면적 직접"],
              ]}
              onChange={(v) => {
                setMode(v as Mode);
                setResideOverride(null);
              }}
            />
          </div>

          {mode === "notice" ? (
            <>
              {notices.status === "loading" && <p className="py-3 text-sm text-muted">청약홈에서 공고를 불러오는 중…</p>}
              {notices.status === "fail" && (
                <p className="py-3 text-sm text-muted">
                  공고를 불러오지 못했습니다 ({notices.reason}). &lsquo;지역·면적 직접&rsquo;으로 확인해 보세요.
                </p>
              )}
              {notices.status === "ok" && (
                <>
                  <Row label="단지">
                    <select
                      value={noticeNo}
                      onChange={(e) => {
                        setNoticeNo(e.target.value);
                        setNoticeType("");
                        setResideOverride(null);
                      }}
                      className="w-full max-w-xs rounded border border-line bg-white px-2 py-1.5 text-sm"
                    >
                      <option value="">공고를 고르세요 ({noticeList.length}건)</option>
                      {noticeList.map((n) => (
                        <option key={n.houseManageNo} value={n.houseManageNo}>
                          [{n.region} {n.unit}] {n.name}
                        </option>
                      ))}
                    </select>
                  </Row>
                  {notice && notice.types.length > 0 && (
                    <Row label="주택형">
                      <select
                        value={selectedType?.type ?? ""}
                        onChange={(e) => setNoticeType(e.target.value)}
                        className="rounded border border-line bg-white px-2 py-1.5 text-sm"
                      >
                        {notice.types.map((t) => (
                          <option key={t.type} value={t.type}>
                            {shortType(t.type)} (전용 {areaOf(t.type)?.toFixed(2)}㎡, 일반 {t.supply ?? "–"}세대)
                          </option>
                        ))}
                      </select>
                    </Row>
                  )}
                  {notice && notice.types.length === 0 && (
                    <Row label="면적대" hint="주택형 정보를 못 불러와 직접 선택">
                      <BandSelect value={noticeBand} onChange={setNoticeBand} />
                    </Row>
                  )}
                  {notice && (
                    <p className="py-2 text-xs text-muted">
                      {notice.address} · 접수 {dot(notice.receiptStart)} ~ {dot(notice.receiptEnd)}
                      {notice.url && (
                        <>
                          {" · "}
                          <a href={notice.url} target="_blank" rel="noopener noreferrer" className="text-brand underline">
                            청약홈 공고
                          </a>
                        </>
                      )}
                    </p>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <Row label="지역">
                <div className="flex gap-2">
                  <select
                    value={manual.sido}
                    onChange={(e) => setManual({ ...manual, sido: e.target.value })}
                    className="rounded border border-line bg-white px-2 py-1.5 text-sm"
                  >
                    {SIDO_LIST.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <input
                    value={manual.unit}
                    onChange={(e) => setManual({ ...manual, unit: e.target.value })}
                    placeholder={manual.sido === "서울" ? "예: 송파구" : "예: 화성시"}
                    className="w-28 rounded border border-line bg-white px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                  />
                </div>
              </Row>
              <Row label="면적대">
                <BandSelect value={manual.band} onChange={(b) => setManual({ ...manual, band: b })} />
              </Row>
            </>
          )}

          {target && reside && (
            <Row label="이 단지에서 나는" hint={resideOverride ? "직접 선택함" : "거주지로 자동 판단"}>
              <select
                value={reside}
                onChange={(e) => setResideOverride(e.target.value as Reside)}
                className="rounded border border-line bg-white px-2 py-1.5 text-sm"
              >
                <option>해당지역</option>
                {target.sido === "경기" && <option>기타경기</option>}
                <option>기타지역</option>
              </select>
            </Row>
          )}
          {target && reside && (
            <p className="py-2 text-xs leading-relaxed text-muted">
              해당지역 범위와 우선공급 비율은 공고마다 다릅니다(예: 대규모 택지는 해당 시·군, 경기, 그 밖 수도권으로 나눔). 정확한 구분은 입주자모집공고에서 확인하세요.
            </p>
          )}
        </Section>
      </div>

      {/* ───────── 결과 ───────── */}
      <div>
        <Section title="3. 가능성 판정">
          <Result
            myScore={myScore}
            hasHome={!!home.sido}
            target={target}
            reside={reside}
            data={similarData}
            waiting={!!query && !similarData}
          />
        </Section>
      </div>
    </div>
  );
}

// ───────────────────────── 결과 ─────────────────────────

function Result({
  myScore,
  hasHome,
  target,
  reside,
  data,
  waiting,
}: {
  myScore: number | null;
  hasHome: boolean;
  target: Target | null;
  reside: Reside | null;
  data: SimilarResponse | null;
  waiting: boolean;
}) {
  if (myScore === null) return <Empty>먼저 내 가점을 계산하거나 직접 넣어 주세요.</Empty>;
  if (!hasHome) return <Empty>거주지 시·도를 골라 주세요. 해당지역·기타지역에 따라 비교할 당첨 가점이 달라집니다.</Empty>;
  if (!target) return <Empty>원하는 단지(또는 지역과 면적대)를 골라 주세요.</Empty>;
  if (waiting) return <Empty>청약홈 과거 당첨 가점에서 비슷한 사례를 찾는 중… (처음엔 몇 초 걸릴 수 있어요)</Empty>;
  if (!data) return null;
  if (!data.ok) return <Empty>과거 당첨 가점을 불러오지 못했습니다. ({data.reason})</Empty>;

  const { result } = data;
  const areaText = result.level === "sido" ? `${target.sido} 전체` : `${target.sido} ${target.unit}`;
  const basis = `${areaText} · ${bandLabel(target.band)} · 최근 ${SIMILAR_RULES.yearsBack}년 · ${reside}`;
  const judgement = result.stats ? judge(myScore, result.stats) : null;
  const passed = result.cases.filter((c) => c.min !== null && myScore >= c.min).length;

  return (
    <div>
      <table className="w-full text-sm tabular-nums">
        <tbody>
          <tr className="border-b border-line">
            <td className="py-2.5 text-muted">원하는 단지</td>
            <td className="py-2.5 text-right font-medium">{target.label}</td>
          </tr>
          <tr className="border-b border-line">
            <td className="py-2.5 text-muted">비교 기준</td>
            <td className="py-2.5 text-right">{basis}</td>
          </tr>
          <tr className="border-b border-line">
            <td className="py-2.5 font-semibold">판정</td>
            <td className="py-2.5 text-right">
              {judgement ? (
                <>
                  <Badge verdict={judgement.verdict} />
                  <div className="mt-1 text-xs text-muted">{judgement.reason}</div>
                </>
              ) : (
                <span className="text-muted">사례 부족으로 판정하지 않음</span>
              )}
            </td>
          </tr>
          {result.stats && (
            <>
              <tr className="border-b border-line">
                <td className="py-2.5">내 가점</td>
                <td className="py-2.5 text-right">
                  <b className="text-brand">{fmt(myScore)}점</b>
                </td>
              </tr>
              <tr className="border-b border-line">
                <td className="py-2.5">비슷한 사례 평균 당첨 가점 (중앙값)</td>
                <td className="py-2.5 text-right">{fmt(result.stats.avg)}점</td>
              </tr>
              <tr className="border-b border-line">
                <td className="py-2.5">비슷한 사례 최저 당첨 가점 (중앙값)</td>
                <td className="py-2.5 text-right">{fmt(result.stats.min)}점</td>
              </tr>
              <tr className="border-b border-line">
                <td className="py-2.5">내 점수가 최저 당첨 가점 이상이던 사례</td>
                <td className="py-2.5 text-right">
                  {result.cases.length}개 중 <b className="text-accent-dark">{passed}개</b>
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      {result.level === "sido" && (
        <p className="mt-2 text-xs text-muted">
          {target.unit}에는 비슷한 사례가 {SIMILAR_RULES.minCases}개보다 적어 {target.sido} 전체로 넓혀 비교했습니다.
        </p>
      )}
      {!result.stats && (
        <p className="mt-2 text-xs text-muted">
          {target.sido} 전체에서도 같은 면적대의 사례가 {SIMILAR_RULES.minCases}개보다 적습니다. 면적대를 바꾸거나 청약홈 공고를 직접 확인해 보세요.
        </p>
      )}

      {result.cases.length > 0 && (
        <>
          <h3 className="mt-8 border-b-2 border-brand pb-2 text-sm font-semibold text-brand">
            {result.stats ? "판정에 쓴" : "찾은"} 과거 사례 {result.cases.length}개 (단지 {result.complexCount}곳)
          </h3>
          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="py-2 text-left font-normal">단지 · 주택형</th>
                <th className="py-2 text-right font-normal">최저</th>
                <th className="py-2 text-right font-normal">평균</th>
                <th className="py-2 text-right font-normal">최고</th>
                <th className="py-2 text-right font-normal">내 점수</th>
              </tr>
            </thead>
            <tbody>
              {result.cases.map((c) => {
                const ok = c.min !== null && myScore >= c.min;
                return (
                  <tr key={`${c.no}-${c.houseTy}`} className="border-b border-line align-top">
                    <td className="py-2 pr-2">
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {c.name}
                        </a>
                      ) : (
                        c.name
                      )}{" "}
                      <span className="text-muted">{shortType(c.houseTy)}</span>
                      <div className="text-xs text-muted">
                        {c.unit} · 공고 {dot(c.noticeDate)} · {c.reside}
                      </div>
                    </td>
                    <td className="py-2 text-right">{val(c.min)}</td>
                    <td className="py-2 text-right">{val(c.avg)}</td>
                    <td className="py-2 text-right">{val(c.max)}</td>
                    <td className={`py-2 text-right text-xs font-semibold ${ok ? "text-brand" : "text-muted"}`}>
                      {ok ? "최저 이상" : "부족"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <ul className="mt-4 space-y-0.5 text-xs leading-relaxed text-muted">
        <li>· 출처: 한국부동산원 청약홈 당첨가점·분양정보 API ({dot(data.fetchedAt.slice(0, 10))} 기준).</li>
        <li>· 판정 기준값: 사례별 평균 당첨 가점의 중앙값과 최저 당첨 가점의 중앙값. 판정 방식(안정·도전·어려움)은 단지 비교와 같습니다.</li>
        <li>· 과거 결과는 다음 분양을 보장하지 않습니다. 분양가, 입지, 공급 물량, 규제가 달라지면 커트라인도 달라집니다.</li>
        <li>· 가점이 부족해도 추첨제 물량이 있는 주택형은 당첨 기회가 있습니다. 분양공고에서 공급 구성을 확인하세요.</li>
      </ul>
    </div>
  );
}

// ───────────────────────── 작은 부품 ─────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="border-b-2 border-brand pb-2 text-sm font-semibold text-brand">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-line py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="shrink-0 text-sm">
        {label}
        {hint && <span className="ml-2 text-xs text-muted">{hint}</span>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Segment({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-line text-sm">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`border-l border-line px-3 py-1.5 first:border-l-0 ${value === v ? "bg-brand text-white" : "bg-white hover:bg-brand/5"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function BandSelect({ value, onChange }: { value: BandId; onChange: (b: BandId) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as BandId)}
      className="rounded border border-line bg-white px-2 py-1.5 text-sm"
    >
      {SIMILAR_RULES.bands.map((b) => (
        <option key={b.id} value={b.id}>
          {b.label}
        </option>
      ))}
    </select>
  );
}

const BADGE: Record<Verdict, string> = {
  안정: "bg-brand text-white",
  도전: "bg-accent text-ink",
  어려움: "bg-line text-muted",
};

function Badge({ verdict }: { verdict: Verdict }) {
  return <span className={`inline-block rounded-sm px-2 py-0.5 text-xs font-semibold ${BADGE[verdict]}`}>{verdict}</span>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-sm leading-relaxed text-muted">{children}</p>;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const val = (n: number | null) => (n === null ? "–" : fmt(n));
const dot = (d: string | null) => (d ? d.replaceAll("-", ".") : "–");
