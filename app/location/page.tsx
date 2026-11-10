/**
 * 입지 점수 페이지 (/location)
 * 위: 점수 기준표 (lib/location.ts의 CRITERIA를 그대로 그림)
 * 아래: data/locations.csv에 입력한 단지별 점수와 계산 근거
 */

import { CRITERIA, LOCATION_MAX, type CountBand, type DistanceBand } from "@/lib/location";
import { loadLocations } from "@/lib/locationData";

export const metadata = { title: "입지 점수 — 청약핏" };

export default function LocationPage() {
  const { entries, warnings } = loadLocations();
  const sorted = [...entries].sort(
    (a, b) => (b.score.total ?? -1) - (a.score.total ?? -1) || b.score.partial - a.score.partial,
  );
  const A = CRITERIA.amenities;

  return (
    <>
      <header className="mb-8 border-b border-line pb-6">
        <h1 className="text-2xl font-bold text-brand sm:text-3xl">입지 점수</h1>
        <p className="mt-2 text-sm text-muted">
          교통과 생활편의 세 가지 항목으로 {LOCATION_MAX}점 만점 입지 점수를 매깁니다. 점수를 어떻게 매기는지 아래 기준표를 그대로
          공개합니다.
        </p>
      </header>

      {/* ───────── 기준표 ───────── */}
      <section>
        <h2 className="border-b-2 border-brand pb-2 text-sm font-semibold text-brand">점수 기준표</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="py-2 text-left font-normal">항목</th>
              <th className="py-2 text-left font-normal">구간</th>
              <th className="py-2 text-right font-normal">점수</th>
            </tr>
          </thead>
          <tbody>
            <BandRows title={CRITERIA.subway.title} max={CRITERIA.subway.max} bands={CRITERIA.subway.bands} />
            <BandRows title={CRITERIA.bus.title} max={CRITERIA.bus.max} bands={CRITERIA.bus.bands} />
            {Object.values(A.kinds).map((k) => (
              <BandRows key={k.title} title={`${A.title} — ${k.title}`} max={k.max} bands={k.bands} />
            ))}
            <tr className="border-t-2 border-brand">
              <td className="py-2 font-semibold" colSpan={2}>
                합계
              </td>
              <td className="py-2 text-right font-semibold tabular-nums">{LOCATION_MAX}점</td>
            </tr>
          </tbody>
        </table>
        <ul className="mt-3 space-y-0.5 text-xs leading-relaxed text-muted">
          <li>· 이 기준표는 청약핏이 정한 비교용 기준이며 공식 평가 지표가 아닙니다.</li>
          <li>· 생활편의시설은 마트·병원·학교를 종류별로 따로 점수 매겨 더합니다. 한 종류만 많은 곳이 높게 나오지 않도록 하기 위해서입니다.</li>
          <li>· 거리와 개수는 단지마다 같은 지도 서비스, 같은 방법(예: 단지 정문 기준 직선거리)으로 재야 비교가 공정합니다.</li>
          <li>· 항목 중 하나라도 비어 있으면 합계를 내지 않고 &ldquo;데이터 없음&rdquo;으로 표시합니다.</li>
        </ul>
      </section>

      {warnings.length > 0 && (
        <details className="mt-8 border-l-2 border-line px-3 py-2 text-[13px]">
          <summary className="cursor-pointer font-semibold text-accent-dark">CSV에서 확인할 부분 {warnings.length}건</summary>
          <ul className="mt-2 space-y-1 text-muted">
            {warnings.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        </details>
      )}

      {/* ───────── 단지별 점수 ───────── */}
      <section className="mt-10">
        <h2 className="border-b-2 border-brand pb-2 text-sm font-semibold text-brand">단지별 입지 점수</h2>

        {sorted.length === 0 ? (
          <div className="py-8 text-sm leading-relaxed text-muted">
            <p className="font-semibold text-ink">아직 입력된 단지가 없습니다.</p>
            <p className="mt-2">
              지도에서 잰 값을 <code className="text-ink">data/locations.csv</code>에 한 줄씩 추가하고 다시 배포하면 여기에 나타납니다.
              단지명과 지역을 <code className="text-ink">complexes.csv</code>와 똑같이 적으면 단지 비교 화면에도 입지 점수가 붙습니다.
            </p>
          </div>
        ) : (
          <ul>
            {sorted.map((e) => (
              <li key={e.key} id={e.anchor} className="scroll-mt-6 border-b border-line py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{e.name}</div>
                    <div className="text-xs text-muted">
                      {e.region}
                      {e.method && ` · ${e.method}`}
                      {e.checkedAt && ` · ${e.checkedAt} 확인`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    {e.score.total !== null ? (
                      <>
                        <b className="text-lg text-brand">{e.score.total}</b>
                        <span className="text-sm text-muted"> / {e.score.max}점</span>
                      </>
                    ) : (
                      <span className="text-sm text-muted">데이터 없음</span>
                    )}
                  </div>
                </div>

                <table className="mt-2 w-full text-[13px]">
                  <tbody>
                    {e.score.items.map((it) => (
                      <tr key={it.title} className="border-t border-line align-top">
                        <td className="w-[38%] py-1.5 pr-2 text-muted">{it.title}</td>
                        <td className="py-1.5 pr-2">{it.reason}</td>
                        <td className="w-16 py-1.5 text-right tabular-nums">
                          {it.score === null ? "–" : `${it.score}/${it.max}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function BandRows({
  title,
  max,
  bands,
}: {
  title: string;
  max: number;
  bands: readonly (DistanceBand | CountBand)[];
}) {
  return (
    <>
      {bands.map((b, i) => (
        <tr key={b.label} className={i === 0 ? "border-t border-line" : ""}>
          {i === 0 && (
            <td rowSpan={bands.length} className="w-[40%] py-1.5 pr-3 align-top">
              {title}
              <div className="text-xs text-muted">최대 {max}점</div>
            </td>
          )}
          <td className="py-1.5 text-muted">{b.label}</td>
          <td className="py-1.5 text-right tabular-nums">{b.score}점</td>
        </tr>
      ))}
    </>
  );
}
