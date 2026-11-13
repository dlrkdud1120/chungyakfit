/**
 * 아이콘 PNG 만들기 (한 번만 쓰는 도구. 앱 실행과는 무관)
 * 실행: 프로젝트 폴더에서  node scripts/make-icons.mjs
 * 원본 public/icons/icon.svg 를 크기만 바꿔 PNG로 저장합니다. 모양과 색은 그대로입니다.
 * sharp는 Next.js에 함께 설치되는 패키지를 씁니다 (package.json에 따로 추가하지 않음).
 */
import { readFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync("public/icons/icon.svg");
const targets = [
  [180, "app/apple-icon.png"], // 아이폰 홈 화면
  [192, "public/icons/icon-192.png"], // 안드로이드 홈 화면
  [512, "public/icons/icon-512.png"],
];
for (const [size, file] of targets) {
  let img = sharp(svg, { density: ((72 * size) / 100) * 4 }).resize(size, size);
  // 아이폰은 투명한 모서리를 검게 칠하고 스스로 둥글게 깎으므로, 아이폰용만 모서리 바깥을 같은 초록으로 채움
  if (file.includes("apple")) img = img.flatten({ background: "#1F4E46" });
  await img.png().toFile(file);
  console.log(`${file} (${size}×${size})`);
}
