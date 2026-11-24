/**
 * 단지 대표 이미지 주소 (Route Handler)
 *
 *   /api/og-image?name=단지명      ← 모든 화면이 쓰는 방식 (청약홈 API를 부르지 않음)
 *   /api/og-image?no=주택관리번호  ← 예전 방식 (공고 목록에서 단지명을 찾은 뒤 같은 규칙으로)
 *
 * 순서는 lib/image-resolve.ts 하나로 정합니다: image-overrides.json → 직접 넣은 조감도(CSV) → 자동 수집 → 지도.
 * 서버는 분양 홈페이지에 접속하지 않고, 미리 만들어 둔 파일만 읽습니다.
 * 응답: { ok: true, image, kind, source, homepage, review, note? } 또는 { ok: false, reason }
 */

import { connection } from "next/server";
import { fetchNotices } from "@/lib/applyhome";
import { resolveImage } from "@/lib/image-resolve";

export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams;
  const headers = { "Cache-Control": "public, max-age=600" };

  let name = (q.get("name") ?? "").trim().slice(0, 120);
  if (!name) {
    const no = (q.get("no") ?? "").trim();
    if (!/^\d{6,12}$/.test(no)) return Response.json({ ok: false, reason: "단지명(name)이 필요합니다." }, { status: 400 });
    const notices = await fetchNotices();
    name = (notices.ok ? notices.notices.find((n) => n.houseManageNo === no)?.name : null) ?? "";
    if (!name) return Response.json({ ok: false, reason: "공고를 찾지 못했습니다." }, { headers });
  }

  return Response.json({ ok: true, ...resolveImage(name) }, { headers });
}
