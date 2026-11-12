/**
 * /api/me… Route Handler 공용 도우미 (서버에서만 사용)
 * 로그인 확인, 입력값 검사, 오류를 같은 모양의 응답으로 바꾸는 일을 합니다.
 */

import { connection } from "next/server";
import { currentUser, type Me } from "./auth";
import { DbNotConfigured } from "./db";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/** 로그인한 사람만 통과. 로그인 전이면 401, DB 설정 전이면 그 사실을 알려줌 */
export async function withUser(run: (me: Me) => Promise<unknown>): Promise<Response> {
  await connection();
  const me = await currentUser();
  if (!me) return Response.json({ ok: false, reason: "login" }, { status: 401, ...NO_STORE });
  try {
    const data = await run(me);
    return Response.json({ ok: true, ...(data === undefined ? {} : { data }) }, NO_STORE);
  } catch (e) {
    if (e instanceof BadInput) return Response.json({ ok: false, reason: "bad-input", message: e.message }, { status: 400, ...NO_STORE });
    if (e instanceof DbNotConfigured) return Response.json({ ok: false, reason: "db-setup" }, { status: 503, ...NO_STORE });
    return Response.json({ ok: false, reason: "db-error", message: (e as Error).message }, { status: 500, ...NO_STORE });
  }
}

export class BadInput extends Error {}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    if (b && typeof b === "object") return b as Record<string, unknown>;
  } catch {
    // 아래에서 처리
  }
  throw new BadInput("요청 내용을 읽지 못했습니다.");
}

/** 글자 (필수, 길이 제한) */
export function text(v: unknown, name: string, max = 100): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new BadInput(`${name} 값이 올바르지 않습니다.`);
  return v.trim();
}
/** 글자 (없어도 됨) */
export function optText(v: unknown, max = 300): string | null {
  return typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
}
/** 날짜 2026-11-16 (없어도 됨) */
export function optDate(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
/** 0~100 사이 점수 */
export function score(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) throw new BadInput(`${name} 값이 올바르지 않습니다.`);
  return v;
}
/** 주택관리번호 (숫자 6~12자리) */
export function houseNo(v: unknown): string {
  if (typeof v !== "string" || !/^\d{6,12}$/.test(v)) throw new BadInput("공고 번호가 올바르지 않습니다.");
  return v;
}
