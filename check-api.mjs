/**
 * 청약홈 API 응답 확인용 스크립트 (한 번만 쓰는 도구)
 *
 * 실행: 프로젝트 폴더에서  node check-api.mjs
 * - .env.local의 APPLYHOME_API_KEY를 읽어 청약홈 API 몇 곳을 조금씩 불러봅니다.
 * - 결과는 check-result.txt 파일에 저장됩니다. 키는 파일에 쓰지 않습니다.
 */

import { readFileSync, writeFileSync } from "node:fs";

const BASE = "https://api.odcloud.kr/api";
const out = [];
const log = (...a) => {
  const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2))).join(" ");
  console.log(line);
  out.push(line);
};

// 1) 키 읽기
let key = "";
try {
  const env = readFileSync(".env.local", "utf8");
  key = (env.match(/^\s*APPLYHOME_API_KEY\s*=\s*(.+)\s*$/m)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
} catch {
  log("!! .env.local 파일을 찾지 못했습니다. package.json이 있는 폴더에서 실행했는지 확인하세요.");
  process.exit(1);
}
if (!key) {
  log("!! .env.local에 APPLYHOME_API_KEY 값이 없습니다.");
  process.exit(1);
}
log(`키 길이: ${key.length}자 (키 값은 기록하지 않음)`);

async function call(path, params = {}) {
  const qs = new URLSearchParams({ page: "1", perPage: "3", ...params });
  const shown = `${path}?${qs}`; // 키 없이 기록
  qs.set("serviceKey", key);
  try {
    const res = await fetch(`${BASE}/${path}?${qs}`, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 300);
    }
    return { shown, status: res.status, body };
  } catch (e) {
    return { shown, status: "연결 실패", body: String(e) };
  }
}

function report(title, r) {
  log(`\n===== ${title} =====`);
  log(`요청: ${r.shown}`);
  log(`HTTP 상태: ${r.status}`);
  const data = r.body?.data;
  if (Array.isArray(data)) {
    log(`전체 개수(totalCount): ${r.body.totalCount ?? "?"} / 받은 개수: ${data.length}`);
    if (data[0]) log("필드 이름:", Object.keys(data[0]).join(", "));
    log("예시 데이터:", data.slice(0, 3));
  } else {
    log("응답:", r.body);
  }
  return Array.isArray(data) ? data : [];
}

// 2) 분양정보: 최근 공고 하나의 주택관리번호 얻기
const recent = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
const detail = report(
  "분양정보 getAPTLttotPblancDetail (최근 1년)",
  await call("ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail", { "cond[RCRIT_PBLANC_DE::GTE]": recent }),
);
const sampleNo = detail.find((d) => d.HOUSE_MANAGE_NO)?.HOUSE_MANAGE_NO;

// 3) 당첨가점: 이름 대소문자가 문서마다 달라 둘 다 시도
const s1 = report("당첨가점 getAptLttotPblancScore", await call("ApplyhomeInfoCmpetRtSvc/v1/getAptLttotPblancScore"));
const s2 = report("당첨가점 getAPTLttotPblancScore", await call("ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancScore"));
const scoreOp = s1.length ? "getAptLttotPblancScore" : s2.length ? "getAPTLttotPblancScore" : null;

// 4) 특정 공고로 걸러지는지 확인
if (scoreOp && sampleNo) {
  report(
    `당첨가점 ${scoreOp} — 주택관리번호 ${sampleNo}로 걸러보기`,
    await call(`ApplyhomeInfoCmpetRtSvc/v1/${scoreOp}`, { perPage: "10", "cond[HOUSE_MANAGE_NO::EQ]": String(sampleNo) }),
  );
}

// 5) 주택형별 정보가 공고일 조건으로 걸러지는지 (6단계에서 확인 못 한 부분)
report(
  "주택형별 getAPTLttotPblancMdl (공고일 조건)",
  await call("ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl", { "cond[RCRIT_PBLANC_DE::GTE]": recent }),
);

writeFileSync("check-result.txt", out.join("\n"), "utf8");
console.log("\n→ check-result.txt 파일로 저장했습니다. 이 파일을 보내 주세요.");
