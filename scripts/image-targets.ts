/**
 * 대표 이미지가 필요한 단지 목록 (scripts/missing-images.ts, scripts/add-images.ts 공용. 앱 실행과는 무관)
 *
 * 범위는 npm run collect-images와 같습니다: 최근 분양 공고 + 무순위·잔여세대 + 단지 비교에 나오는 지난 공고.
 * 단지명(띄어쓰기 무시)이 같으면 한 번만 셉니다.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type ImageTarget = {
  no: string; // 주택관리번호
  name: string;
  region: string; // "서울 송파구"
  developer: string | null; // 공급기관(사업주체)
  homepage: string | null;
  noticeUrl: string | null; // 청약홈 공고
  group: "분양 공고" | "무순위" | "지난 공고";
};

/** .env.local의 값을 읽어 둠 (Next.js 밖에서 실행하므로 직접 읽음) */
export function loadEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** 청약홈 API로 대상 단지를 모음. 못 받으면 이유를 돌려줌 */
export async function loadImageTargets(): Promise<{ ok: true; targets: ImageTarget[] } | { ok: false; reason: string }> {
  loadEnv();
  const { fetchHistory, fetchNoticeEntries, fetchNotices, fetchRemndrNotices } = await import("../lib/applyhome");
  const { imageKey } = await import("../lib/complexImage");
  const { SIMILAR_RULES } = await import("../lib/similar");
  const res = await fetchNotices();
  if (!res.ok) return { ok: false, reason: res.reason };

  const area = (region: string, unit: string) => `${region} ${unit}`.trim();
  const targets: ImageTarget[] = res.notices.map((n) => ({
    no: n.houseManageNo,
    name: n.name,
    region: area(n.region, n.unit),
    developer: n.developer ?? null,
    homepage: n.homepage,
    noticeUrl: n.url,
    group: "분양 공고",
  }));
  const rem = await fetchRemndrNotices();
  if (!rem.ok) console.log(`!! 무순위 공고를 받지 못했습니다: ${rem.reason}`);
  if (rem.ok) {
    for (const n of rem.notices) {
      targets.push({ no: n.houseManageNo, name: n.name, region: area(n.region, n.unit), developer: n.developer ?? null, homepage: n.homepage ?? null, noticeUrl: n.url, group: "무순위" });
    }
  }
  const hist = await fetchHistory(SIMILAR_RULES.yearsBack);
  if (!hist.ok) console.log(`!! 과거 당첨가점을 받지 못해 지난 공고는 빠집니다: ${hist.reason}`);
  if (hist.ok) {
    // 단지 비교 화면과 같은 기준: 평균 당첨가점이 있는 공고만
    const pastNos = new Set(hist.rows.filter((r) => r.avg !== null).map((r) => r.no));
    const entries = await fetchNoticeEntries(Math.ceil(SIMILAR_RULES.yearsBack * 365.25) + 31).catch((e) => {
      console.log(`!! 지난 공고 목록을 받지 못해 지난 공고는 빠집니다: ${String(e).slice(0, 120)}`);
      return [];
    });
    for (const e of entries) {
      if (pastNos.has(e.houseManageNo)) {
        targets.push({ no: e.houseManageNo, name: e.name, region: area(e.region, e.unit), developer: e.developer ?? null, homepage: e.homepage, noticeUrl: e.url, group: "지난 공고" });
      }
    }
  }
  const seen = new Set<string>();
  return {
    ok: true,
    targets: targets.filter((t) => {
      const k = imageKey(t.name);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
  };
}
