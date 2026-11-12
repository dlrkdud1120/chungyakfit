"use client";

/**
 * 분양 공고 목록
 * /api/notices(서버)를 불러 청약홈 공고를 보여주고,
 * 실패하면 data/complexes.csv의 단지 목록을 대신 보여줍니다.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Notice, NoticeResult } from "@/lib/applyhome";
import type { Complex } from "@/lib/complexes";
import { imageFor, type ComplexImages } from "@/lib/complexImage";
import CalendarButton from "@/components/CalendarButton";
import ComplexThumb from "@/components/ComplexThumb";

type State = { status: "loading" } | { status: "done"; result: NoticeResult };

export default function NoticeList({ fallback, images }: { fallback: Complex[]; images: ComplexImages }) {
  const [state, setState] = useState<State>({ status: "loading" });

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

  return (
    <div>
      <p className="border-b border-line pb-3 text-xs text-muted">
        출처: 한국부동산원 청약홈 분양정보 API · {new Date(result.fetchedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 기준 ·{" "}
        {result.notices.length}건
        {!result.typesLoaded && " · 주택형별 정보는 불러오지 못했습니다"}
      </p>

      {result.notices.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">기간 안에 서울·경기 APT 분양 공고가 없습니다.</p>
      ) : (
        <ul>
          {result.notices.map((n) => (
            <NoticeRow key={n.houseManageNo || n.name} n={n} images={images} />
          ))}
        </ul>
      )}

      <Notes />
    </div>
  );
}

function NoticeRow({ n, images }: { n: Notice; images: ComplexImages }) {
  const totalSupply = sum(n.types.map((t) => t.supply));
  const totalSpecial = sum(n.types.map((t) => t.special));
  return (
    <li className="border-b border-line py-4">
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
          <CalendarButton notice={n} className="mt-2" />
        </div>
      </div>

      {n.types.length > 0 && (
        <table className="mt-2 w-full text-[13px] tabular-nums">
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
    </li>
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
