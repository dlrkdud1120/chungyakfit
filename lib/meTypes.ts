/** 마이페이지 데이터 모양 (화면·서버 공용). 저장 항목은 supabase/schema.sql과 같습니다. */

import type { NoticeSchedule } from "./calendar";
import type { Notice } from "./applyhome";
import type { Verdict } from "./judge";
import { shortSido } from "./similar";

export type ScoreRecord = {
  id: number;
  total: number;
  homeless: number;
  dependents: number;
  account: number;
  baseDate: string | null; // 계산 기준일
  calcDate: string; // 계산해서 저장한 날
};

export type Favorite = {
  no: string; // 주택관리번호
  name: string;
  sido: string;
  unit: string;
  houseTy: string | null;
  url: string | null;
  noticeDate: string | null;
  schedule: NoticeSchedule | null;
  lastVerdict: Verdict | null;
};

/** 관심 공고로 담을 때 보내는 값 */
export type FavoriteInput = Omit<Favorite, "lastVerdict">;

/** 분양 공고 → 관심 공고로 담을 값. 주택형을 안 고르면 일반공급이 가장 많은 주택형으로 판정 */
export function favoriteFromNotice(n: Notice, houseTy?: string | null): FavoriteInput {
  const main = [...n.types].sort((a, b) => (b.supply ?? 0) - (a.supply ?? 0))[0];
  return {
    no: n.houseManageNo,
    name: n.name,
    sido: shortSido(n.region),
    unit: n.unit,
    houseTy: houseTy ?? (n.kind === "APT" ? (main?.type ?? null) : null),
    url: n.url ?? null,
    noticeDate: n.noticeDate ?? null,
    schedule: n.schedule,
  };
}

export type RecentView = { no: string; name: string; sido: string; unit: string; viewedAt: string };

export type CalendarItem = { no: string; key: string; label: string; start: string; end: string };

export type MeData = {
  nickname: string;
  home: { sido: string; unit: string };
  scores: ScoreRecord[]; // 최신 순
  favorites: Favorite[];
  recent: RecentView[]; // 최신 순, 최대 20개
  calendar: CalendarItem[];
};

export type MeResponse =
  | { ok: true; data: MeData }
  | { ok: false; reason: "login" | "db-setup" | "db-error"; message?: string };

export const RECENT_MAX = 20; // 최근 열람 공고 보관 개수
export const SCORE_MAX = 60; // 점수 기록을 몇 개까지 불러올지
