"use client";

/**
 * 분양 공고 — 목록 → 상세 두 화면
 *  목록(/notice): 일반 분양 + 무순위·잔여세대 공고(지도로 찾기와 같은 범위, 최근 60일). 맨 위 검색창(단지명·지역·건설사, 자동완성·최근 검색어, ?q=), 행마다 썸네일·단지명·지역·내 판정·다음 일정.
 *                 "필터"를 누르면 시·도, 일정(접수 중·접수 예정·발표 대기·마감 제외), 공급, 내 판정, 정렬. 검색 규칙은 lib/notice-search.ts
 *  상세(/notice?no=주택관리번호): 공급세대, 일정 전체, 규제, 입지 점수, 캘린더 추가, 관심 공고 별
 * /api/notices(서버)를 불러 청약홈 공고를 보여주고, 실패하면 data/complexes.csv의 단지 목록을 대신 보여줍니다.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Notice, NoticeResult } from "@/lib/applyhome";
import type { Complex } from "@/lib/complexes";
import CalendarButton from "@/components/CalendarButton";
import FavoriteStar from "@/components/FavoriteStar";
import { favoriteFromNotice } from "@/lib/meTypes";
import ComplexThumb from "@/components/ComplexThumb";
import NoticeSearch, { Highlight } from "@/components/NoticeSearch";
import { buildersOf, makeQuery, matchNotice, type Match, type MatchField } from "@/lib/notice-search";
import type { LocationBrief } from "@/components/CompareList";
import { useMy } from "@/components/Providers";
import { useNoticeVerdict, useNoticeVerdicts, VERDICT_COLOR } from "@/components/useNoticeVerdict";
import type { Verdict } from "@/lib/judge";
import { noticeCategory, noticeStatus, type Category, type Status } from "@/lib/map-items";
import { shortSido } from "@/lib/similar";
import { scheduleEvents } from "@/lib/calendar";
import { locationKey } from "@/lib/location";
import { ddayText, md, nextEvent, todayKST } from "@/lib/mySchedule";

type State = { status: "loading" } | { status: "done"; result: NoticeResult };

export default function NoticeList({
  fallback,
  locations,
}: {
  fallback: Complex[];
  locations: Record<string, LocationBrief>; // 키: locationKey(단지명, 지역)
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const params = useSearchParams();
  const router = useRouter();
  const detailNo = params.get("no"); // 있으면 상세 화면
  const q = params.get("q") ?? ""; // 검색어 (주소창 ?q=, 새로고침해도 유지)
  // 목록 필터 (접어 둠)
  const [filterOpen, setFilterOpen] = useState(false);
  const [region, setRegion] = useState("전체");
  // 자동완성에서 고른 지역 태그와 건설사
  const [regionTags, setRegionTags] = useState<{ region: string; unit: string }[]>([]);
  const [builder, setBuilder] = useState<string | null>(null);
  // 일정·공급·판정 필터와 정렬 (지도로 찾기와 같은 규칙)
  const [statusF, setStatusF] = useState<OpenStatus[]>([]);
  const [hideClosed, setHideClosed] = useState(false);
  const [categoryF, setCategoryF] = useState<Category[]>([]);
  const [verdictF, setVerdictF] = useState<Verdict[]>([]);
  const [sort, setSort] = useState<SortKey>("notice");
  const notices = state.status === "done" && state.result.ok ? state.result.notices : NO_NOTICES;
  const verdicts = useNoticeVerdicts(notices, verdictF.length > 0 || sort === "verdict");

  /** 검색어를 주소창에 담기 (기록은 쌓지 않음) */
  const setQ = (text: string) => window.history.replaceState(null, "", text ? `/notice?${new URLSearchParams({ q: text })}` : "/notice");
  const resetAll = () => {
    setQ("");
    setRegion("전체");
    setRegionTags([]);
    setBuilder(null);
    setStatusF([]);
    setHideClosed(false);
    setCategoryF([]);
    setVerdictF([]);
    setSort("notice");
  };

  useEffect(() => {
    let alive = true;
    // 무순위·잔여세대 공고도 함께 (지도로 찾기와 같은 범위)
    fetch("/api/notices?include=remndr")
      .then((r) => r.json() as Promise<NoticeResult>)
      .catch((): NoticeResult => ({ ok: false, reason: "서버(/api/notices)에 연결하지 못했습니다." }))
      .then((result) => {
        if (alive) setState({ status: "done", result });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (state.status === "loading") {
    return <p className="py-10 text-sm text-muted">청약홈에서 공고를 불러오는 중…</p>;
  }

  const { result } = state;
  if (!result.ok) return <Fallback reason={result.reason} complexes={fallback} />;

  // ───────── 상세 ─────────
  if (detailNo) {
    const n = result.notices.find((x) => x.houseManageNo === detailNo);
    return (
      <div>
        <Link
          href={q ? `/notice?${new URLSearchParams({ q })}` : "/notice"}
          className="inline-block rounded border border-line bg-white px-3 py-1.5 text-xs text-brand hover:border-brand"
        >
          ← 목록
        </Link>
        {n ? (
          <NoticeDetail n={n} location={locations[locationKey(n.name, `${n.region} ${n.unit}`)]} />
        ) : (
          <p className="py-10 text-sm text-muted">이 공고를 찾지 못했어요. 접수 기간이 지나 목록에서 빠졌을 수 있어요.</p>
        )}
        <Notes />
      </div>
    );
  }

  // ───────── 목록 ─────────
  const regions = [...new Set(result.notices.map((n) => n.region))];
  const query = makeQuery(q);
  const rows = result.notices
    .filter((n) => region === "전체" || n.region === region)
    .filter((n) => !regionTags.length || regionTags.some((t) => n.region === t.region && (!t.unit || n.unit === t.unit)))
    .filter((n) => !builder || buildersOf(n).includes(builder))
    .map((n) => ({ n, match: query ? matchNotice(n, query) : null }))
    .filter((r) => !query || r.match);
  // 일정·공급·판정 필터 (판정은 불러온 뒤에만 거름)
  const today = todayKST();
  const verdictMap = verdicts.status === "done" ? verdicts.map : null;
  const shown = rows
    .filter(({ n }) => {
      const s = noticeStatus(n, today);
      if (hideClosed && s === "마감") return false;
      if (statusF.length && !statusF.includes(s as OpenStatus)) return false;
      if (categoryF.length && !categoryF.includes(noticeCategory(n))) return false;
      if (verdictF.length && verdictMap) {
        const v = verdictMap[n.houseManageNo] ?? null;
        if (!v || !verdictF.includes(v)) return false;
      }
      return true;
    })
    .sort(sortBy(sort, today, verdictMap));
  const filterN = statusF.length + (hideClosed ? 1 : 0) + categoryF.length + verdictF.length + (region !== "전체" ? 1 : 0) + (sort !== "notice" ? 1 : 0);
  const filtered = region !== "전체" || !!query || regionTags.length > 0 || builder !== null || filterN > 0;
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const rowHref = (no: string) => `/notice?${new URLSearchParams(q ? { no, q } : { no })}`;

  return (
    <div>
      {/* 검색창 (단지명·지역·건설사, 자동완성) */}
      <NoticeSearch
        key={q}
        notices={result.notices}
        initial={q}
        onSubmit={setQ}
        onPickComplex={(no) => router.push(rowHref(no))}
        onPickRegion={(r, unit) => setRegionTags((tags) => (tags.some((t) => t.region === r && t.unit === unit) ? tags : [...tags, { region: r, unit }]))}
        onPickBuilder={setBuilder}
      />
      {(regionTags.length > 0 || builder) && (
        <div className="mb-3 flex flex-wrap gap-1.5" aria-label="적용한 검색 조건">
          {regionTags.map((t) => (
            <Tag key={`${t.region}${t.unit}`} label={`${t.region} ${t.unit}`.trim()} onRemove={() => setRegionTags((tags) => tags.filter((x) => x !== t))} />
          ))}
          {builder && <Tag label={`건설사 ${builder}`} onRemove={() => setBuilder(null)} />}
        </div>
      )}

      {/* 한 줄: 건수와 "필터" */}
      <div className="flex items-center justify-between border-b border-line pb-3 text-sm">
        <span className="text-muted">
          {filtered ? `${shown.length}건 (전체 ${result.notices.length}건)` : `${result.notices.length}건`}
          {!result.typesLoaded && " · 주택형별 정보는 불러오지 못했습니다"}
          {(verdictF.length > 0 || sort === "verdict") && verdicts.status === "loading" && " · 판정 불러오는 중…"}
        </span>
        <button type="button" onClick={() => setFilterOpen((v) => !v)} aria-expanded={filterOpen} className="text-brand underline underline-offset-2">
          {filterOpen ? "필터 닫기" : "필터"}
          {filterN > 0 && <span className="ml-0.5 text-accent-dark no-underline">({filterN})</span>}
        </button>
      </div>
      {filterOpen && (
        <div className="space-y-2.5 border-b border-line py-3 text-xs">
          <FilterRow label="지역">
            <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="시·도" className="rounded border border-line bg-white px-2 py-1 text-sm">
              <option>전체</option>
              {regions.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <span className="self-center text-muted">시·군·구와 건설사는 위 검색창에서 골라요.</span>
          </FilterRow>
          <FilterRow label="일정">
            {OPEN_STATUSES.map((s) => (
              <Chip key={s} on={statusF.includes(s)} onClick={() => setStatusF((l) => toggle(l, s))}>
                {s}
              </Chip>
            ))}
            <Chip on={hideClosed} onClick={() => setHideClosed((v) => !v)}>
              마감 제외
            </Chip>
          </FilterRow>
          <FilterRow label="공급">
            {(
              [
                ["민영", "민영"],
                ["공공", "공공·신혼희망타운"],
                ["무순위", "무순위·잔여세대"],
              ] as [Category, string][]
            ).map(([v, text]) => (
              <Chip key={v} on={categoryF.includes(v)} onClick={() => setCategoryF((l) => toggle(l, v))}>
                {text}
              </Chip>
            ))}
          </FilterRow>
          <FilterRow label="내 판정">
            {(["안정", "도전", "어려움"] as Verdict[]).map((v) => (
              <Chip key={v} on={verdictF.includes(v)} disabled={verdicts.status === "none"} onClick={() => setVerdictF((l) => toggle(l, v))}>
                {v}
              </Chip>
            ))}
            {verdicts.status === "none" && (
              <span className="self-center text-muted">
                {verdicts.reason === "점수 필요" ? (
                  <Link href="/score" className="text-brand underline">
                    가점을 저장하면
                  </Link>
                ) : (
                  <Link href="/check" className="text-brand underline">
                    거주지를 정하면
                  </Link>
                )}{" "}
                쓸 수 있어요
              </span>
            )}
          </FilterRow>
          <FilterRow label="정렬">
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="정렬" className="rounded border border-line bg-white px-2 py-1 text-sm">
              <option value="notice">최근 공고순</option>
              <option value="next">다음 일정 가까운 순</option>
              <option value="verdict" disabled={verdicts.status === "none"}>
                내 판정 좋은 순
              </option>
            </select>
            {filterN > 0 && (
              <button type="button" onClick={resetAll} className="self-center text-muted underline hover:text-brand">
                초기화
              </button>
            )}
          </FilterRow>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted">
          <p>{query ? `'${q}'에 맞는 공고가 없어요` : filtered ? "조건에 맞는 공고가 없습니다." : "기간 안에 서울·경기 APT 분양 공고가 없습니다."}</p>
          {filtered && (
            <button type="button" onClick={resetAll} className="mt-3 rounded border border-brand px-3 py-1.5 text-xs text-brand hover:bg-brand/5">
              검색·필터 초기화
            </button>
          )}
        </div>
      ) : (
        <ul>
          {shown.map(({ n, match }) => (
            <ListRow key={n.houseManageNo || n.name} n={n} match={match} href={rowHref(n.houseManageNo)} />
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-muted">
        출처: 한국부동산원 청약홈 분양정보 API · {new Date(result.fetchedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 기준
      </p>
    </div>
  );
}

// ───────── 일정·공급·판정 필터와 정렬 ─────────

type OpenStatus = Exclude<Status, "마감">;
type SortKey = "notice" | "next" | "verdict";
const OPEN_STATUSES: OpenStatus[] = ["접수 중", "접수 예정", "발표 대기"];
const NO_NOTICES: Notice[] = [];
const VERDICT_RANK: Record<Verdict, number> = { 안정: 0, 도전: 1, 어려움: 2 };

/** 정렬: 최근 공고순(원래 순서) / 다음 일정 가까운 순(마감은 맨 뒤) / 내 판정 좋은 순(같으면 다음 일정 순) */
function sortBy(key: SortKey, today: string, verdicts: Record<string, Verdict | null> | null) {
  const nextStart = (n: Notice) => nextEvent(n.schedule, today)?.start ?? "9999";
  return (a: { n: Notice }, b: { n: Notice }) => {
    if (key === "notice") return 0; // 청약홈 공고일 최신순 그대로
    const byNext = nextStart(a.n).localeCompare(nextStart(b.n));
    if (key === "next") return byNext;
    const rank = (n: Notice) => {
      const v = verdicts?.[n.houseManageNo] ?? null;
      return v ? VERDICT_RANK[v] : 9;
    };
    return rank(a.n) - rank(b.n) || byNext;
  };
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-12 shrink-0 pt-1 text-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, disabled = false, children }: { on: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 ${on ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:border-brand"} disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

/** 목록 한 줄: 썸네일, 단지명, 지역, 내 판정, 다음 일정. 누르면 상세로 */
const MATCH_LABEL: Record<MatchField, string> = { name: "", region: "", builder: "시공", agency: "공급기관", kind: "종류" };

/** 검색 조건 태그 (지역·건설사). ×로 빼기 */
function Tag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand/5 py-0.5 pr-1 pl-2.5 text-xs text-brand">
      {label}
      <button type="button" onClick={onRemove} aria-label={`${label} 빼기`} className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-brand/10">
        <svg viewBox="0 0 20 20" className="h-3 w-3" aria-hidden="true">
          <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </span>
  );
}

function ListRow({ n, match, href }: { n: Notice; match: Match | null; href: string }) {
  // 화면에 보일 때만 판정을 불러옴
  const ref = useRef<HTMLLIElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const next = nextEvent(n.schedule, todayKST());
  return (
    <li ref={ref} className="flex items-center gap-3 border-b border-line py-3">
      {/* 썸네일: 직접 넣은 조감도 > 분양 홈페이지 대표 이미지 > 위치 지도 */}
      <ComplexThumb
        name={n.name}
        address={n.address}
        region={`${n.region} ${n.unit}`}
      />
      <Link href={href} className="group flex min-w-0 flex-1 items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm leading-snug font-medium group-hover:underline">
            <Highlight text={n.name} range={match?.field === "name" ? match.range : null} />
          </span>
          <span className="block truncate text-xs text-muted">
            <Highlight text={`${n.region} ${n.unit}`.trim()} range={match?.field === "region" ? match.range : null} />
          </span>
          {/* 단지명·지역 밖에서 맞았으면 어디서 맞았는지 한 줄 */}
          {match && MATCH_LABEL[match.field] && (
            <span className="block truncate text-xs text-muted">
              {MATCH_LABEL[match.field]} <Highlight text={match.text} range={match.range} />
            </span>
          )}
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm">
            <VerdictText n={n} enabled={seen} />
          </span>
          <span className="block text-xs whitespace-nowrap text-muted">
            {next ? (
              <>
                <span className={next.dday <= 3 ? "text-accent-dark" : ""}>{ddayText(next)}</span> ({md(next.start)})
              </>
            ) : (
              "일정 종료"
            )}
          </span>
        </span>
        <span className="shrink-0 text-muted" aria-hidden>
          ›
        </span>
      </Link>
    </li>
  );
}

function VerdictText({ n, enabled }: { n: Notice; enabled: boolean }) {
  const v = useNoticeVerdict(n, enabled);
  if (v.status === "none") return <span className="text-xs text-muted">{v.text}</span>;
  if (v.status === "loading") return <span className="text-xs text-muted">판정 중…</span>;
  return v.verdict ? <span className={`font-semibold ${VERDICT_COLOR[v.verdict]}`}>{v.verdict}</span> : <span className="text-xs text-muted">판정 없음</span>;
}

/** 상세: 공고 정보, 내 판정, 일정 전체, 주택형별 공급세대 */
function NoticeDetail({ n, location }: { n: Notice; location: LocationBrief | undefined }) {
  const totalSupply = sum(n.types.map((t) => t.supply));
  const totalSpecial = sum(n.types.map((t) => t.special));
  const events = scheduleEvents(n.schedule);
  const today = todayKST();
  // 로그인한 경우에만: 상세를 본 공고를 "최근 열람한 공고"에 남김
  const my = useMy();
  const loggedIn = my.dataState === "ok";
  useEffect(() => {
    if (loggedIn) my.addRecent({ no: n.houseManageNo, name: n.name, sido: shortSido(n.region), unit: n.unit });
    // 공고가 바뀌거나 로그인했을 때만 기록
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.houseManageNo, loggedIn]);
  return (
    <div className="py-4">
      {/* 공고 정보. 단지명 아래에 대표 이미지(조감도 > 분양 홈페이지 이미지 > 위치 지도) */}
      <div>
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="line-clamp-2 leading-snug font-semibold">
              {n.url ? (
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {n.name}
                </a>
              ) : (
                n.name
              )}
              <span className="ml-2 text-xs font-normal text-muted">
                {[n.kind, n.supplyKind].filter(Boolean).join(" · ")}
              </span>
              {n.regulations?.["투기과열지구"] && <span className="ml-2 text-xs font-normal text-accent-dark">투기과열지구</span>}
              {n.regulations?.["조정대상지역"] && <span className="ml-2 text-xs font-normal text-accent-dark">조정대상지역</span>}
            </span>
            <span className="text-xs text-muted">공고일 {dot(n.noticeDate)}</span>
          </div>
          <div className="mt-3">
            <ComplexThumb
              name={n.name}
              address={n.address}
              region={`${n.region} ${n.unit}`}
              size="wide"
            />
          </div>
          <div className="mt-3 text-xs text-muted">{n.address || n.region}</div>
          <div className="mt-1 text-xs text-muted">
            청약접수 {dot(n.receiptStart)} ~ {dot(n.receiptEnd)} · 당첨자 발표 {dot(n.winnerDate)}
            {n.homepage && (
              <>
                {" · "}
                <a href={n.homepage} target="_blank" rel="noopener noreferrer" className="text-brand underline">
                  분양 홈페이지
                </a>
              </>
            )}
          </div>
          {/* 캘린더 파일 받기 + 관심 공고 별 표시(로그인하면 마이페이지에 저장) */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <CalendarButton notice={n} />
            <FavoriteStar item={favoriteFromNotice(n)} label />
          </div>
        </div>
      </div>

      {/* 내 판정, 입지 점수, 규제 */}
      <table className="mt-4 w-full border-t border-line text-sm">
        <tbody>
          <tr className="border-b border-line">
            <td className="py-2.5 text-muted">내 판정</td>
            <td className="py-2.5 text-right">
              <VerdictText n={n} enabled />
              {n.kind === "APT" && (
                <Link href={`/check?no=${encodeURIComponent(n.houseManageNo)}`} className="ml-3 text-xs text-brand underline">
                  근거 보기 →
                </Link>
              )}
            </td>
          </tr>
          {location && (
            <tr className="border-b border-line">
              <td className="py-2.5 text-muted">입지 점수</td>
              <td className="py-2.5 text-right">
                {location.total === null ? "데이터 없음" : `${location.total}/${location.max}점`}
                <Link href={`/location#${location.anchor}`} className="ml-3 text-xs text-brand underline">
                  근거 보기 →
                </Link>
              </td>
            </tr>
          )}
          {n.regulations && Object.entries(n.regulations).some(([, on]) => on) && (
            <tr className="border-b border-line">
              <td className="py-2.5 text-muted">규제</td>
              <td className="py-2.5 text-right text-[13px]">
                {Object.entries(n.regulations)
                  .filter(([, on]) => on)
                  .map(([name]) => name)
                  .join(", ")}
                <Link href={`/eligibility?no=${encodeURIComponent(n.houseManageNo)}`} className="ml-3 text-xs text-brand underline">
                  쉬운 설명 →
                </Link>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* 일정 전체 */}
      {events.length > 0 && (
        <>
          <h3 className="mt-6 border-b-2 border-brand pb-2 text-sm font-semibold text-brand">일정</h3>
          <table className="w-full text-sm tabular-nums">
            <tbody>
              {events.map((e) => (
                <tr key={e.key} className={`border-b border-line ${e.range.end < today ? "text-muted" : ""}`}>
                  <td className="py-2">{e.label}</td>
                  <td className="py-2 text-right">
                    {dot(e.range.start)}
                    {e.range.end !== e.range.start && ` ~ ${dot(e.range.end)}`}
                    {e.memo && <div className="text-xs text-muted">{e.memo}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {n.types.length > 0 && <h3 className="mt-6 border-b-2 border-brand pb-2 text-sm font-semibold text-brand">주택형별 공급세대</h3>}

      {n.types.length > 0 && (
        <table className="w-full text-[13px] tabular-nums">
          <thead>
            <tr className="text-xs text-muted">
              <th className="py-1 text-left font-normal">주택형</th>
              <th className="py-1 text-right font-normal">일반공급</th>
              <th className="py-1 text-right font-normal">특별공급</th>
              <th className="py-1 text-right font-normal">분양 최고가</th>
              <th className="py-1 text-right font-normal" />
            </tr>
          </thead>
          <tbody>
            {n.types.map((t, i) => (
              <tr key={`${t.type}-${i}`} className="border-t border-line">
                <td className="py-1.5">{t.type}</td>
                <td className="py-1.5 text-right">{t.supply ?? "–"}</td>
                <td className="py-1.5 text-right">{t.special ?? "–"}</td>
                <td className="py-1.5 text-right">{t.topAmount !== null ? `${t.topAmount.toLocaleString()}만원` : "–"}</td>
                <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                  {n.kind === "APT" && (
                    <Link
                      href={`/check?no=${encodeURIComponent(n.houseManageNo)}&type=${encodeURIComponent(t.type)}`}
                      className="text-xs text-brand underline"
                    >
                      가능성
                    </Link>
                  )}
                </td>
              </tr>
            ))}
            <tr className="border-t border-line text-muted">
              <td className="py-1.5">합계</td>
              <td className="py-1.5 text-right">{totalSupply ?? "–"}</td>
              <td className="py-1.5 text-right">{totalSpecial ?? "–"}</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function Fallback({ reason, complexes }: { reason: string; complexes: Complex[] }) {
  return (
    <div>
      <p className="mb-4 border-l-2 border-accent bg-accent/10 px-3 py-2 text-[13px] leading-relaxed">
        청약홈 API를 불러오지 못해 저장된 단지 데이터(complexes.csv)를 대신 보여줍니다.
        <span className="block text-xs text-muted">이유: {reason}</span>
      </p>

      {complexes.length === 0 ? (
        <p className="py-8 text-sm text-muted">complexes.csv에도 아직 등록된 단지가 없습니다.</p>
      ) : (
        <ul>
          {complexes.map((c) => (
            <li key={c.id} className="flex gap-3 border-b border-line py-3">
              <ComplexThumb name={c.name} address={c.address} region={`${c.sido} ${c.sigungu}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="line-clamp-2 leading-snug font-semibold">{c.name}</span>
                  <span className="text-xs text-muted">공고일 {dot(c.noticeDate)}</span>
                </div>
                <div className="text-xs text-muted">
                  {c.sido} {c.sigungu} · 주택형 {c.types.map((t) => t.type).join(", ")}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">
        당첨가점 판정은{" "}
        <Link href="/compare" className="text-brand underline">
          단지 비교
        </Link>
        에서 볼 수 있습니다.
      </p>
      <Notes />
    </div>
  );
}

function Notes() {
  return (
    <ul className="mt-4 space-y-0.5 text-xs leading-relaxed text-muted">
      <li>· 분양정보 API는 공고 내용과 공급세대수만 제공하고 당첨가점은 제공하지 않습니다. 당첨가점 판정은 단지 비교 화면에서 확인하세요.</li>
      <li>· 일정과 세대수는 정정 공고로 바뀔 수 있으니 청약 전 청약홈과 입주자모집공고를 꼭 확인하세요.</li>
    </ul>
  );
}

const dot = (d: string | null) => (d ? d.replaceAll("-", ".") : "–");

function sum(list: (number | null)[]): number | null {
  if (list.length === 0 || list.some((v) => v === null)) return null;
  return (list as number[]).reduce((a, b) => a + b, 0);
}
