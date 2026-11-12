/**
 * 청약홈 경쟁률 API 응답 확인용 스크립트 (한 번만 쓰는 도구)
 * 실행: 프로젝트 폴더에서  node check-cmpet.mjs
 * 결과는 check-cmpet-result.txt 에 저장됩니다. 키 값은 기록하지 않습니다.
 */
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1";
const out = [];
const log = (...a) => {
  const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2))).join(" ");
  console.log(line);
  out.push(line);
};

let key = "";
try {
  const env = readFileSync(".env.local", "utf8");
  key = (env.match(/^\s*APPLYHOME_API_KEY\s*=\s*(.+)\s*$/m)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
} catch {
  console.log("!! .env.local 파일을 찾지 못했습니다. 프로젝트 폴더에서 실행하세요.");
  process.exit(1);
}
if (!key) {
  console.log("!! .env.local에 APPLYHOME_API_KEY 값이 없습니다.");
  process.exit(1);
}

async function call(op, params = {}) {
  const qs = new URLSearchParams({ page: "1", perPage: "5", ...params });
  const shown = `${op}?${qs}`;
  qs.set("serviceKey", key);
  try {
    const res = await fetch(`${BASE}/${op}?${qs}`, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
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
    log(`전체 개수(totalCount): ${r.body.totalCount ?? "?"} / 조건 맞는 개수(matchCount): ${r.body.matchCount ?? "?"} / 받은 개수: ${data.length}`);
    if (data[0]) log("필드 이름:", Object.keys(data[0]).join(", "));
    log("예시 데이터:", data.slice(0, 5));
  } else {
    log("응답:", r.body);
  }
  return Array.isArray(data) ? data : [];
}

// 1) 경쟁률 기능: 이름 대소문자가 문서마다 달라 둘 다 시도
const a = report("경쟁률 getAPTLttotPblancCmpet", await call("getAPTLttotPblancCmpet"));
const b = report("경쟁률 getAptLttotPblancCmpet", await call("getAptLttotPblancCmpet"));
const op = a.length ? "getAPTLttotPblancCmpet" : b.length ? "getAptLttotPblancCmpet" : null;

// 2) 당첨가점이 있는 공고 번호 하나로, 경쟁률을 공고별로 걸러 받을 수 있는지
const score = report("당첨가점 getAptLttotPblancScore (최근 공고 번호 찾기)", await call("getAptLttotPblancScore", { perPage: "50" }));
const withScore = score.find((s) => s.LWET_SCORE && s.LWET_SCORE !== "-" && s.LWET_SCORE !== "0");
const no = (withScore ?? score[0])?.HOUSE_MANAGE_NO;
if (op && no) {
  report(`경쟁률 ${op} - 주택관리번호 ${no}로 걸러보기`, await call(op, { perPage: "50", "cond[HOUSE_MANAGE_NO::EQ]": String(no) }));
}

writeFileSync("check-cmpet-result.txt", out.join("\n"), "utf8");
console.log("\n→ check-cmpet-result.txt 파일로 저장했습니다. 이 파일을 보내 주세요.");
