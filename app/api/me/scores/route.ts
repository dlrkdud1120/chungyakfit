/**
 * 내 점수 기록 추가 (주소: /api/me/scores, POST)
 * 계산된 항목별 점수와 총점, 계산 기준일만 받습니다. 생년월일 같은 원래 입력값은 받지 않습니다.
 */

import { addScore, ensureUser } from "@/lib/db";
import { body, optDate, score, withUser } from "@/lib/meApi";

export const POST = (req: Request) =>
  withUser(async (me) => {
    const b = await body(req);
    const s = {
      total: score(b.total, "총점"),
      homeless: score(b.homeless, "무주택기간 점수"),
      dependents: score(b.dependents, "부양가족 점수"),
      account: score(b.account, "청약통장 점수"),
      baseDate: optDate(b.baseDate),
    };
    await ensureUser(me.id, me.name);
    await addScore(me.id, s);
  });
