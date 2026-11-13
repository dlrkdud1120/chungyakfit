"use client";

/**
 * 부적격 위험 점검 (가점 계산 결과 아래, /eligibility 페이지 공용)
 *
 * 규칙과 문구는 lib/eligibility-check.ts에 있고, 이 파일은 질문을 받고 결과를 줄로 보여주기만 합니다.
 * 입력값은 이 화면 안에서만 쓰고 저장하지 않습니다. (거주지는 이미 저장해 둔 값이 있으면 처음 값으로만 읽음)
 * calc를 넘기면(가점 계산 화면) 생년월일·혼인·주택 이력·부양가족 수를 다시 묻지 않고 그 값을 씁니다.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useScoreDraft } from "@/components/scoreDraft";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Notice, NoticeResult } from "@/lib/applyhome";
import {
  BOTTOM_NOTICE,
  checkDependents,
  checkHomeless,
  checkHousehold,
  checkReside,
  applyArea,
  REGULATIONS,
  TOP_NOTICE,
  type Answer,
  type CheckResult,
} from "@/lib/eligibility-check";
import { parseMyHome, readMyHomeRaw, subscribeMyHome } from "@/lib/myHome";
import { calcScore, RULES, type HouseHistory } from "@/lib/score";
import { shortSido, SIDO_LIST } from "@/lib/similar";

export type CalcValues = {
  birthDate: string;
  married: boolean;
  marriageDate: string;
  houseHistory: HouseHistory;
  soldDate: string;
  dependentsCount: number | null;
};

type NoticeState = { status: "loading" } | { status: "ok"; list: Notice[] } | { status: "fail" };

export default function EligibilityCheck({ calc }: { calc?: CalcValues }) {
  const params = useSearchParams();

  // ── 가점 계산에서 받지 못했을 때만 직접 묻는 값
  const [birthDate, setBirthDate] = useState("");
  const [married, setMarried] = useState(false);
  const [marriageDate, setMarriageDate] = useState("");
  const [houseHistory, setHouseHistory] = useState<HouseHistory>("never");
  const [soldDate, setSoldDate] = useState("");
  const [depCount, setDepCount] = useState("");
  // 가점 계산에 넣어 둔 값이 이 브라우저 탭에 남아 있으면 다시 묻지 않고 그 값을 씀 (저장·전송하지 않음)
  const [draft, , hasDraft] = useScoreDraft();
  const [today] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()));
  const fromDraft: CalcValues | undefined = useMemo(() => {
    if (calc || !hasDraft || !draft.birthDate) return undefined;
    const r = calcScore({ ...draft, baseDate: draft.baseDate ?? today });
    return {
      birthDate: draft.birthDate,
      married: draft.married,
      marriageDate: draft.marriageDate,
      houseHistory: draft.houseHistory,
      soldDate: draft.soldDate,
      dependentsCount: r.errors.length ? null : Math.round((r.dependents.score - RULES.dependents.base) / RULES.dependents.perPerson),
    };
  }, [calc, hasDraft, draft, today]);
  const given = calc ?? fromDraft;
  const v: CalcValues = given ?? {
    birthDate,
    married,
    marriageDate,
    houseHistory,
    soldDate,
    dependentsCount: depCount === "" ? null : Math.max(0, Math.floor(Number(depCount))),
  };

  // ── 점검 질문
  const [myStart, setMyStart] = useState("");
  const [spouse, setSpouse] = useState<Answer>("");
  const [family, setFamily] = useState<Answer>("");
  const [meetsPeriod, setMeetsPeriod] = useState<Answer>("");
  const [selfExcluded, setSelfExcluded] = useState(false);

  // 거주지: 저장해 둔 값을 처음 값으로만 쓰고, 여기서 바꾼 값은 저장하지 않음
  const savedHomeRaw = useSyncExternalStore(subscribeMyHome, readMyHomeRaw, () => null);
  const savedHome = useMemo(() => parseMyHome(savedHomeRaw), [savedHomeRaw]);
  const [homeEdit, setHomeEdit] = useState<{ sido: string; unit: string } | null>(null);
  const home = homeEdit ?? savedHome;

  // 공고 목록 (/api/notices). 주소에 ?no=주택관리번호가 있으면 그 공고를 고른 상태로 시작
  const [notices, setNotices] = useState<NoticeState>({ status: "loading" });
  const [noticeNo, setNoticeNo] = useState(params.get("no") ?? "");
  useEffect(() => {
    let alive = true;
    fetch("/api/notices")
      .then((r) => r.json() as Promise<NoticeResult>)
      .catch((): NoticeResult => ({ ok: false, reason: "" }))
      .then((res) => {
        if (alive) setNotices(res.ok ? { status: "ok", list: res.notices } : { status: "fail" });
      });
    return () => {
      alive = false;
    };
  }, []);
  const notice = notices.status === "ok" ? (notices.list.find((n) => n.houseManageNo === noticeNo) ?? null) : null;
  const target = notice ? { sido: shortSido(notice.region), unit: notice.unit, name: notice.name } : null;
  const area = target && home.sido ? applyArea(home, target, notice?.regulations ?? null) : null;

  const results: CheckResult[] = [
    checkHomeless({ ...v, myStart }),
    checkHousehold({ married: v.married, spouse, family }),
    checkReside({ home, notice: target, flags: notice?.regulations ?? null, meetsPeriod }),
    checkDependents({ count: v.dependentsCount, selfExcluded }),
  ];
  const recheck = results.filter((r) => r.status === "recheck").length;

  return (
    <section className={calc ? "mt-14" : ""} id="eligibility">
      {/* 따로 연 페이지(/eligibility)는 맨 위 제목이 같아서 이 제목을 생략 */}
      {calc && <h2 className="border-b-2 border-brand pb-2 text-sm font-semibold text-brand">부적격 위험 점검</h2>}
      <p className="flex items-start gap-1.5 border-b border-line py-3 text-sm">
        <Icon status="recheck" />
        {TOP_NOTICE} 당첨 취소가 자주 나는 실수 네 가지를 질문으로 점검해요. 입력값은 저장하지 않아요.
      </p>

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
        {/* ───────── 질문 ───────── */}
        <div>
          {!given && (
            <Group title="기본 정보">
              <Row label="생년월일">
                <DateInput value={birthDate} onChange={setBirthDate} />
              </Row>
              <Row label="혼인 여부">
                <Segment value={married ? "y" : "n"} options={[["n", "미혼"], ["y", "기혼"]]} onChange={(x) => setMarried(x === "y")} />
              </Row>
              {married && (
                <Row label="혼인신고일" hint="만 30세 전이면 이날부터 셈">
                  <DateInput value={marriageDate} onChange={setMarriageDate} />
                </Row>
              )}
              <Row label="과거 주택 소유·처분" hint="본인·배우자">
                <Segment
                  value={houseHistory}
                  options={[["never", "없음"], ["sold", "있었지만 처분"], ["owning", "현재 소유"]]}
                  onChange={(x) => setHouseHistory(x as HouseHistory)}
                />
              </Row>
              {houseHistory === "sold" && (
                <Row label="마지막 처분일">
                  <DateInput value={soldDate} onChange={setSoldDate} />
                </Row>
              )}
              <Row label="신청할 부양가족 수">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={depCount}
                  onChange={(e) => setDepCount(e.target.value)}
                  className="w-20 rounded border border-line bg-white px-2 py-1.5 text-right text-sm tabular-nums focus:border-brand focus:outline-none"
                />
              </Row>
            </Group>
          )}
          {given && (
            <p className="border-b border-line py-3 text-[13px] text-muted">
              생년월일, 혼인, 주택 소유 이력, 부양가족 수는 가점 계산에 넣은 값을 씁니다.{" "}
              <Link href="/score" className="text-brand underline">
                입력 고치기
              </Link>
            </p>
          )}

          <Group title="1. 무주택기간">
            <Row label="내가 생각한 무주택 기산일" hint="모르면 비워 두세요">
              <DateInput value={myStart} onChange={setMyStart} />
            </Row>
          </Group>

          <Group title="2. 세대원 주택 소유">
            {v.married && (
              <Row label="배우자 주택·분양권" hint="세대가 따로여도 포함">
                <Segment value={spouse} options={YNU} onChange={(x) => setSpouse(x as Answer)} />
              </Row>
            )}
            <Row label="같은 세대 직계존비속 주택·분양권" hint="부모·자녀 등">
              <Segment value={family} options={YNU} onChange={(x) => setFamily(x as Answer)} />
            </Row>
          </Group>

          <Group title="3. 거주지역">
            <Row label="내 거주지">
              <div className="flex gap-2">
                <select
                  value={home.sido}
                  onChange={(e) => setHomeEdit({ ...home, sido: e.target.value })}
                  className="rounded border border-line bg-white px-2 py-1.5 text-sm"
                >
                  <option value="">시·도</option>
                  {SIDO_LIST.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <input
                  value={home.unit}
                  onChange={(e) => setHomeEdit({ ...home, unit: e.target.value })}
                  placeholder={home.sido === "서울" ? "예: 강남구" : "예: 수원시"}
                  className="w-28 rounded border border-line bg-white px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                />
              </div>
            </Row>
            <Row label="신청할 공고">
              <select
                value={noticeNo}
                onChange={(e) => {
                  setNoticeNo(e.target.value);
                  setMeetsPeriod("");
                }}
                disabled={notices.status !== "ok"}
                className="w-full rounded border border-line bg-white px-2 py-1.5 text-sm sm:w-64"
              >
                <option value="">
                  {notices.status === "loading" ? "공고 불러오는 중…" : notices.status === "fail" ? "공고를 불러오지 못했어요" : "공고 고르기 (선택)"}
                </option>
                {notices.status === "ok" &&
                  notices.list.map((n) => (
                    <option key={n.houseManageNo} value={n.houseManageNo}>
                      {n.name} ({n.region} {n.unit})
                    </option>
                  ))}
              </select>
            </Row>
            {(area === "해당지역" || area === "기타경기") && (
              <Row label="공고문의 거주기간 요건" hint={`${area} 신청 시`}>
                <Segment
                  value={meetsPeriod}
                  options={[["yes", "채움·요건 없음"], ["no", "못 채움"], ["unknown", "모름"]]}
                  onChange={(x) => setMeetsPeriod(x as Answer)}
                />
              </Row>
            )}
          </Group>

          <Group title="4. 부양가족">
            <div className="border-b border-line py-3">
              <label className="inline-flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selfExcluded}
                  onChange={(e) => setSelfExcluded(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#1f4e46]"
                />
                <span>
                  부양가족 수{v.dependentsCount !== null && ` ${v.dependentsCount >= 6 ? "6명 이상" : `${v.dependentsCount}명`}`}에 본인을 넣지 않았어요
                </span>
              </label>
            </div>
          </Group>
        </div>

        {/* ───────── 결과 ───────── */}
        <div>
          <h3 className="flex items-baseline justify-between border-b-2 border-brand pb-2 text-sm font-semibold text-brand">
            점검 결과
            <span className="text-xs font-normal text-muted">
              {recheck === 0 ? "모두 확인됨" : `다시 확인 필요 ${recheck}개`}
            </span>
          </h3>
          <table className="w-full text-sm">
            <tbody>
              {results.map((r) => (
                <tr key={r.id} className="border-b border-line align-top">
                  <td className="w-5 py-3 pr-2">
                    <Icon status={r.status} />
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-medium">{r.title}</span>
                      <span className={`text-xs ${r.status === "ok" ? "text-ok" : "text-accent-dark"}`}>
                        {r.status === "ok" ? "확인됨" : "다시 확인 필요"}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[13px] text-muted">{r.summary}</div>
                    {r.status === "recheck" && (
                      <div className="mt-1.5 space-y-0.5 text-[13px] leading-relaxed">
                        {r.reason && <p>{r.reason}</p>}
                        {r.how && <p className="text-muted">확인 방법: {r.how}</p>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {notice && <Regulations notice={notice} />}
        </div>
      </div>

      <p className="mt-6 border-t border-line pt-3 text-xs text-muted">{BOTTOM_NOTICE}</p>
    </section>
  );
}

const YNU: [string, string][] = [
  ["no", "없음"],
  ["yes", "있음"],
  ["unknown", "모름"],
];

/** 고른 공고의 규제 조건을 쉬운 말로 (분양정보 API 값) */
function Regulations({ notice }: { notice: Notice }) {
  const flags = notice.regulations;
  const on = flags ? REGULATIONS.filter((r) => flags[r.name] === true) : [];
  const off = flags ? REGULATIONS.filter((r) => flags[r.name] === false) : [];
  return (
    <>
      <h3 className="mt-8 border-b-2 border-brand pb-2 text-sm font-semibold text-brand">이 공고의 규제 조건</h3>
      {!flags ? (
        <p className="border-b border-line py-3 text-[13px] text-muted">
          청약홈 분양정보에 규제 조건 값이 없어요. 입주자모집공고문의 &lsquo;단지 주요정보&rsquo;에서 확인하세요.
        </p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {on.map((r) => (
              <tr key={r.code} className="border-b border-line align-top">
                <td className="w-32 py-2.5 pr-3 font-medium whitespace-nowrap">{r.name}</td>
                <td className="py-2.5 text-[13px] leading-relaxed">{r.plain}</td>
              </tr>
            ))}
            {on.length === 0 && (
              <tr className="border-b border-line">
                <td className="py-2.5 text-[13px]" colSpan={2}>
                  규제지역·분양가상한제 등 해당하는 항목이 없어요.
                </td>
              </tr>
            )}
            {off.length > 0 && (
              <tr className="border-b border-line align-top">
                <td className="py-2.5 pr-3 text-muted">해당 없음</td>
                <td className="py-2.5 text-[13px] text-muted">{off.map((r) => r.name).join(", ")}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <p className="mt-1 text-xs text-muted">출처: 한국부동산원 청약홈 분양정보 API ({notice.noticeDate ?? "공고일 없음"} 공고)</p>
    </>
  );
}

// ───────────────────────── 작은 부품들 ─────────────────────────

/** 확인됨: 초록 체크, 다시 확인: 주황 느낌표 (작은 아이콘만) */
function Icon({ status }: { status: "ok" | "recheck" }) {
  return status === "ok" ? (
    <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-label="확인됨" role="img">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.8 8.2 7 10.3l4.2-4.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-label="다시 확인 필요" role="img">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.3v4.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="8" cy="11.4" r="0.95" fill="currentColor" />
    </svg>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <h3 className="border-b border-line pt-2 pb-1.5 text-xs font-semibold text-brand">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-line py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        {label}
        {hint && <span className="ml-2 text-xs text-muted">{hint}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-line bg-white px-3 py-1.5 text-sm tabular-nums focus:border-brand focus:outline-none sm:w-44"
    />
  );
}

function Segment({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-line text-sm">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`border-l border-line px-3 py-1.5 first:border-l-0 ${value === v ? "bg-brand text-white" : "bg-white text-ink hover:bg-brand/5"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
