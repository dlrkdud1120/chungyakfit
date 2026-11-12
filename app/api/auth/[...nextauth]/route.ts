/** 카카오 로그인·로그아웃이 오가는 주소 (/api/auth/…). 설정은 lib/auth.ts */
import { authConfigured, handlers } from "@/lib/auth";

// 로그인 환경변수를 아직 안 넣었으면 "로그인 안 됨"으로만 답해서, 나머지 화면이 오류 없이 동작하게 함
const notReady = () => Response.json(null, { headers: { "Cache-Control": "no-store" } });

export const GET: typeof handlers.GET = (req) => (authConfigured ? handlers.GET(req) : Promise.resolve(notReady()));
export const POST: typeof handlers.POST = (req) => (authConfigured ? handlers.POST(req) : Promise.resolve(notReady()));
