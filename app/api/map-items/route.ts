/**
 * 지도로 찾기용 공고 + 위치 (Route Handler, 주소: /api/map-items)
 *
 * 분양 공고(fetchNotices)와 무순위·잔여세대 공고(fetchRemndrNotices)를 합치고, 공고마다 위치를 찾아 붙입니다.
 * 위치는 lib/coords.ts와 같은 순서: data/coords.json(직접 확인한 좌표) → 카카오 주소·키워드 검색(실시간).
 * 카카오 결과는 운영정책상 저장·캐시하지 않으므로 이 응답도 no-store입니다. 위치를 못 찾으면 coord: null.
 * 키(APPLYHOME_API_KEY, KAKAO_REST_KEY)는 서버에서만 씁니다.
 */

import { connection } from "next/server";
import { fetchNotices, fetchRemndrNotices } from "@/lib/applyhome";
import { findCoord } from "@/lib/coords";
import type { Coord, MapItemsResponse, MapNotice } from "@/lib/map-items";

const CONCURRENCY = 6;

export async function GET() {
  await connection();
  const [notices, remndr] = await Promise.all([fetchNotices(), fetchRemndrNotices()]);
  if (!notices.ok) return Response.json({ ok: false, reason: notices.reason } satisfies MapItemsResponse, { headers: { "Cache-Control": "no-store" } });

  const list: MapNotice[] = [
    ...notices.notices.map((n) => ({ ...n, source: "apt" as const })),
    ...(remndr.ok ? remndr.notices.map((n) => ({ ...n, source: "remndr" as const })) : []),
  ];

  const items: (MapNotice & { coord: Coord | null })[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      const n = list[i];
      const r = await findCoord(n.name, n.address ?? "", `${n.region} ${n.unit}`.trim()).catch(() => null);
      items[i] = { ...n, coord: r && r.ok ? { lat: r.lat, lng: r.lng } : null };
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));

  return Response.json({ ok: true, items, fetchedAt: notices.fetchedAt } satisfies MapItemsResponse, { headers: { "Cache-Control": "no-store" } });
}
