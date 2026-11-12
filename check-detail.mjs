/**
 * 청약홈 분양정보(getAPTLttotPblancDetail) 응답의 규제 조건 필드 확인용 스크립트 (한 번만 쓰는 도구)
 * 실행: 프로젝트 폴더에서  node check-detail.mjs
 * 결과는 check-detail-result.txt 에 저장됩니다. 키 값은 기록하지 않습니다.
 * lib/eligibility-check.ts의 REGULATIONS에 적은 필드 이름이 실제 응답에 있는지 봅니다.
 */
import { readFileSync, writeFileSync } from "node:fs";

const URL_ = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail";
const EXPECT = [
  "SPECLT_RDN_EARTH_AT",
  "MDAT_TRGET_AREA_SECD",
  "PARCPRC_ULS_AT",
  "IMPRMN_BSNS_AT",
  "PUBLIC_HOUSE_EARTH_AT",
  "LRSCL_BLDLND_AT",
  "NPLN_PRVOPR_PUBLIC_HOUSE_AT",
];
const out = [];
const log = (s) => (console.log(s), out.push(s));

let key = "";
try {
  key = (readFileSync(".env.local", "utf8").match(/^\s*APPLYHOME_API_KEY\s*=\s*(.+)\s*$/m)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
} catch {
  console.log("!! .env.local 파일을 찾지 못했습니다. 프로젝트 폴더에서 실행하세요.");
  process.exit(1);
}
if (!key) (console.log("!! .env.local에 APPLYHOME_API_KEY 값이 없습니다."), process.exit(1));

const qs = new URLSearchParams({ page: "1", perPage: "30", serviceKey: key });
const res = await fetch(`${URL_}?${qs}`, { signal: AbortSignal.timeout(15000) }).catch((e) => ({ error: String(e) }));
if (res.error) (log(`연결 실패: ${res.error}`), writeFileSync("check-detail-result.txt", out.join("\n")), process.exit(1));
const body = await res.json().catch(() => ({}));
const data = Array.isArray(body.data) ? body.data : [];
log(`HTTP 상태: ${res.status} / 받은 개수: ${data.length}`);
if (!data[0]) (log(`응답: ${JSON.stringify(body).slice(0, 300)}`), writeFileSync("check-detail-result.txt", out.join("\n")), process.exit(1));

const fields = Object.keys(data[0]);
log(`\n전체 필드 이름:\n${fields.join(", ")}`);
log("\n규제 조건 후보 필드가 실제로 있는지 (값 종류):");
for (const f of EXPECT) {
  const vals = [...new Set(data.map((d) => d[f]))].join(" / ");
  log(`  ${f}: ${fields.includes(f) ? `있음 (${vals})` : "없음"}`);
}
log("\nY/N 한 글자 값이 들어 있는 필드 전체:");
for (const f of fields) {
  const vals = [...new Set(data.map((d) => d[f]))];
  if (vals.every((v) => v === "Y" || v === "N" || v === null || v === "")) log(`  ${f}: ${vals.join(" / ")}`);
}
log("\n예시 1건:");
log(JSON.stringify(data[0], null, 2));
writeFileSync("check-detail-result.txt", out.join("\n"), "utf8");
console.log("\n→ check-detail-result.txt 파일로 저장했습니다. 이 파일을 보내 주세요.");
