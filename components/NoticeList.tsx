"use client";

/**
 * 분양 공고 — 목록 → 상세 두 화면
 *  목록(/notice): 행마다 썸네일, 단지명, 지역, 내 판정, 다음 일정만. 지역 검색·필터는 "필터"를 눌러야 펼쳐짐
 *  상세(/notice?no=주택관리번호): 공급세대, 일정 전체, 규제, 입지 점수, 캘린더 추가, 관심 공고 별
 * /api/notices(서버)를 불러 청약홈 공고를 보여주고, 실패하면 data/complexes.csv의 단지 목록을 대신 보여줍니다.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Notice, NoticeResult } from "@/lib/applyhome";
import type { Complex } from "@/lib/complexes";
import { imageFor, type ComplexImages } from "@/lib/complexImage";
import CalendarButton from "@/components/CalendarButton";
import FavoriteStar from "@/components/FavoriteStar";
import { favoriteFromNotice } from "@/lib/meTypes";
import ComplexThumb from "@/components/ComplexThumb";
import type { LocationBrief } from "@/components/CompareList";
import { useMy } from "@/components/Providers";
import { useNoticeVerdict, VERDICT_COLOR } from "@/components/useNoticeVerdict";
import { shortSido } from "@/lib/similar";
import { scheduleEvents } from "@/lib/calendar";
import { locationKey } from "@/lib/location";
import { ddayText, md, nextEvent, todayKST } from "@/lib/mySchedule";

type State = { status: "loading" } | { status: "done"; result: NoticeResult };

export default function NoticeList({
  fallback,
  images,
  locations,
}: {
  fallback: Complex[];
  images: ComplexImages;
  locations: Record<string, LocationBrief>; // 키: locationKey(단지명, 지역)
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const detailNo = useSearchParams().get("no"); // 있으면 상세 화면
  // 목록 필터 (접어 둠)
  const [filterOpen, setFilterOpen] = useState(false);
  const [region, setRegion] = useState("전체");
  const [word, setWord] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/notices")
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
  if (!result.ok) return <Fallback reason={result.reason} complexes={fallback} images={images} />;

  // ───────── 상세 ─────────
  if (detailNo) {
    const n = result.notices.find((x) => x.houseManageNo === detailNo);
    return (
      <div>
        <Link href="/notice" className="inline-block rounded border border-line bg-white px-3 py-1.5 text-xs text-brand hover:border-brand">
          ← 목록
        </Link>
        {n ? (
          <NoticeDetail n={n} images={images} location={locations[locationKey(n.name, `${n.region} ${n.unit}`)]} />
        ) : (
          <p className="py-10 text-sm text-muted">이 공고를 찾지 못했어요. 접수 기간이 지나 목록에서 빠졌을 수 있어요.</p>
        )}
        <Notes />
      </div>
    );
  }

  // ───────── 목록 ─────────
  const regions = [...new Set(result.notices.map((n) => n.region))];
  const key = word.trim().replace(/\s+/g, "");
  const list = result.notices.filter(
    (n) => (region === "전체" || n.region === region) && (!key || `${n.name}${n.region}${n.unit}${n.address}`.replace(/\s+/g, "").includes(key)),
  );
  const filtered = region !== "전체" || key !== "";

  return (
    <div>
      {/* 한 줄: 건수와 "필터" */}
      <div className="flex items-center justify-between border-b border-line pb-3 text-sm">
        <span className="text-muted">
          {filtered ? `${list.length}건 (전체 ${result.notices.length}건)` : `${result.notices.length}건`}
          {!result.typesLoaded && " · 주택형별 정보는 불러오지 못했습니다"}
        </span>
        <button type="button" onClick={() => setFilterOpen((v) => !v)} aria-expanded={filterOpen} className="text-brand underline underline-offset-2">
          {filterOpen ? "필터 닫기" : "필터"}
        </button>
      </div>
      {filterOpen && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line py-3">
          <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="지역" className="rounded border border-line bg-white px-2 py-1.5 text-sm">
            <option>전체</option>
            {regions.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="단지명·지역 검색"
            aria-label="단지명·지역 검색"
            className="w-44 rounded border border-line bg-white px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
        </div>
      )}

      {list.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          {filtered ? "조건에 맞는 공고가 없습니다." : "기간 안에 서울·경기 APT 분양 공고가 없습니다."}
        </p>
      ) : (
        <ul>
          {list.map((n) => (
            <ListRow key={n.houseManageNo || n.name} n={n} images={images} />
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-muted">
        출처: 한국부동산원 청약홈 분양정보 API · {new Date(result.fetchedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 기준
      </p>
    </div>
  );
}

/** 목록 한 줄: 썸네일, 단지명, 지역, 내 판정, 다음 일정. 누르면 상세로 */
function ListRow({ n, images }: { n: Notice; images: ComplexImages }) {
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
      <ComplexThumb name={n.name} address={n.address} region={`${n.region} ${n.unit}`} image={imageFor(images, n.name)} />
      <Link href={`/notice?no=${encodeURIComponent(n.houseManageNo)}`} className="group flex min-w-0 flex-1 items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm leading-snug font-medium group-hover:underline">{n.name}</span>
          <span className="block truncate text-xs text-muted">
            {n.region} {n.unit}
          </span>
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
function NoticeDetail({ n, images, location }: { n: Notice; images: ComplexImages; location: LocationBrief | undefined }) {
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
      {/* 왼쪽 썸네일(조감도 또는 위치 지도) + 오른쪽 공고 정보 */}
      <div className="flex gap-3">
        <ComplexThumb name={n.name} address={n.address} region={`${n.region} ${n.unit}`} image={imageFor(images, n.name)} />
        <div className="min-w-0 flex-1">
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
          <div className="mt-0.5 text-xs text-muted">{n.address || n.region}</div>
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

function Fallback({ reason, complexes, images }: { reason: string; complexes: Complex[]; images: ComplexImages }) {
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
              <ComplexThumb name={c.name} address={c.address} region={`${c.sido} ${c.sigungu}`} image={imageFor(images, c.name)} />
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
