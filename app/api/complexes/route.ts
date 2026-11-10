/**
 * 단지 비교용 과거 당첨가점 목록 (Route Handler, 주소: /api/complexes)
 *
 * 예: /api/complexes?homeSido=경기&homeUnit=수원시
 *   내 거주지를 주면 단지마다 해당지역/기타경기/기타지역 중 나에게 맞는 당첨가점을 골라 줍니다.
 *   거주지가 없으면 해당지역 값을 씁니다.
 * 실패하면 { ok: false, reason }을 돌려주고, 화면은 data/complexes.csv로 대신 보여줍니다.
 */

import { connection } from "next/server";
import { fetchHistory, historyToComplexes, NOTICE_SETTINGS } from "@/lib/applyhome";
import { shortSido, SIMILAR_RULES } from "@/lib/similar";

export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams;
  const sido = shortSido(q.get("homeSido") ?? "");
  const home = sido ? { sido, unit: (q.get("homeUnit") ?? "").trim() } : null;

  const history = await fetchHistory(SIMILAR_RULES.yearsBack);
  if (!history.ok) return Response.json(history, { headers: { "Cache-Control": "no-store" } });

  return Response.json(
    {
      ok: true,
      complexes: historyToComplexes(history.rows, home, history.fetchedAt),
      fetchedAt: history.fetchedAt,
      scope: `최근 ${SIMILAR_RULES.yearsBack}년 ${NOTICE_SETTINGS.regions.join("·")}`,
    },
    { headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=600" } },
  );
}
