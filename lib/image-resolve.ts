/**
 * 단지 대표 이미지 정하기 (서버 전용, 모든 화면 공용)
 *
 * 지도로 찾기·단지 비교·분양 공고·가능성 확인·홈 팝업이 모두 이 함수 하나로 이미지를 정합니다
 * (화면에서는 components/ComplexThumb.tsx가 /api/og-image?name=단지명 으로 물어봄).
 *
 * 순서
 *  1) data/image-overrides.json — 직접 지정한 주소, 또는 "hide"(지도 사용)
 *  2) data/complexes.csv의 조감도 파일 — 직접 넣은 조감도, 입주자모집공고 PDF에서 뽑아 저장한 조감도
 *  3) data/auto-images.json — 분양 홈페이지·공공기관 공고 페이지에서 자동으로 고른 이미지 (review: 확인 필요)
 *  4) 없음 → 화면은 위치 지도
 * 단지명은 띄어쓰기를 무시하고 맞춥니다. 분양 홈페이지에 접속하지 않고, 청약홈 API도 부르지 않습니다.
 */

import { autoImageFor, autoSkippedFor } from "./autoImages";
import { imageFor } from "./complexImage";
import { loadComplexes } from "./complexes";
import { overrideFor } from "./imageOverrides";
import { AGENCIES } from "./public-source";

export type ImageKind = "직접 지정" | "숨김" | "조감도" | "모집공고" | "분양 홈페이지" | "공공기관" | "지도";

export type ResolvedImage = {
  image: string | null; // 화면에 쓸 주소 (없으면 지도)
  kind: ImageKind;
  source: string | null; // 출처로 보여줄 이름 (예: "LH청약플러스", "입주자모집공고(청약홈)")
  homepage: string | null; // 출처 링크
  review: boolean; // 기준을 낮춰 고른 이미지 (확인 필요)
  note?: string; // 지도인 이유 등
};

const AGENCY_SITES = new Set(Object.values(AGENCIES).map((a) => a.site));
export const PDF_SOURCE = "입주자모집공고";

export function resolveImage(name: string): ResolvedImage {
  const over = overrideFor(name);
  if (over) {
    return over.type === "url"
      ? { image: over.url, kind: "직접 지정", source: null, homepage: null, review: false, note: "image-overrides.json" }
      : { image: null, kind: "숨김", source: null, homepage: null, review: false, note: "image-overrides.json에서 지도 사용" };
  }

  const manual = imageFor(loadComplexes().images, name);
  if (manual) {
    const fromPdf = (manual.source ?? "").startsWith(PDF_SOURCE);
    return { image: manual.src, kind: fromPdf ? "모집공고" : "조감도", source: manual.source, homepage: null, review: false };
  }

  const auto = autoImageFor(name);
  if (auto) {
    const isPublic = AGENCY_SITES.has(auto.source ?? "");
    return {
      image: auto.image,
      kind: isPublic ? "공공기관" : "분양 홈페이지",
      source: isPublic ? (auto.source ?? null) : null,
      homepage: auto.homepage,
      review: auto.review === true,
    };
  }

  const skipped = autoSkippedFor(name);
  return { image: null, kind: "지도", source: null, homepage: null, review: false, note: skipped?.reason ?? "아직 모으지 않음 (npm run collect-images)" };
}
