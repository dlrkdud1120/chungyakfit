/**
 * 대표 이미지 고르기 (/admin/images) — 내 컴퓨터(npm run dev)에서만 열림
 *
 * 단지마다 지금 쓰이는 이미지와, 수집 때 찾은 상위 후보(최대 6개)를 보여줍니다.
 * 후보를 누르면 data/image-overrides.json에 저장되고(1순위), "지도 사용"은 hide로 저장됩니다.
 * 배포된 사이트(production)에서는 이 화면과 저장 API가 모두 404입니다.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import AdminImages, { type AdminRow } from "@/components/AdminImages";
import { autoItems, autoSkipped } from "@/lib/autoImages";
import { imageKey } from "@/lib/complexImage";
import { loadComplexes } from "@/lib/complexes";
import { resolveImage } from "@/lib/image-resolve";

export const metadata = { title: "이미지 고르기 — 청약핏", robots: { index: false, follow: false } };

type CandidateFile = { byName?: Record<string, { checkedAt?: string; homepage?: string | null; candidates?: { url: string; width: number; height: number; note?: string }[]; review?: boolean; pdf?: string }> };

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export default function AdminImagesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <>
      <header className="mb-6 border-b border-line pb-6">
        <h1 className="text-2xl font-bold text-brand sm:text-3xl">대표 이미지 고르기</h1>
        <p className="mt-2 text-sm text-muted">
          순서: 직접 지정(image-overrides.json) → 직접 넣은 조감도·모집공고 PDF → 자동 수집 → 지도. 후보를 누르면 직접 지정으로 저장돼요. 이 화면은 내 컴퓨터에서만 열려요.
        </p>
      </header>
      <Suspense fallback={<p className="py-6 text-sm text-muted">불러오는 중…</p>}>
        <AdminList />
      </Suspense>
    </>
  );
}

/** 저장할 때마다 새로 읽도록 요청마다 그림 */
async function AdminList() {
  await connection();

  const dir = path.join(process.cwd(), "data");
  const cand = readJson<CandidateFile>(path.join(dir, "image-candidates.json"), {}).byName ?? {};
  const overrides = readJson<Record<string, unknown>>(path.join(dir, "image-overrides.json"), {});
  const { images } = loadComplexes();

  // 단지명 모으기: 후보 목록 + 자동 수집 결과 + 직접 지정 (띄어쓰기 무시하고 한 번씩)
  const names = new Map<string, string>();
  for (const n of [...Object.keys(cand), ...autoItems.map((x) => x.name), ...autoSkipped.map((x) => x.name), ...Object.keys(overrides).filter((k) => !k.startsWith("_"))]) {
    if (!names.has(imageKey(n))) names.set(imageKey(n), n);
  }

  const rows: AdminRow[] = [...names.values()]
    .map((name) => {
      const c = cand[name] ?? Object.entries(cand).find(([k]) => imageKey(k) === imageKey(name))?.[1];
      const r = resolveImage(name);
      return {
        name,
        current: r,
        manual: !!images[imageKey(name)],
        review: r.review || (c?.review === true && (r.kind === "모집공고" || r.kind === "분양 홈페이지" || r.kind === "공공기관")),
        candidates: c?.candidates ?? [],
        homepage: c?.homepage ?? null,
        pdf: c?.pdf ?? null,
        checkedAt: c?.checkedAt ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return <AdminImages rows={rows} />;
}
