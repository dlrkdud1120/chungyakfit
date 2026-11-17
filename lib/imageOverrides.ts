/**
 * 단지별 이미지 직접 지정 (data/image-overrides.json)
 *   "단지명": "hide"            → 자동 이미지를 쓰지 않고 지도 썸네일
 *   "단지명": "https://…"       → 그 이미지 주소를 사용
 * 단지명은 띄어쓰기를 무시하고 비교합니다. 파일을 고친 뒤 배포하면 바로 적용됩니다(보관해 둔 자동 결과보다 먼저 봄).
 */

import raw from "@/data/image-overrides.json";
import { imageKey } from "./complexImage";

export type ImageOverride = { type: "hide" } | { type: "url"; url: string };

const table = new Map<string, ImageOverride>();
for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
  if (name.startsWith("_") || typeof value !== "string") continue;
  const v = value.trim();
  if (v.toLowerCase() === "hide") table.set(imageKey(name), { type: "hide" });
  else if (/^https?:\/\//i.test(v)) table.set(imageKey(name), { type: "url", url: v });
}

export function overrideFor(name: string): ImageOverride | null {
  return table.get(imageKey(name)) ?? null;
}
