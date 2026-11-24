/**
 * PDF 앞쪽 몇 쪽에서 이미지 꺼내기 (수집 스크립트 전용, 사이트 실행과는 무관)
 *
 * 입주자모집공고문 PDF 앞쪽에 실린 조감도를 찾기 위해 씁니다.
 * pdfjs-dist(개발용 의존성)로 쪽마다 그려지는 이미지 객체를 꺼내 sharp로 JPEG로 바꿉니다.
 * 결과는 메모리에만 두고, 파일로 쓸지는 부르는 쪽(scripts/collect-images.ts)이 정합니다.
 */

import sharp from "sharp";

export type PdfImage = { page: number; width: number; height: number; jpeg: Buffer };

type PdfjsImage = { width: number; height: number; kind?: number; data?: Uint8Array | Uint8ClampedArray };

/** 앞쪽 maxPages쪽 안의 이미지 (가로·세로가 minSide 이상인 것만) */
export async function pdfImages(buf: Buffer, { maxPages = 5, minSide = 300 } = {}): Promise<PdfImage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  const out: PdfImage[] = [];
  try {
    const pages = Math.min(maxPages, doc.numPages);
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const ops = await page.getOperatorList();
      const names = new Set<string>();
      ops.fnArray.forEach((fn, i) => {
        if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
          const name = ops.argsArray[i]?.[0];
          if (typeof name === "string") names.add(name);
        }
      });
      for (const name of names) {
        const img = await new Promise<PdfjsImage | null>((resolve) => {
          const objs = name.startsWith("g_") ? page.commonObjs : page.objs;
          try {
            objs.get(name, (v: PdfjsImage) => resolve(v ?? null));
          } catch {
            resolve(null);
          }
          setTimeout(() => resolve(null), 5000);
        });
        if (!img?.data || img.width < minSide || img.height < minSide) continue;
        // kind 1: 흑백 1비트, 2: RGB, 3: RGBA
        const channels = img.kind === 3 ? 4 : img.kind === 2 ? 3 : 0;
        if (!channels || img.data.length < img.width * img.height * channels) continue;
        const jpeg = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.width * img.height * channels), {
          raw: { width: img.width, height: img.height, channels: channels as 3 | 4 },
        })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 82 })
          .toBuffer();
        out.push({ page: p, width: img.width, height: img.height, jpeg });
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return out;
}
