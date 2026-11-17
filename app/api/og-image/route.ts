/**
 * 단지 대표 이미지 주소 (Route Handler, 주소: /api/og-image?no=주택관리번호)
 *
 * 서버는 분양 홈페이지에 접속하지 않습니다. 미리 만들어 둔 파일만 읽습니다.
 * 순서: 1) data/image-overrides.json (숨김 또는 직접 넣은 주소)
 *       2) data/auto-images.json (npm run collect-images 로 우리 컴퓨터에서 모은 결과)
 *       3) 없으면 image: null → 화면은 지도 썸네일을 보여줌
 * 응답: { ok: true, image: "https://…" | null, homepage, kind, note?, checkedAt? } 또는 { ok: false }
 */

import { connection } from "next/server";
import { fetchNotices } from "@/lib/applyhome";
import { autoImageFor, autoSkippedFor } from "@/lib/autoImages";
import { overrideFor } from "@/lib/imageOverrides";

export type ImageKind = "직접 지정" | "숨김" | "자동 이미지" | "지도";

export async function GET(req: Request) {
  await connection();
  const no = (new URL(req.url).searchParams.get("no") ?? "").trim();
  if (!/^\d{6,12}$/.test(no)) return Response.json({ ok: false, reason: "공고 번호가 필요합니다." }, { status: 400 });
  const headers = { "Cache-Control": "public, max-age=600" };

  const notices = await fetchNotices();
  const notice = notices.ok ? notices.notices.find((n) => n.houseManageNo === no) : null;
  if (!notice) return Response.json({ ok: false, reason: "공고를 찾지 못했습니다." }, { headers });
  const homepage = /^https?:\/\//i.test(notice.homepage ?? "") ? notice.homepage : null;
  const answer = (image: string | null, kind: ImageKind, more: { homepage?: string | null; note?: string; checkedAt?: string } = {}) =>
    Response.json({ ok: true, image, kind, homepage, ...more }, { headers });

  // 1) 직접 지정 (숨김 또는 이미지 주소)
  const over = overrideFor(notice.name);
  if (over) return answer(over.type === "url" ? over.url : null, over.type === "url" ? "직접 지정" : "숨김", { note: "image-overrides.json" });

  // 2) 자동으로 모아 둔 이미지
  const auto = autoImageFor(notice.name);
  if (auto) return answer(auto.image, "자동 이미지", { homepage: auto.homepage, checkedAt: auto.checkedAt });

  // 3) 없음 → 지도 (모을 때 건너뛴 이유가 있으면 함께)
  const skipped = autoSkippedFor(notice.name);
  return answer(null, "지도", { note: skipped?.reason ?? "아직 모으지 않음 (npm run collect-images)", checkedAt: skipped?.checkedAt });
}
