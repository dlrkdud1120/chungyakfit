"use client";

/**
 * 당첨 가능성 확인 화면 (앱의 핵심 기능)
 *  1) 내 가점과 거주지
 *  2) 원하는 단지 고르기 — 다가오는 분양공고에서 / 지역·면적 직접
 *  3) 비슷한 과거 사례(/api/similar)로 lib/judge.ts 판정 + 근거 사례 표
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Notice, NoticeResult } from "@/lib/applyhome";
import { FUTURE_SECTION_ID } from "@/lib/anchors";
import { imageFor, type ComplexImages } from "@/lib/complexImage";
import CalendarButton from "@/components/CalendarButton";
import ComplexThumb from "@/components/ComplexThumb";
import { isShort, NO_CMPET, pickCmpet, rankText, rateShort, rateText, type CmpetRow } from "@/lib/competition";
import { judge, VERDICT_ORDER, type Verdict } from "@/lib/judge";
import { parseMyHome, readMyHomeRaw, saveMyHome, subscribeMyHome } from "@/lib/myHome";
import { parseMyScore, readMyScoreRaw, subscribeMyScore, type SavedFuture } from "@/lib/myScore";
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
type Target = { sido: string; unit: string; band: BandId; exclude?: string; houseTy?: string; label: string };
type SimilarResponse =
  | { ok: true; result: SimilarResult; targetCmpet?: CmpetRow[] | null; fetchedAt: string; totalRows: number }
  | { ok: false; reason: string };

/** images: complexes.csv에 등록한 조감도 (app/check/page.tsx가 넘겨줌) */
export default function CheckPossibility({ images }: { images: ComplexImages }) {
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
        houseTy: selectedType?.type,
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
          ...(target.exclude && target.houseTy ? { houseTy: target.houseTy } : {}),
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

  // 모바일: 공고에서 단지·주택형을 고르고 결과가 오면 판정 요약이 화면 위쪽에 오도록 한 번 스크롤
  const summaryRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "notice" || !query || !similarData || scrolledFor.current === query) return;
    scrolledFor.current = query;
    if (!window.matchMedia("(max-width: 1023px)").matches) return; // 넓은 화면은 판정이 옆에 보임
    requestAnimationFrame(() => summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [mode, query, similarData]);

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
                  {notice && <CalendarButton notice={notice} className="mb-2" />}
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
            future={manualScore === "" ? (saved?.future ?? null) : null}
            hasHome={!!home.sido}
            target={target}
            reside={reside}
            data={similarData}
            waiting={!!query && !similarData}
            notice={mode === "notice" ? notice : null}
            summaryRef={summaryRef}
            images={images}
          />
        </Section>
      </div>
    </div>
  );
}

// ───────────────────────── 결과 ─────────────────────────

type Stats = { min: number; avg: number; max: number };

/** 판정별 색: 왼쪽 세로선과 판정 글자 */
const TONE: Record<Verdict, { line: string; text: string }> = {
  안정: { line: "bg-ok", text: "text-ok" },
  도전: { line: "bg-accent", text: "text-accent-dark" },
  어려움: { line: "bg-bad", text: "text-bad" },
};

/** 판정을 한 문장으로 풀기 (판정 자체는 lib/judge.ts가 정함) */
function verdictSentence(verdict: Verdict, my: number, s: Stats): string {
  if (verdict === "어려움") return `비슷한 사례의 최저 당첨 가점보다 ${fmt(round1(s.min - my))}점 낮아요`;
  if (verdict === "도전") return `최저 당첨 가점은 넘지만 평균보다 ${fmt(round1(s.avg - my))}점 낮아요`;
  const diff = round1(my - s.avg);
  return diff === 0 ? "비슷한 사례 평균과 같아요" : `비슷한 사례 평균보다 ${fmt(diff)}점 높아요`;
}

