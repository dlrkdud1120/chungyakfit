/**
 * 최근 열람한 공고 (주소: /api/me/recent)
 *   POST   추가 { no, name, sido, unit } — 최근 20개만 남김
 *   DELETE ?no=주택관리번호 하나 삭제, no가 없으면 전체 삭제
 */

import { addRecent, ensureUser, removeRecent } from "@/lib/db";
import { body, houseNo, optText, text, withUser } from "@/lib/meApi";

export const POST = (req: Request) =>
  withUser(async (me) => {
    const b = await body(req);
    const r = { no: houseNo(b.no), name: text(b.name, "단지명"), sido: optText(b.sido, 10) ?? "", unit: optText(b.unit, 20) ?? "" };
    await ensureUser(me.id, me.name);
    await addRecent(me.id, r);
  });

export const DELETE = (req: Request) =>
  withUser((me) => {
    const no = new URL(req.url).searchParams.get("no");
    return removeRecent(me.id, no ? houseNo(no) : undefined);
  });
