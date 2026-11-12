/**
 * Supabase 저장소 (서버에서만 사용)
 *
 * 비밀 키(Secret key)로 접근하므로 이 파일은 Route Handler에서만 불러옵니다. 브라우저 코드에서 import 하지 마세요.
 * 모든 함수는 카카오 회원번호(kakaoId)로 자기 데이터만 다룹니다.
 * 환경변수: SUPABASE_URL, SUPABASE_SECRET_KEY (예전 이름 SUPABASE_SERVICE_ROLE_KEY도 읽음)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NoticeSchedule } from "./calendar";
import type { Verdict } from "./judge";
import { RECENT_MAX, SCORE_MAX, type CalendarItem, type Favorite, type FavoriteInput, type MeData, type RecentView, type ScoreRecord } from "./meTypes";

export class DbNotConfigured extends Error {}

let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  // 새 방식의 Secret key(sb_secret_…)를 먼저 보고, 없으면 예전 service_role 키를 씀
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new DbNotConfigured("SUPABASE_URL, SUPABASE_SECRET_KEY가 없습니다.");
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** Supabase 응답에서 오류가 있으면 던지기 */
function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

const todayKST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

/** 회원 줄이 없으면 만들고, 닉네임은 최신으로 맞춤 (거주지는 건드리지 않음) */
export async function ensureUser(kakaoId: string, nickname: string) {
  must(await db().from("users").upsert({ kakao_id: kakaoId, nickname }, { onConflict: "kakao_id" }));
}

export async function loadAll(kakaoId: string, nickname: string): Promise<MeData> {
  await ensureUser(kakaoId, nickname);
  const d = db();
  const [user, scores, favorites, recent, calendar] = await Promise.all([
    d.from("users").select("nickname, home_sido, home_unit").eq("kakao_id", kakaoId).single(),
    d.from("score_records").select("*").eq("kakao_id", kakaoId).order("created_at", { ascending: false }).limit(SCORE_MAX),
    d.from("favorites").select("*").eq("kakao_id", kakaoId).order("created_at", { ascending: false }),
    d.from("recent_views").select("*").eq("kakao_id", kakaoId).order("viewed_at", { ascending: false }).limit(RECENT_MAX),
    d.from("calendar_items").select("*").eq("kakao_id", kakaoId),
  ]);
  const u = must(user) as { nickname: string; home_sido: string; home_unit: string };
  return {
    nickname: u.nickname,
    home: { sido: u.home_sido, unit: u.home_unit },
    scores: (must(scores) as Row[]).map(
      (r): ScoreRecord => ({
        id: Number(r.id),
        total: Number(r.total),
        homeless: Number(r.homeless),
        dependents: Number(r.dependents),
        account: Number(r.account),
        baseDate: (r.base_date as string | null) ?? null,
        calcDate: r.calc_date as string,
      }),
    ),
    favorites: (must(favorites) as Row[]).map(
      (r): Favorite => ({
        no: r.house_manage_no as string,
        name: r.name as string,
        sido: r.sido as string,
        unit: r.unit as string,
        houseTy: (r.house_ty as string | null) ?? null,
        url: (r.url as string | null) ?? null,
        noticeDate: (r.notice_date as string | null) ?? null,
        schedule: (r.schedule as NoticeSchedule | null) ?? null,
        lastVerdict: (r.last_verdict as Verdict | null) ?? null,
      }),
    ),
    recent: (must(recent) as Row[]).map(
      (r): RecentView => ({
        no: r.house_manage_no as string,
        name: r.name as string,
        sido: r.sido as string,
        unit: r.unit as string,
        viewedAt: r.viewed_at as string,
      }),
    ),
    calendar: (must(calendar) as Row[]).map(
      (r): CalendarItem => ({
        no: r.house_manage_no as string,
        key: r.event_key as string,
        label: r.label as string,
        start: r.start_date as string,
        end: r.end_date as string,
      }),
    ),
  };
}
type Row = Record<string, unknown>;

export async function updateHome(kakaoId: string, sido: string, unit: string) {
  must(await db().from("users").update({ home_sido: sido, home_unit: unit }).eq("kakao_id", kakaoId));
}

