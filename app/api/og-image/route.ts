/**
 * 단지 대표 이미지 주소 (Route Handler, 주소: /api/og-image?no=주택관리번호)
 *
 * 브라우저는 공고 번호만 보내고, 홈페이지 주소는 서버가 청약홈 분양정보(HMPG_ADRES)에서 찾습니다.
 * (아무 주소나 대신 읽어 주는 통로가 되지 않도록, 주소를 직접 받지 않습니다)
 * 순서: data/image-overrides.json의 직접 지정 → 보관해 둔 결과 → 홈페이지에서 새로 고르기
 * 응답: { ok: true, image: "https://…" | null, homepage, kind } 또는 { ok: false }
 *   &detail=1  고른 이유까지 (확인용 화면 /admin/images)
 *   &refresh=1 보관해 둔 결과를 무시하고 다시 가져오기 (10분 안에 다시 누르면 접속하지 않음)
 */

import { connection } from "next/server";
import { fetchNotices } from "@/lib/applyhome";
import { PICK_RULES } from "@/lib/image-pick";
import { overrideFor } from "@/lib/imageOverrides";
import { cleanHomepage, getOgImage } from "@/lib/ogImage";

export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams;
  const no = (q.get("no") ?? "").trim();
  if (!/^\d{6,12}$/.test(no)) return Response.json({ ok: false, reason: "공고 번호가 필요합니다." }, { status: 400 });
  const detail = q.get("detail") === "1";
  const refresh = q.get("refresh") === "1";
  const headers = { "Cache-Control": detail || refresh ? "no-store" : "public, max-age=600" };

  const notices = await fetchNotices();
  const notice = notices.ok ? notices.notices.find((n) => n.houseManageNo === no) : null;
  if (!notice) return Response.json({ ok: false, reason: "공고를 찾지 못했습니다." }, { headers });
  const homepage = cleanHomepage(notice.homepage)?.toString() ?? null;

  // 1) 직접 지정 (숨김 또는 이미지 주소)
  const over = overrideFor(notice.name);
  if (over) {
    return Response.json(
      {
        ok: true,
        image: over.type === "url" ? over.url : null,
        homepage,
        kind: over.type === "url" ? "직접 지정" : "숨김",
        ...(detail ? { detail: { v: PICK_RULES.version, msg: "image-overrides.json" } } : {}),
      },
      { headers },
    );
  }

  // 2) 자동 (보관된 결과 또는 새로 고르기)
  const result = await getOgImage(notice.homepage, refresh);
  if (!result) {
    return Response.json(
      { ok: true, image: null, homepage: null, kind: "지도", ...(detail ? { detail: { v: PICK_RULES.version, msg: "홈페이지 주소 없음" } } : {}) },
      { headers },
    );
  }
  return Response.json(
    { ok: true, image: result.image, homepage: result.homepage, kind: result.kind, ...(detail ? { detail: result.detail, fetchedAt: result.fetchedAt } : {}) },
    { headers },
  );
}
