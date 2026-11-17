/**
 * 단지 대표 이미지 주소 (Route Handler, 주소: /api/og-image?no=주택관리번호)
 *
 * 브라우저는 공고 번호만 보내고, 홈페이지 주소는 서버가 청약홈 분양정보(HMPG_ADRES)에서 찾습니다.
 * (아무 주소나 대신 읽어 주는 통로가 되지 않도록, 주소를 직접 받지 않습니다)
 * 응답: { ok: true, image: "https://…" | null, homepage: "https://…" } 또는 { ok: false }
 */

import { connection } from "next/server";
import { fetchNotices } from "@/lib/applyhome";
import { getOgImage } from "@/lib/ogImage";

export async function GET(req: Request) {
  await connection();
  const no = (new URL(req.url).searchParams.get("no") ?? "").trim();
  if (!/^\d{6,12}$/.test(no)) return Response.json({ ok: false, reason: "공고 번호가 필요합니다." }, { status: 400 });

  const notices = await fetchNotices();
  const notice = notices.ok ? notices.notices.find((n) => n.houseManageNo === no) : null;
  const result = notice ? await getOgImage(notice.homepage) : null;
  if (!result) return Response.json({ ok: false }, { headers: { "Cache-Control": "public, max-age=600" } });

  return Response.json(
    { ok: true, image: result.image, homepage: result.homepage },
    { headers: { "Cache-Control": "public, max-age=3600" } }, // 브라우저도 한 시간은 다시 묻지 않음
  );
}
