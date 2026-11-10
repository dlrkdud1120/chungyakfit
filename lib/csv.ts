/**
 * 아주 작은 CSV 읽기 도구
 *
 * 엑셀·구글 시트에서 "CSV UTF-8"로 저장한 파일을 줄·칸 단위로 나눕니다.
 * - 따옴표로 감싼 칸("서울, 강남구"), 칸 안의 줄바꿈, "" (따옴표 이스케이프) 처리
 * - 엑셀이 붙이는 BOM, 윈도우 줄바꿈(\r\n) 처리
 */

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
