/**
 * 분양 공고 API 중계 (Route Handler, 주소: /api/notices)
 *
 * 브라우저는 청약홈 API를 직접 부르지 않고 이 주소를 부릅니다.
 * 서버가 환경변수의 API 키로 청약홈을 대신 호출하고, 결과만 돌려줍니다.
 * → 키가 브라우저 코드나 네트워크 기록에 절대 나타나지 않습니다.
 */

import { connection } from "next/server";
import { fetchNotices, fetchRemndrNotices, remndrToNotice } from "@/lib/applyhome";

export async function GET(req: Request) {
  // 요청이 올 때마다 실행되게 합니다 (빌드할 때 한 번 실행한 결과로 굳지 않도록)
  await connection();
  const result = await fetchNotices();
  // ?include=remndr: 무순위·잔여세대 공고도 함께 (최근 분양 공고 화면, 지도로 찾기와 같은 범위). 못 받으면 분양 공고만
  if (result.ok && new URL(req.url).searchParams.get("include") === "remndr") {
    const rem = await fetchRemndrNotices();
    if (rem.ok) {
      const seen = new Set(result.notices.map((n) => n.houseManageNo));
      result.notices = [...result.notices, ...rem.notices.filter((r) => !seen.has(r.houseManageNo)).map(remndrToNotice)].sort((a, b) =>
        (b.noticeDate ?? "").localeCompare(a.noticeDate ?? ""),
      );
    }
  }
  // 실패해도 200으로 돌려주고, 화면이 ok 값을 보고 CSV로 대신 보여줍니다
  return Response.json(result, {
    headers: {
      // 같은 결과를 1시간 동안 Vercel 서버에 저장해 API 호출 횟수를 아낍니다
      "Cache-Control": result.ok ? "s-maxage=3600, stale-while-revalidate=600" : "no-store",
    },
  });
}
