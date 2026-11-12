/**
 * 캘린더에 담은 일정 기록 (주소: /api/me/calendar, POST)
 * "내 캘린더에 추가"를 누를 때 어떤 일정을 받았는지만 남깁니다. { items: [{ no, key, label, start, end }] }
 */

import { ensureUser, saveCalendar } from "@/lib/db";
import { BadInput, body, houseNo, optDate, text, withUser } from "@/lib/meApi";

const KEYS = ["special", "rank1", "rank2", "winner", "contract"];

export const POST = (req: Request) =>
  withUser(async (me) => {
    const b = await body(req);
    if (!Array.isArray(b.items) || b.items.length > 300) throw new BadInput("일정 목록이 올바르지 않습니다.");
    const items = b.items.map((i: Record<string, unknown>) => {
      const start = optDate(i?.start);
      const end = optDate(i?.end);
      if (!start || !end || !KEYS.includes(i?.key as string)) throw new BadInput("일정 값이 올바르지 않습니다.");
      return { no: houseNo(i.no), key: i.key as string, label: text(i.label, "일정 이름", 30), start, end };
    });
    await ensureUser(me.id, me.name);
    await saveCalendar(me.id, items);
  });
