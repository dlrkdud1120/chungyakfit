/**
 * 비슷한 과거 사례 찾기 (Route Handler, 주소: /api/similar)
 *
 * 예: /api/similar?sido=경기&unit=수원시&band=m&homeSido=경기&homeUnit=수원시
 *   sido·unit·band : 원하는 단지의 시·도, 시·군·구, 면적대(s/m/l)
 *   homeSido·homeUnit : 내 거주지 (해당지역·기타지역 구분용)
 *   reside(선택) : 거주 구분을 직접 고른 경우 (해당지역/기타경기/기타지역)
 *   exclude(선택) : 원하는 단지 자신의 주택관리번호 (이미 결과가 있어도 사례에서 뺌)
 *   houseTy(선택) : 원하는 단지의 주택형 (084.9800A). exclude와 함께 주면 그 주택형의 경쟁률(targetCmpet)도 돌려줌
 * 내 가점은 서버로 보내지 않습니다. 판정은 화면에서 lib/judge.ts로 합니다.
 */

import { connection } from "next/server";
import { cmpetKey, fetchHistory } from "@/lib/applyhome";
import { findSimilar, shortSido, SIMILAR_RULES, type BandId, type Reside } from "@/lib/similar";

const BANDS = SIMILAR_RULES.bands.map((b) => b.id) as string[];
const RESIDES: Reside[] = ["해당지역", "기타경기", "기타지역"];

export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams;
  const sido = shortSido(q.get("sido") ?? "");
  const unit = (q.get("unit") ?? "").trim();
  const band = q.get("band") ?? "";
  const home = { sido: shortSido(q.get("homeSido") ?? ""), unit: (q.get("homeUnit") ?? "").trim() };
  const reside = q.get("reside") as Reside | null;

  if (!sido || !unit || !BANDS.includes(band) || !home.sido) {
    return Response.json({ ok: false, reason: "단지 지역, 면적대, 내 거주지를 모두 골라 주세요." }, { status: 400 });
  }

  const history = await fetchHistory(SIMILAR_RULES.yearsBack);
  if (!history.ok) return Response.json(history, { headers: { "Cache-Control": "no-store" } });

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const result = findSimilar(
    history.rows,
    { sido, unit, band: band as BandId, excludeNo: q.get("exclude") ?? undefined },
    home,
    reside && RESIDES.includes(reside) ? reside : null,
    today,
  );

  // 원하는 단지 주택형의 경쟁률 (당첨가점이 아직 없는 공고도 경쟁률은 있을 수 있음)
  const exclude = q.get("exclude");
  const houseTy = q.get("houseTy");
  const targetCmpet = exclude && houseTy ? (history.cmpet[cmpetKey(exclude, houseTy)] ?? null) : null;

  return Response.json(
    { ok: true, result, targetCmpet, fetchedAt: history.fetchedAt, totalRows: history.rows.length },
    { headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=600" } },
  );
}