function Result({
  myScore,
  future,
  hasHome,
  target,
  reside,
  data,
  waiting,
  notice,
  summaryRef,
  images,
}: {
  myScore: number | null;
  future: SavedFuture[] | null;
  hasHome: boolean;
  target: Target | null;
  reside: Reside | null;
  data: SimilarResponse | null;
  waiting: boolean;
  notice: Notice | null;
  summaryRef: React.RefObject<HTMLDivElement | null>;
  images: ComplexImages;
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
  const stats = result.stats;
  const judgement = stats ? judge(myScore, stats) : null;
  const passed = result.cases.filter((c) => c.min !== null && myScore >= c.min).length;
  // 원하는 단지 주택형의 청약 경쟁률 (분양공고에서 고른 경우만. 판정에는 쓰지 않는 참고 정보)
  const myCmpet = target.houseTy ? pickCmpet(data.targetCmpet, reside) : null;

  // 최저 당첨 가점과의 차이가 작은 사례부터
  const cases = [...result.cases].sort(
    (a, b) => Math.abs(myScore - (a.min ?? 0)) - Math.abs(myScore - (b.min ?? 0)) || b.noticeDate.localeCompare(a.noticeDate),
  );

  return (
    <div>
      <table className="w-full text-sm">
        <tbody>
          <tr className="border-b border-line">
            <td className="py-2.5 text-muted">원하는 단지</td>
            <td className="py-2.5 text-right font-medium">{target.label}</td>
          </tr>
          {/* 원하는 단지의 조감도와 위치 지도 (누르면 카카오맵) — 분양공고에서 고른 경우만.
              조감도가 있으면 조감도와 지도를 나란히, 없으면 지도만 */}
          {notice && (
            <tr className="border-b border-line">
              <td colSpan={2} className="py-3">
                {imageFor(images, notice.name) ? (
                  <div className="grid max-w-[492px] grid-cols-2 gap-3">
                    <ComplexThumb
                      size="fill"
                      name={notice.name}
                      address={notice.address}
                      region={`${notice.region} ${notice.unit}`}
                      image={imageFor(images, notice.name)}
                    />
                    <ComplexThumb
                      size="fill"
                      name={notice.name}
                      address={notice.address}
                      region={`${notice.region} ${notice.unit}`}
                      image={null}
                    />
                  </div>
                ) : (
                  <ComplexThumb
                    size="lg"
                    name={notice.name}
                    address={notice.address}
                    region={`${notice.region} ${notice.unit}`}
                    image={null}
                  />
                )}
              </td>
            </tr>
          )}
          <tr className="border-b border-line">
            <td className="py-2.5 text-muted">비교 기준</td>
            <td className="py-2.5 text-right">{basis}</td>
          </tr>
        </tbody>
      </table>
      {result.level === "sido" && (
        <p className="pt-2 text-xs text-muted">
          {target.unit}에는 비슷한 사례가 {SIMILAR_RULES.minCases}개보다 적어 {target.sido} 전체로 넓혀 비교했습니다.
        </p>
      )}

      {/* 판정 요약 + 점수 위치 막대 */}
      <div ref={summaryRef} className="scroll-mt-4">
        {judgement && stats ? (
          <>
            <div className="mt-4 flex gap-3">
              <span className={`w-1 shrink-0 ${TONE[judgement.verdict].line}`} aria-hidden />
              <div className="py-0.5">
                <p className={`text-lg leading-tight font-bold ${TONE[judgement.verdict].text}`}>{judgement.verdict}</p>
                <p className="mt-1 text-sm">{verdictSentence(judgement.verdict, myScore, stats)}</p>
              </div>
            </div>
            <PositionBar my={myScore} stats={stats} />
          </>
        ) : (
          <p className="mt-4 border-l-4 border-line py-1 pl-3 text-sm text-muted">
            {target.sido} 전체에서도 같은 면적대의 사례가 {SIMILAR_RULES.minCases}개보다 적어 판정하지 않았어요. 면적대를 바꾸거나
            청약홈 공고를 직접 확인해 보세요.
          </p>
        )}
      </div>

      {/* 판정 근거 숫자 */}
      {stats && (
        <>
          <h3 className="mt-6 border-b-2 border-brand pb-2 text-sm font-semibold text-brand">판정 근거</h3>
          <table className="w-full text-sm tabular-nums">
            <tbody>
              <NumRow label="내 가점" value={`${fmt(myScore)}점`} strong />
              <NumRow
                label="평균 당첨 가점"
                note={`사례 ${result.cases.length}개의 평균 당첨 가점을 줄 세운 중간값`}
                value={`${fmt(stats.avg)}점`}
              />
              <NumRow
                label="최저 당첨 가점"
                note={`사례 ${result.cases.length}개의 최저 당첨 가점을 줄 세운 중간값`}
                value={`${fmt(stats.min)}점`}
              />
              <NumRow
                label={`비슷한 사례 ${result.cases.length}개 중 내 점수로 당첨선을 넘은 곳`}
                note="당첨선 = 그 사례의 최저 당첨 가점"
                value={`${passed}개`}
              />
              {target.houseTy && (
                <NumRow
                  label="이 주택형 경쟁률"
                  note={
                    myCmpet
                      ? `${isShort(myCmpet) ? "미달이면 순위 안에만 들면 당첨될 수 있어요 · " : ""}접수 ${myCmpet.req ?? "–"}건 / 공급 ${myCmpet.supply ?? "–"}세대`
                      : "아직 접수 전이거나 청약홈에 경쟁률이 없어요"
                  }
                  value={
                    myCmpet ? (
                      <>
                        <span className={isShort(myCmpet) ? "font-semibold text-accent-dark" : ""}>{rateText(myCmpet)}</span>
                        <span className="block text-xs text-muted sm:ml-1 sm:inline">({rankText(myCmpet)})</span>
                      </>
                    ) : (
                      <span className="text-muted">{NO_CMPET}</span>
                    )
                  }
                />
              )}
            </tbody>
          </table>
        </>
      )}

      {/* 다음에 할 수 있는 것 */}
      {judgement && stats && (
        <NextSteps verdict={judgement.verdict} my={myScore} stats={stats} future={future} target={target} notice={notice} cases={result.cases} />
      )}

      {/* 과거 사례 표 */}
      {cases.length > 0 && (
        <>
          <h3 className="mt-8 border-b-2 border-brand pb-2 text-sm font-semibold text-brand">
            {stats ? "판정에 쓴" : "찾은"} 과거 사례 {cases.length}개 (단지 {result.complexCount}곳)
          </h3>
          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="py-2 text-left font-normal">단지 · 주택형</th>
                <th className="py-2 pl-2 text-right font-normal">최저</th>
                <th className="py-2 pl-2 text-right font-normal">평균</th>
                <th className="hidden py-2 text-right font-normal sm:table-cell">최고</th>
                <th className="py-2 pl-2 text-right font-normal">경쟁률</th>
                <th className="py-2 pl-2 text-right font-normal">최저와 차이</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const diff = c.min === null ? null : round1(myScore - c.min);
                const cm = pickCmpet(c.cmpet, c.reside);
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
                    <td className="py-2 pl-2 text-right">{val(c.min)}</td>
                    <td className="py-2 pl-2 text-right">{val(c.avg)}</td>
                    <td className="hidden py-2 text-right sm:table-cell">{val(c.max)}</td>
                    <td
                      className={`py-2 pl-2 text-right whitespace-nowrap ${!cm ? "text-muted" : isShort(cm) ? "font-semibold text-accent-dark" : ""}`}
                      title={cm ? `${rateText(cm)} (${rankText(cm)})` : NO_CMPET}
                    >
                      {rateShort(cm)}
                    </td>
                    <td className={`py-2 text-right font-semibold ${diff === null ? "text-muted" : diff >= 0 ? "text-ok" : "text-bad"}`}>
                      {diff === null ? "–" : diff > 0 ? `+${fmt(diff)}` : fmt(diff)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <ul className="mt-4 space-y-0.5 text-xs leading-relaxed text-muted">
        <li>· 경쟁률은 1순위 내 거주 구분 기준(없으면 1순위 해당지역)이고, 판정에는 쓰지 않는 참고 정보예요. – 는 경쟁률 정보 없음.</li>
        <li>· 출처: 한국부동산원 청약홈 당첨가점·경쟁률·분양정보 API ({dot(data.fetchedAt.slice(0, 10))} 기준).</li>
        <li>· 판정 방식(안정·도전·어려움)은 단지 비교와 같습니다. 평균·최저는 위 판정 근거의 중간값을 씁니다.</li>
        <li>· 과거 결과는 다음 분양을 보장하지 않습니다. 분양가, 입지, 공급 물량, 규제가 달라지면 커트라인도 달라집니다.</li>
      </ul>
    </div>
  );
}

/** 0점부터 사례 최고 당첨 가점보다 조금 높은 곳까지, 최저 미만(회색)·최저~평균(주황)·평균 이상(초록) */
function PositionBar({ my, stats }: { my: number; stats: Stats }) {
  const hi = Math.ceil((Math.max(stats.max, my) + 3) / 5) * 5;
  const pos = (n: number) => Math.min(Math.max(n / hi, 0), 1) * 100;
  const pMin = pos(stats.min);
  const pAvg = pos(stats.avg);
  const pMy = pos(my);
  // 최저·평균 눈금이 가까우면 글자를 두 줄로 나눠 겹치지 않게
  const twoRows = pAvg - pMin < 22;

  return (
    <div className="mt-4 mb-2" role="img" aria-label={`최저 ${fmt(stats.min)}점, 평균 ${fmt(stats.avg)}점, 내 점수 ${fmt(my)}점`}>
      <div className={`relative text-[11px] text-muted tabular-nums ${twoRows ? "h-8" : "h-4"}`}>
        <TickLabel pos={pMin} side="end" top={0}>
          최저 {fmt(stats.min)}
        </TickLabel>
        <TickLabel pos={pAvg} side="start" top={twoRows ? 16 : 0}>
          평균 {fmt(stats.avg)}
        </TickLabel>
      </div>
      <div className="relative h-1.5">
        <span className="absolute bottom-0 h-1.5 w-px bg-muted" style={{ left: `${pMin}%` }} />
        <span className="absolute bottom-0 h-1.5 w-px bg-muted" style={{ left: `${pAvg}%` }} />
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-sm bg-line">
        <div className="absolute inset-y-0 bg-accent" style={{ left: `${pMin}%`, width: `${pAvg - pMin}%` }} />
        <div className="absolute inset-y-0 right-0 bg-ok" style={{ left: `${pAvg}%` }} />
      </div>
      <div className="relative h-8 text-[11px] tabular-nums">
        <span
          className="absolute top-1 h-0 w-0 -translate-x-1/2 border-x-[5px] border-b-[7px] border-x-transparent border-b-ink"
          style={{ left: `${pMy}%` }}
        />
        <span
          className={`absolute top-3.5 font-semibold whitespace-nowrap ${pMy >= 12 && pMy <= 88 ? "-translate-x-1/2" : ""}`}
          style={pMy < 12 ? { left: 0 } : pMy > 88 ? { right: 0 } : { left: `${pMy}%` }}
        >
          내 점수 {fmt(my)}
        </span>
      </div>
    </div>
  );
}

/** side="end": 글자가 눈금에서 끝남(왼쪽에 놓임), side="start": 눈금에서 시작. 막대 끝에 닿으면 안쪽으로 붙임 */
function TickLabel({ pos, side, top, children }: { pos: number; side: "start" | "end"; top: number; children: React.ReactNode }) {
  let style: React.CSSProperties;
  if (side === "end") style = pos < 14 ? { left: 0 } : { right: `${100 - pos}%` };
  else style = pos > 80 ? { right: 0 } : { left: `${pos}%` };
  return (
    <span className="absolute px-0.5 whitespace-nowrap" style={{ ...style, top }}>
      {children}
    </span>
  );
}

function NumRow({
  label,
  note,
  value,
  strong = false,
}: {
  label: string;
  note?: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <tr className="border-b border-line align-top">
      <td className="py-2.5 pr-3">
        {label}
        {note && <div className="text-xs text-muted">{note}</div>}
      </td>
      <td className="py-2.5 text-right whitespace-nowrap">{strong ? <b className="text-brand">{value}</b> : value}</td>
    </tr>
  );
}

// ───────────────────────── 다음에 할 수 있는 것 ─────────────────────────

function NextSteps({
  verdict,
  my,
  stats,
  future,
  target,
  notice,
  cases,
}: {
  verdict: Verdict;
  my: number;
  stats: Stats;
  future: SavedFuture[] | null;
  target: Target;
  notice: Notice | null;
  cases: SimilarResult["cases"];
}) {
  const items: React.ReactNode[] = [];

  if (verdict === "어려움") {
    // 1) 같은 단지의 추첨제 물량
    const bigTypes = notice?.types.filter((t) => (areaOf(t.type) ?? 0) > 85).map((t) => shortType(t.type)) ?? [];
    items.push(
      <>
        가점만으로는 어려우니 <b>추첨제 물량</b>을 노려볼 수 있어요.{" "}
        {bigTypes.length > 0
          ? `이 단지의 전용 85㎡ 초과 주택형(${bigTypes.join(", ")})은 추첨제 비율이 높은 편이에요. `
          : "주택형별 추첨제 세대수는 청약홈 데이터에 없어 공고문에서 확인해야 해요. "}
        {notice?.url ? <ExtLink href={notice.url}>청약홈 공고문 보기</ExtLink> : <InLink href="/notice">분양 공고 보기</InLink>}
      </>,
    );
    // 2) 미래 점수로 언제 도전이 되는지
    if (future && future.length > 0) {
      const better = future
        .map((f) => ({ f, j: judge(f.total, stats) }))
        .find((x) => x.j && VERDICT_ORDER[x.j.verdict] < VERDICT_ORDER["어려움"]);
      const last = future[future.length - 1];
      items.push(
        <>
          {better ? (
            <>
              지금 입력 그대로면 <b>{better.f.years}년 뒤 {fmt(better.f.total)}점</b>으로 {better.j!.verdict} 단계가 돼요.{" "}
            </>
          ) : (
            <>
              {last.years}년 뒤 {fmt(last.total)}점이어도 아직 어려움이에요. 최저 당첨 가점까지 {fmt(round1(stats.min - last.total))}점이 더 필요해요.{" "}
            </>
          )}
          <InLink href={`/compare#${FUTURE_SECTION_ID}`}>미래 점수 예측 보기</InLink>
        </>,
      );
    } else {
      items.push(
        <>
          가점 계산에서 점수를 저장하면 몇 년 뒤 도전 단계가 되는지 알려드려요. <InLink href="/score">가점 계산하기</InLink>
        </>,
      );
    }
  }

  if (verdict === "도전") {
    // 같은 비교 기준의 과거 사례 중 내 점수가 평균 이상(=안정)인 곳
    const safe = cases.filter((c) => c.avg !== null && my >= c.avg).slice(0, 3);
    const compareHref = `/compare?${new URLSearchParams({ sido: target.sido, verdict: "안정" })}`;
    items.push(
      safe.length > 0 ? (
        <>
          비슷한 지역에서 내 점수로 <b>안정</b>이던 곳:{" "}
          {safe.map((c) => `${c.name} ${shortType(c.houseTy)}(평균 ${fmt(c.avg!)})`).join(", ")}.{" "}
          <InLink href={compareHref}>{target.sido} 안정 단지 모두 보기</InLink>
        </>
      ) : (
        <>
          같은 조건의 과거 사례 중에는 안정인 곳이 없어요. <InLink href={compareHref}>{target.sido}에서 안정인 단지 찾아보기</InLink>
        </>
      ),
    );
  }

  if (verdict === "안정") {
    items.push(
      notice?.url ? (
        <>
          비슷한 사례 기준으로는 해볼 만해요. 접수 일정과 자격 조건을 확인하세요. <ExtLink href={notice.url}>청약홈 공고 보기</ExtLink>
        </>
      ) : (
        <>
          비슷한 사례 기준으로는 해볼 만해요. 이 지역의 다가오는 공고를 확인하세요. <InLink href="/notice">분양 공고 보기</InLink>
        </>
      ),
    );
  }

  return (
    <>
      <h3 className="mt-6 border-b-2 border-brand pb-2 text-sm font-semibold text-brand">다음에 할 수 있는 것</h3>
      <ul>
        {items.map((it, i) => (
          <li key={i} className="border-b border-line py-2.5 text-sm leading-relaxed">
            {it}
          </li>
        ))}
      </ul>
    </>
  );
}

function InLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="whitespace-nowrap text-brand underline underline-offset-2">
      {children} →
    </Link>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-brand underline underline-offset-2">
      {children} ↗
    </a>
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

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-sm leading-relaxed text-muted">{children}</p>;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const val = (n: number | null) => (n === null ? "–" : fmt(n));
const dot = (d: string | null) => (d ? d.replaceAll("-", ".") : "–");
const round1 = (n: number) => Math.round(n * 10) / 10;
