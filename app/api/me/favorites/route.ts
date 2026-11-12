/**
 * 관심 공고 (주소: /api/me/favorites)
 *   POST   담기 { no, name, sido, unit, houseTy?, url?, noticeDate?, schedule? }
 *   DELETE 빼기 ?no=주택관리번호
 *   PATCH  방금 본 판정 기억 { verdicts: [{ no, verdict }] }
 */

import type { NoticeSchedule } from "@/lib/calendar";
import { addFavorite, ensureUser, removeFavorite, setFavoriteVerdicts } from "@/lib/db";
import { VERDICTS, type Verdict } from "@/lib/judge";
import { BadInput, body, houseNo, optDate, optText, text, withUser } from "@/lib/meApi";

const range = (v: unknown) => {
  const r = v as { start?: unknown; end?: unknown } | null;
  const start = optDate(r?.start);
  const end = optDate(r?.end);
  return start && end ? { start, end } : null;
};
const areas = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 3).map((x) => x.slice(0, 30)) : []);

/** 일정은 정해진 칸의 날짜만 골라 담음 */
function schedule(v: unknown): NoticeSchedule | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  return {
    special: range(s.special),
    rank1: range(s.rank1),
    rank1Areas: areas(s.rank1Areas),
    rank2: range(s.rank2),
    rank2Areas: areas(s.rank2Areas),
    winner: optDate(s.winner),
    contract: optDate(s.contract),
  };
}

export const POST = (req: Request) =>
  withUser(async (me) => {
    const b = await body(req);
    const f = {
      no: houseNo(b.no),
      name: text(b.name, "단지명"),
      sido: optText(b.sido, 10) ?? "",
      unit: optText(b.unit, 20) ?? "",
      houseTy: optText(b.houseTy, 20),
      url: optText(b.url)?.startsWith("https://") ? optText(b.url) : null,
      noticeDate: optDate(b.noticeDate),
      schedule: schedule(b.schedule),
    };
    await ensureUser(me.id, me.name);
    await addFavorite(me.id, f);
  });

export const DELETE = (req: Request) =>
  withUser((me) => removeFavorite(me.id, houseNo(new URL(req.url).searchParams.get("no"))));

export const PATCH = (req: Request) =>
  withUser(async (me) => {
    const b = await body(req);
    if (!Array.isArray(b.verdicts) || b.verdicts.length > 200) throw new BadInput("판정 목록이 올바르지 않습니다.");
    const list = b.verdicts.map((v: { no?: unknown; verdict?: unknown }) => ({
      no: houseNo(v?.no),
      verdict: VERDICTS.includes(v?.verdict as Verdict) ? (v.verdict as Verdict) : null,
    }));
    await setFavoriteVerdicts(me.id, list);
  });