export type ScoreInput = { total: number; homeless: number; dependents: number; account: number; baseDate: string | null };

/** 점수 기록 한 줄 추가 (계산한 날은 서버의 한국 날짜) */
export async function addScore(kakaoId: string, s: ScoreInput) {
  // 같은 날 같은 점수를 다시 저장하면 기록을 늘리지 않음
  const last = (
    must(await db().from("score_records").select("*").eq("kakao_id", kakaoId).order("created_at", { ascending: false }).limit(1)) as Row[]
  )[0];
  if (
    last &&
    last.calc_date === todayKST() &&
    Number(last.total) === s.total &&
    Number(last.homeless) === s.homeless &&
    Number(last.dependents) === s.dependents &&
    Number(last.account) === s.account &&
    ((last.base_date as string | null) ?? null) === s.baseDate
  ) {
    return;
  }
  must(
    await db().from("score_records").insert({
      kakao_id: kakaoId,
      total: s.total,
      homeless: s.homeless,
      dependents: s.dependents,
      account: s.account,
      base_date: s.baseDate,
      calc_date: todayKST(),
    }),
  );
}

export async function addFavorite(kakaoId: string, f: FavoriteInput) {
  must(
    await db()
      .from("favorites")
      .upsert(
        {
          kakao_id: kakaoId,
          house_manage_no: f.no,
          name: f.name,
          sido: f.sido,
          unit: f.unit,
          house_ty: f.houseTy,
          url: f.url,
          notice_date: f.noticeDate,
          schedule: f.schedule,
        },
        { onConflict: "kakao_id,house_manage_no" },
      ),
  );
}

export async function removeFavorite(kakaoId: string, no: string) {
  must(await db().from("favorites").delete().eq("kakao_id", kakaoId).eq("house_manage_no", no));
}

/** 마이페이지에서 방금 본 판정을 기억 (다음에 달라졌는지 비교용) */
export async function setFavoriteVerdicts(kakaoId: string, list: { no: string; verdict: Verdict | null }[]) {
  for (const v of list) {
    must(await db().from("favorites").update({ last_verdict: v.verdict }).eq("kakao_id", kakaoId).eq("house_manage_no", v.no));
  }
}

/** 최근 열람 공고 추가. 같은 공고는 시간만 갱신하고, RECENT_MAX개를 넘는 오래된 것은 지움 */
export async function addRecent(kakaoId: string, r: Omit<RecentView, "viewedAt">) {
  const d = db();
  must(
    await d
      .from("recent_views")
      .upsert(
        { kakao_id: kakaoId, house_manage_no: r.no, name: r.name, sido: r.sido, unit: r.unit, viewed_at: new Date().toISOString() },
        { onConflict: "kakao_id,house_manage_no" },
      ),
  );
  const rows = must(
    await d.from("recent_views").select("house_manage_no").eq("kakao_id", kakaoId).order("viewed_at", { ascending: false }),
  ) as { house_manage_no: string }[];
  const old = rows.slice(RECENT_MAX).map((x) => x.house_manage_no);
  if (old.length) must(await d.from("recent_views").delete().eq("kakao_id", kakaoId).in("house_manage_no", old));
}

/** no를 주면 하나만, 안 주면 전체 삭제 */
export async function removeRecent(kakaoId: string, no?: string) {
  let q = db().from("recent_views").delete().eq("kakao_id", kakaoId);
  if (no) q = q.eq("house_manage_no", no);
  must(await q);
}

export async function saveCalendar(kakaoId: string, items: CalendarItem[]) {
  if (!items.length) return;
  must(
    await db()
      .from("calendar_items")
      .upsert(
        items.map((i) => ({
          kakao_id: kakaoId,
          house_manage_no: i.no,
          event_key: i.key,
          label: i.label,
          start_date: i.start,
          end_date: i.end,
        })),
        { onConflict: "kakao_id,house_manage_no,event_key" },
      ),
  );
}

/** 내 정보 전체 삭제: 회원 줄을 지우면 나머지 표의 내 데이터도 함께 지워집니다 (on delete cascade) */
export async function deleteEverything(kakaoId: string) {
  must(await db().from("users").delete().eq("kakao_id", kakaoId));
}
