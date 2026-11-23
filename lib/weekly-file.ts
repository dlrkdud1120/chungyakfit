/**
 * 주차별 파일 읽기 (data/weekly/*.json, 서버·빌드 전용)
 *
 * 홈 화면(app/page.tsx)이 배포할 때 읽어서 팝업에 넘깁니다. 매주 자동 PR을 병합하면 다시 배포되면서 새 파일이 반영됩니다.
 * 이번 주 파일인지는 화면에서 한국시간 날짜로 고릅니다(lib/weekly-cards.ts의 pickWeeklyFile). 맞는 파일이 없으면 팝업이 API를 직접 부릅니다.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { WeeklyFile } from "./weekly-cards";

const DIR = path.join(process.cwd(), "data", "weekly");
// 가장 최근 파일 하나만 넘김 (화면에 실리는 양을 줄이기 위해).
// 월요일 자동 PR을 병합해 배포하면 이것이 이번 주 파일이고, 병합 전에는 주차가 맞지 않아 팝업이 API를 직접 부름
const KEEP = 1;

export function loadWeeklyFiles(): WeeklyFile[] {
  if (!existsSync(DIR)) return [];
  const names = readdirSync(DIR)
    .filter((f) => /^\d{4}-W\d{2}\.json$/.test(f))
    .sort()
    .slice(-KEEP);
  const files: WeeklyFile[] = [];
  for (const name of names) {
    try {
      const f = JSON.parse(readFileSync(path.join(DIR, name), "utf8")) as WeeklyFile;
      if (f.start && Array.isArray(f.notices)) files.push(f);
    } catch {
      // 깨진 파일은 건너뜀 → 팝업이 API를 직접 부름
    }
  }
  return files;
}
