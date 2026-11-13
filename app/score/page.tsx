import { Suspense } from "react";
import Calculator from "@/components/Calculator";
import Fold from "@/components/Fold";
import { loadComplexes } from "@/lib/complexes";
import { RULES, TOTAL_MAX } from "@/lib/score";

export const metadata = { title: "가점 계산 — 청약핏" };

export default function ScorePage() {
  // 평균 당첨 가점 비교는 화면에서 청약홈 API로 하고, 실패할 때 쓸 CSV만 넘깁니다
  const fallback = loadComplexes().complexes;

  return (
    <>
      <header className="mb-8 border-b border-line pb-6">
        <h1 className="text-2xl font-bold text-brand sm:text-3xl">청약 가점 계산기</h1>
        <p className="mt-2 text-sm text-muted">
          질문에 차례로 답하면 무주택기간, 부양가족, 청약통장 세 항목으로 가점을 계산합니다.
        </p>
      </header>

      {/* 계산기는 '오늘 날짜'를 쓰므로 방문할 때마다 새로 그립니다 */}
      <Suspense fallback={<p className="py-10 text-sm text-muted">계산기를 불러오는 중…</p>}>
        <Calculator fallback={fallback} />
      </Suspense>

      {/* 만점과 계산 방법은 접어 두고, 눌렀을 때만 펼침 */}
      <Fold label="가점 계산 기준 보기" className="mt-10 max-w-xl">
        <ScoreCriteria />
      </Fold>
    </>
  );
}

/** 가점 계산 기준 — 만점 정보는 이 표에만 둡니다. 숫자는 lib/score.ts의 RULES에서 가져옵니다. */
function ScoreCriteria() {
  const H = RULES.homeless;
  const D = RULES.dependents;
  const A = RULES.account;
  const rows: [string, number, string][] = [
    [
      "무주택기간",
      H.max,
      `만 ${H.startAge}세가 되는 날과 혼인신고일 중 빠른 날부터 셉니다. 1년 미만 ${H.base}점, 이후 1년마다 ${H.perYear}점씩 더해 15년 이상이면 ${H.max}점.`,
    ],
    [
      "부양가족 수",
      D.max,
      `본인은 빼고 셉니다. 0명 ${D.base}점, 1명마다 ${D.perPerson}점씩 더해 6명 이상이면 ${D.max}점. 직계존속은 ${D.parentSameHouseholdYears}년 이상 같은 주민등록 세대여야 인정됩니다.`,
    ],
    [
      "청약통장 가입기간",
      A.max,
      `6개월 미만 ${A.under6Months}점, 6개월~1년 미만 ${A.under1Year}점, 이후 1년마다 ${A.perYear}점씩 더해 15년 이상이면 ${A.max}점. 배우자 통장은 기간 점수의 ${A.spouseRatio * 100}%를 최대 ${A.spouseMax}점까지 더합니다.`,
    ],
  ];

  return (
    <section>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th className="py-2 text-left font-normal">항목</th>
            <th className="py-2 text-right font-normal">만점</th>
            <th className="py-2 pl-4 text-left font-normal">계산 방법</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, max, how]) => (
            <tr key={name} className="border-b border-line align-top">
              <td className="w-24 py-2.5 pr-3 sm:w-auto">{name}</td>
              <td className="py-2.5 text-right whitespace-nowrap tabular-nums">{max}점</td>
              <td className="py-2.5 pl-4 text-[13px] leading-relaxed text-muted">{how}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-brand">
            <td className="py-2.5 font-semibold">합계</td>
            <td className="py-2.5 text-right font-semibold tabular-nums">{TOTAL_MAX}점</td>
            <td />
          </tr>
        </tbody>
      </table>
    </section>
  );
}
