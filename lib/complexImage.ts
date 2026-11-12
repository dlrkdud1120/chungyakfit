/**
 * 조감도 이미지 연결 (화면·서버 공용, 파일 읽기 없음)
 *
 * complexes.csv의 "조감도 파일명", "이미지 출처" 열에 적은 이미지를
 * 단지명(띄어쓰기 무시)이 같은 단지에 붙입니다. 이미지 파일은 public/images/complexes/ 에 넣습니다.
 */

export type ComplexImage = { src: string; source: string | null };
export type ComplexImages = Record<string, ComplexImage>;

export const IMAGE_DIR = "/images/complexes";

export function imageKey(name: string): string {
  return name.replace(/\s+/g, "");
}

export function imageFor(images: ComplexImages | undefined, name: string): ComplexImage | null {
  return images?.[imageKey(name)] ?? null;
}
