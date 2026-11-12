/**
 * 내 데이터 (주소: /api/me) — 로그인한 사람만
 *   GET    마이페이지에 필요한 내 데이터 전부
 *   PATCH  거주지 수정 { sido, unit }
 *   DELETE 내 정보 전체 삭제
 */

import { deleteEverything, loadAll, updateHome } from "@/lib/db";
import { BadInput, body, withUser } from "@/lib/meApi";
import { SIDO_LIST } from "@/lib/similar";

export const GET = () => withUser((me) => loadAll(me.id, me.name));

export const PATCH = (req: Request) =>
  withUser(async (me) => {
    const b = await body(req);
    const sido = typeof b.sido === "string" ? b.sido : "";
    const unit = typeof b.unit === "string" ? b.unit.trim().slice(0, 20) : "";
    if (sido !== "" && !SIDO_LIST.includes(sido)) throw new BadInput("시·도 값이 올바르지 않습니다.");
    await updateHome(me.id, sido, unit);
  });

export const DELETE = () => withUser((me) => deleteEverything(me.id));
