/**
 * 자동으로 고른 단지 대표 이미지 (data/auto-images.json)
 *
 * 이 파일은 우리 컴퓨터에서 `npm run collect-images`(scripts/collect-images.ts)를 실행하면 만들어집니다.
 * 앱은 이 파일을 읽기만 하고, 분양 홈페이지에 접속하지 않습니다.
 * 이미지 파일은 저장하지 않고 주소만 적혀 있습니다.
 */

import raw from "@/data/auto-images.json";
import { imageKey } from "./complexImage";

export type AutoImage = { name: string; image: string; homepage: string; checkedAt: string };
export type AutoSkipped = { name: string; homepage: string | null; reason: string; checkedAt: string };
export type AutoImagesFile = { items: AutoImage[]; skipped: AutoSkipped[] };

const file = raw as unknown as Partial<AutoImagesFile>;
export const autoItems: AutoImage[] = Array.isArray(file.items) ? file.items : [];
export const autoSkipped: AutoSkipped[] = Array.isArray(file.skipped) ? file.skipped : [];

const byName = new Map(autoItems.map((x) => [imageKey(x.name), x]));
const skippedByName = new Map(autoSkipped.map((x) => [imageKey(x.name), x]));

/** 단지명으로 찾기 (띄어쓰기 무시) */
export const autoImageFor = (name: string): AutoImage | null => byName.get(imageKey(name)) ?? null;
export const autoSkippedFor = (name: string): AutoSkipped | null => skippedByName.get(imageKey(name)) ?? null;
