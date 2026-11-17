/**
 * 공공분양(LH·GH·SH) 공고의 이미지 출처 (접속 없음. scripts/collect-images.ts가 사용)
 *
 * 공공분양은 단지 분양 홈페이지 대신 기관 사이트 주소가 적혀 있는 경우가 많아,
 * 그 기관의 "해당 공고 페이지"에서 이미지를 찾습니다. 주소와 찾는 방법은 2026-11-17에 실제 사이트를 열어 확인했습니다.
 *
 *  LH  LH청약플러스 분양주택 공고 목록에서 공고를 찾아 열고, "단지조감도" 탭의 이미지를 씀
 *  SH  SH 주택분양 게시판에서 입주자모집공고 글을 찾아 열고, 글에 있는 이미지를 씀 (확인한 글에는 첨부 PDF만 있었음)
 *  GH  분양 공고가 있는 www.gh.or.kr 이 robots.txt로 모든 접근을 막고 있어 열지 않음
 */

export type Agency = {
  key: "LH" | "SH" | "GH";
  site: string; // 출처로 표시할 사이트 이름
  listUrl: string; // 공고 목록 주소 (출처 링크로도 씀)
};

export const AGENCIES: Record<Agency["key"], Agency> = {
  LH: { key: "LH", site: "LH청약플러스", listUrl: "https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancList.do?mi=1027" },
  SH: { key: "SH", site: "SH 서울주택도시개발공사", listUrl: "https://www.i-sh.co.kr/main/lay2/program/S1T294C296/www/brd/m_244/list.do?multi_itm_seq=1" },
  GH: { key: "GH", site: "GH 경기주택도시공사", listUrl: "https://www.gh.or.kr/" },
};

export const PUBLIC_SETTINGS = {
  lhDaysBack: 150, // LH 목록에서 며칠 전 공고까지 볼지
  imageTabLabel: "조감도", // LH 공고 페이지의 이미지 탭 중 이 글자가 든 탭만 씀
  noticeWord: "입주자모집공고", // SH 게시판에서 이 글자가 든 글만 공고 글로 봄
};

/** 청약홈에 적힌 홈페이지 주소가 기관 공용 사이트면 어느 기관인지 */
export function agencyOf(homepage: string | null): Agency | null {
  if (!homepage) return null;
  let host = "";
  try {
    host = new URL(/^https?:\/\//i.test(homepage) ? homepage : `https://${homepage}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "lh.or.kr" || host.endsWith(".lh.or.kr")) return AGENCIES.LH;
  if (host === "i-sh.co.kr" || host.endsWith(".i-sh.co.kr")) return AGENCIES.SH;
  if (host === "gh.or.kr" || host.endsWith(".gh.or.kr")) return AGENCIES.GH;
  return null;
}

/**
 * 공고명에서 "지구 + 블록(또는 단지)"을 뽑아 같은 단지인지 비교할 열쇠를 만듦
 *   "시흥거모지구 S-1블록 공공분양(본청약)"                → "시흥거모|S1"
 *   "[정정공고]시흥거모 S-1블록 공공분양주택 입주자모집공고" → "시흥거모|S1"
 *   "시흥 거모 아테라(시흥거모 A-6BL) 신혼희망타운"         → "시흥거모|A6"
 *   "고덕강일지구 3단지 토지임대부(본청약)"                 → "고덕강일|3단지"
 * 블록을 읽을 수 없으면 null (그 공고는 찾지 않음)
 */
export function complexKey(name: string): string | null {
  const text = name.replace(/\[[^\]]*\]/g, " ");
  const tidy = (district: string) => district.replace(/지구$/, "");
  const block = /([가-힣]+\d*(?:지구)?)\s*\(?\s*([A-Za-z]{1,2})\s*-?\s*0*(\d+)(?:-(\d+))?\s*(?:블록|블럭|BL)/i.exec(text);
  if (block) return `${tidy(block[1])}|${block[2].toUpperCase()}${block[3]}${block[4] ? `-${block[4]}` : ""}`;
  const danji = /([가-힣]+?\d*?)(?:지구)?\s*(\d+)\s*단지/.exec(text);
  if (danji) return `${tidy(danji[1])}|${danji[2]}단지`;
  return null;
}

/** 두 공고명이 같은 지구의 같은 블록(단지)을 가리키는지 */
export function sameComplex(a: string, b: string): boolean {
  const ka = complexKey(a);
  return ka !== null && ka === complexKey(b);
}
