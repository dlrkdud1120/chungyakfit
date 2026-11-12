"use client";

/**
 * 로그인 상태와 내 데이터 보관소 (모든 화면 공용)
 *
 * - 로그인은 선택입니다. 로그인하지 않으면 아무것도 서버로 보내지 않고, 기존 기능은 그대로 동작합니다.
 * - 로그인하면 /api/me에서 내 데이터(점수 기록, 관심 공고, 최근 열람, 캘린더)를 받아 둡니다.
 * - 가점 계산에서 점수를 저장하면(브라우저 저장) 로그인한 경우에만 계정에도 기록을 남깁니다.
 *   서버로 보내는 것은 계산된 점수뿐이고, 생년월일 같은 입력값은 보내지 않습니다.
 */

import { SessionProvider, signIn, signOut, useSession } from "next-auth/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Verdict } from "@/lib/judge";
import type { CalendarItem, FavoriteInput, MeData, MeResponse } from "@/lib/meTypes";
import { parseMyHome, readMyHomeRaw, saveMyHome } from "@/lib/myHome";
import { parseMyScore, readMyScoreRaw, saveMyScore, subscribeMyScore, type SavedScore } from "@/lib/myScore";

type DataState = "idle" | "loading" | "ok" | "db-setup" | "error";

type My = {
  enabled: boolean; // 로그인 환경변수가 설정됐는지
  status: "loading" | "guest" | "user";
  userId: string | null;
  nickname: string | null;
  data: MeData | null;
  dataState: DataState;
  login: () => void;
  logout: () => void;
  reload: () => void;
  isFavorite: (no: string) => boolean;
  toggleFavorite: (f: FavoriteInput) => void;
  rememberVerdicts: (list: { no: string; verdict: Verdict | null }[]) => void;
  addRecent: (r: { no: string; name: string; sido: string; unit: string }) => void;
  removeRecent: (no?: string) => void;
  saveCalendar: (items: CalendarItem[]) => void;
  setHome: (sido: string, unit: string) => void;
  uploadScore: (s: SavedScore) => Promise<void>;
  deleteAll: () => Promise<boolean>;
};

const Ctx = createContext<My | null>(null);

export function useMy(): My {
  const v = useContext(Ctx);
  if (!v) throw new Error("Providers 안에서만 쓸 수 있습니다.");
  return v;
}

export default function Providers({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return (
    // refetchOnWindowFocus를 꺼서 불필요한 요청을 줄임
    <SessionProvider refetchOnWindowFocus={false}>
      <MyProvider enabled={enabled}>{children}</MyProvider>
    </SessionProvider>
  );
}

const json = (method: string, data?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: data === undefined ? undefined : JSON.stringify(data),
});

function MyProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const session = useSession();
  const user = session.status === "authenticated" ? (session.data.user as { id?: string; name?: string | null }) : null;
  const userId = user?.id ?? null;
  const status: My["status"] = session.status === "loading" ? "loading" : userId ? "user" : "guest";

  const [loaded, setLoaded] = useState<{ for: string; data: MeData | null; state: DataState } | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  // 로그인하면 내 데이터 불러오기
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<MeResponse>)
      .catch((): MeResponse => ({ ok: false, reason: "db-error" }))
      .then((res) => {
        if (!alive) return;
        if (res.ok) setLoaded({ for: userId, data: res.data, state: "ok" });
        else setLoaded({ for: userId, data: null, state: res.reason === "db-setup" ? "db-setup" : "error" });
      });
    return () => {
      alive = false;
    };
  }, [userId, tick]);

  const mine = userId && loaded?.for === userId ? loaded : null;
  const data = mine?.data ?? null;
  const dataState: DataState = !userId ? "idle" : (mine?.state ?? "loading");

  /** 화면 먼저 바꾸고 서버에 반영. 실패하면 서버 값으로 되돌림 */
  const mutate = useCallback(
    (change: (d: MeData) => MeData, url: string, init: RequestInit) => {
      if (!userId) return;
      setLoaded((cur) => (cur?.data ? { ...cur, data: change(cur.data) } : cur));
      fetch(url, init)
        .then((r) => {
          if (!r.ok) reload();
        })
        .catch(reload);
    },
    [userId, reload],
  );

  const uploadScore = useCallback(
    async (s: SavedScore) => {
      if (!userId) return;
      await fetch(
        "/api/me/scores",
        json("POST", { total: s.total, homeless: s.homeless, dependents: s.dependents, account: s.account, baseDate: s.savedAt }),
      ).catch(() => null);
      reload();
    },
    [userId, reload],
  );

  // 로그인한 동안 가점 계산에서 점수를 새로 저장하면 계정에도 기록 (같은 값을 두 번 보내지 않음)
  const lastSent = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    lastSent.current = readMyScoreRaw();
    return subscribeMyScore(() => {
      const raw = readMyScoreRaw();
      const s = parseMyScore(raw);
      if (!s || raw === lastSent.current) return;
      lastSent.current = raw;
      void uploadScore(s);
    });
  }, [userId, uploadScore]);

  // 다른 기기에서 로그인했을 때: 이 브라우저에 점수·거주지가 없으면 계정 값을 받아 둠 (기존 화면들이 그대로 쓰도록)
  useEffect(() => {
    if (!data) return;
    const latest = data.scores[0];
    if (!readMyScoreRaw() && latest) {
      const s: SavedScore = {
        total: latest.total,
        homeless: latest.homeless,
        dependents: latest.dependents,
        account: latest.account,
        savedAt: latest.baseDate ?? latest.calcDate,
      };
      lastSent.current = JSON.stringify(s); // 방금 받은 값을 다시 올리지 않도록
      saveMyScore(s);
    }
    if (!parseMyHome(readMyHomeRaw()).sido && data.home.sido) saveMyHome(data.home);
  }, [data]);

  const value: My = useMemo(
    () => ({
      enabled,
      status,
      userId,
      nickname: data?.nickname ?? user?.name ?? null,
      data,
      dataState,
      login: () => void signIn("kakao"),
      logout: () => void signOut(),
      reload,
      isFavorite: (no) => !!data?.favorites.some((f) => f.no === no),
      toggleFavorite: (f) => {
        const on = !!data?.favorites.some((x) => x.no === f.no);
        if (on) {
          mutate((d) => ({ ...d, favorites: d.favorites.filter((x) => x.no !== f.no) }), `/api/me/favorites?no=${f.no}`, { method: "DELETE" });
        } else {
          mutate((d) => ({ ...d, favorites: [{ ...f, lastVerdict: null }, ...d.favorites] }), "/api/me/favorites", json("POST", f));
        }
      },
      rememberVerdicts: (list) => {
        if (!list.length) return;
        mutate(
          (d) => ({
            ...d,
            favorites: d.favorites.map((f) => {
              const hit = list.find((v) => v.no === f.no);
              return hit ? { ...f, lastVerdict: hit.verdict } : f;
            }),
          }),
          "/api/me/favorites",
          json("PATCH", { verdicts: list }),
        );
      },
      addRecent: (r) =>
        mutate(
          (d) => ({ ...d, recent: [{ ...r, viewedAt: new Date().toISOString() }, ...d.recent.filter((x) => x.no !== r.no)].slice(0, 20) }),
          "/api/me/recent",
          json("POST", r),
        ),
      removeRecent: (no) =>
        mutate(
          (d) => ({ ...d, recent: no ? d.recent.filter((x) => x.no !== no) : [] }),
          no ? `/api/me/recent?no=${no}` : "/api/me/recent",
          { method: "DELETE" },
        ),
      saveCalendar: (items) =>
        mutate(
          (d) => ({
            ...d,
            calendar: [...d.calendar.filter((c) => !items.some((i) => i.no === c.no && i.key === c.key)), ...items],
          }),
          "/api/me/calendar",
          json("POST", { items }),
        ),
      setHome: (sido, unit) => {
        saveMyHome({ sido, unit }); // 다른 화면(가능성 확인 등)도 같은 거주지를 쓰도록 브라우저에도 저장
        mutate((d) => ({ ...d, home: { sido, unit } }), "/api/me", json("PATCH", { sido, unit }));
      },
      uploadScore,
      deleteAll: async () => {
        const r = await fetch("/api/me", { method: "DELETE" }).catch(() => null);
        if (!r?.ok) return false;
        await signOut({ redirectTo: "/" });
        return true;
      },
    }),
    [enabled, status, userId, user?.name, data, dataState, reload, mutate, uploadScore],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
