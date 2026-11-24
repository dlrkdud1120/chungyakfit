/**
 * 대표 이미지 직접 지정 저장 (POST /api/admin/image-override) — 내 컴퓨터(npm run dev)에서만
 *
 * 본문: { name: 단지명, value: "https://이미지주소" | "hide" | null }
 *   주소 → 그 이미지를 1순위로, "hide" → 지도 사용, null → 직접 지정 해제
 * data/image-overrides.json에 바로 씁니다. 배포된 사이트(production)에서는 404이고,
 * 로컬 주소(localhost, 127.0.0.1)에서 온 요청만 받습니다.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "image-overrides.json");

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not Found", { status: 404 });
  const host = new URL(req.url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) return new Response("Forbidden", { status: 403 });

  let body: { name?: unknown; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, reason: "JSON 본문이 필요합니다." }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const value = body.value;
  if (!name || name.length > 120 || name.startsWith("_")) return Response.json({ ok: false, reason: "단지명이 올바르지 않습니다." }, { status: 400 });
  if (!(value === null || value === "hide" || (typeof value === "string" && /^https:\/\/\S+$/.test(value) && value.length < 1000))) {
    return Response.json({ ok: false, reason: "값은 https 이미지 주소, hide, null 중 하나여야 합니다." }, { status: 400 });
  }

  const raw = readFileSync(FILE, "utf8");
  const crlf = raw.includes("\r\n");
  const data = JSON.parse(raw) as Record<string, unknown>;
  // 띄어쓰기만 다른 같은 단지 키가 있으면 그 키를 고침
  const key = Object.keys(data).find((k) => !k.startsWith("_") && k.replace(/\s+/g, "") === name.replace(/\s+/g, "")) ?? name;
  if (value === null) delete data[key];
  else data[key] = value;
  const text = `${JSON.stringify(data, null, 2)}\n`;
  writeFileSync(FILE, crlf ? text.replace(/\n/g, "\r\n") : text, "utf8");
  return Response.json({ ok: true, name: key, value });
}
