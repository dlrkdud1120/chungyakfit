/**
 * 카카오 로그인 설정 (Auth.js = NextAuth v5, 서버에서만 사용)
 *
 * - 동의 항목은 닉네임(profile_nickname)만 요청합니다. 이메일·프로필 사진은 받지 않습니다.
 * - 로그인 정보는 암호화된 쿠키(JWT)에만 담고, 쿠키에는 카카오 회원번호와 닉네임만 들어갑니다.
 * - 환경변수: AUTH_SECRET, AUTH_KAKAO_ID(REST API 키. 없으면 KAKAO_REST_KEY를 씀), AUTH_KAKAO_SECRET(Client Secret)
 */

import NextAuth from "next-auth";
import Kakao from "next-auth/providers/kakao";

const kakaoId = process.env.AUTH_KAKAO_ID ?? process.env.KAKAO_REST_KEY;

/** 로그인에 필요한 환경변수가 다 있는지 */
export const authConfigured = !!(process.env.AUTH_SECRET && kakaoId && process.env.AUTH_KAKAO_SECRET);

type KakaoProfile = { id: number | string; kakao_account?: { profile?: { nickname?: string } }; properties?: { nickname?: string } };

export const { handlers, auth } = NextAuth({
  providers: [
    Kakao({
      clientId: kakaoId,
      clientSecret: process.env.AUTH_KAKAO_SECRET,
      authorization: { url: "https://kauth.kakao.com/oauth/authorize", params: { scope: "profile_nickname" } },
      // 카카오가 준 정보 중 회원번호와 닉네임만 꺼냄
      profile(p: KakaoProfile) {
        return { id: String(p.id), name: p.kakao_account?.profile?.nickname ?? p.properties?.nickname ?? "사용자" };
      },
    }),
  ],
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
    jwt({ token, account }) {
      if (account) token.sub = account.providerAccountId; // 카카오 회원번호
      delete token.email;
      delete token.picture;
      return token;
    },
    session({ session, token }) {
      return { expires: session.expires, user: { id: token.sub ?? "", name: token.name ?? "사용자" } } as typeof session;
    },
  },
});

export type Me = { id: string; name: string };

/** 지금 로그인한 사람 (없거나 설정 전이면 null) */
export async function currentUser(): Promise<Me | null> {
  if (!authConfigured) return null;
  try {
    const s = await auth();
    const u = s?.user as { id?: string; name?: string | null } | undefined;
    return u?.id ? { id: u.id, name: u.name ?? "사용자" } : null;
  } catch {
    return null;
  }
}
