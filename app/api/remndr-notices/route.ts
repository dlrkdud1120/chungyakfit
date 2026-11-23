/**
 * 무순위·잔여세대 공고 중계 (Route Handler, 주소: /api/remndr-notices)
 * 홈 화면 "이번 주 청약 소식" 팝업에서만 씁니다. 키는 서버에서만 씁니다.
 */

import { connection } from "next/server";
import { fetchRemndrNotices } from "@/lib/applyhome";

export async function GET() {
  await connection();
  const result = await fetchRemndrNotices();
  return Response.json(result, {
    headers: { "Cache-Control": result.ok ? "s-maxage=3600, stale-while-revalidate=600" : "no-store" },
  });
}
