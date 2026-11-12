/**
 * 단지 위치 좌표 (Route Handler, 주소: /api/coords)
 *
 * 예: /api/coords?name=○○아파트&address=경기도 수원시 …&region=경기 수원시
 * 카카오 REST 키는 서버에만 있고, 브라우저는 이 주소만 부릅니다.
 * 카카오 결과는 정책상 저장·캐시하지 않으므로 응답도 no-store입니다.
 */

import { connection } from "next/server";
import { findCoord } from "@/lib/coords";

export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams;
  const name = (q.get("name") ?? "").slice(0, 120).trim();
  const address = (q.get("address") ?? "").slice(0, 200).trim();
  const region = (q.get("region") ?? "").slice(0, 60).trim();
  if (!name && !address) {
    return Response.json({ ok: false, reason: "단지명이나 주소가 필요합니다." }, { status: 400 });
  }
  const result = await findCoord(name, address, region);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
