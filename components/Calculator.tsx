"use client";

/**
 * 가점 계산기 화면 — 한 화면에 한 질문씩 (주소의 ?step= 으로 단계가 정해짐)
 *   1 생년월일·혼인 → 2 주택 소유 이력 → 3 부양가족 → 4 청약통장 → 5 결과
 * 계산은 전부 lib/score.ts가 하고, 이 파일은 입력을 모아 넘기고 결과를 보여주기만 합니다.
 * 입력값은 components/scoreDraft.ts가 이 브라우저 탭 안에만 보관해서, 다른 메뉴에 갔다 와도 남아 있습니다.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Fold from "@/components/Fold";
import { useScoreDraft } from "@/components/scoreDraft";
import { saveMyScore } from "@/lib/myScore";
import { averageCutoff, gapText } from "@/lib/benchmark";
import type { Complex } from "@/lib/complexes";
import { growthStage } from "@/lib/growth";
import { useComplexes } from "@/lib/useComplexes";
import {
  calcScore,
  fmt,
  FUTURE_ASSUMPTIONS,
  projectScores,
  type Child,
  type FutureScore,
  type ScoreInput,
  type HouseHistory,
  type ItemResult,
  type Parent,
  type ParentRelation,
} from "@/lib/score";

// 한국 시간 기준 오늘 날짜 ("YYYY-MM-DD")
function todayKST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const STEPS = ["생년월일·혼인", "주택 소유 이력", "부양가족", "청약통장"];
const RESULT = STEPS.length + 1; // 5

/** fallback: 청약홈 API가 실패할 때 평균 당첨 가점 비교에 쓸 complexes.csv 단지 */
export default function Calculator({ fallback }: { fallback: Complex[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const step = Math.min(Math.max(Math.floor(Number(params.get("step")) || 1), 1), RESULT);
  const go = (n: number) => router.push(n <= 1 ? "/score" : `/score?step=${n}`);

  // 넘어가는 방향(다음/이전)에 따라 밀려 들어오는 쪽을 정함
  const [shown, setShown] = useState(step);
  const [dir, setDir] = useState<"next" | "prev">("next");
  if (shown !== step) {
    setDir(step > shown ? "next" : "prev");
    setShown(step);
  }

  // 내 점수와 비교할 평균 당첨 가점 (청약홈 과거 당첨가점, 실패하면 CSV)
  const cs = useComplexes(fallback);
  const benchmark = useMemo(() => averageCutoff(cs.complexes.flatMap((c) => c.types)), [cs.complexes]);
  const benchLabel = cs.source === "api" && cs.scope ? cs.scope : "관심 단지";

  const [d, set] = useScoreDraft();
  const [today] = useState(todayKST);
  const input: ScoreInput = useMemo(() => ({ ...d, baseDate: d.baseDate ?? today }), [d, today]);
  const { baseDate, birthDate, married, marriageDate, houseHistory, soldDate, children, parents, hasAccount, accountJoinDate, spouseHasAccount, spouseAccountJoinDate } = input;
  const result = useMemo(() => calcScore(input), [input]);
  const future = useMemo(() => projectScores(input), [input]);

  const updateChild = (i: number, patch: Partial<Child>) => set({ children: children.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const updateParent = (i: number, patch: Partial<Parent>) => set({ parents: parents.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  // 이 단계에서 꼭 넣어야 하는 값이 비었는지
  const missing: string | null =
    step === 1
      ? !isDate(birthDate)
        ? "생년월일을 넣어 주세요."
        : married && !isDate(marriageDate)
          ? "혼인신고일을 넣어 주세요."
          : null
      : step === 2
        ? houseHistory === "sold" && !isDate(soldDate)
          ? "처분일을 넣어 주세요."
          : null
        : step === 4
          ? hasAccount && !isDate(accountJoinDate)
            ? "본인 통장 가입일을 넣어 주세요."
            : married && spouseHasAccount && !isDate(spouseAccountJoinDate)
              ? "배우자 통장 가입일을 넣어 주세요."
              : null
          : null;

  // 결과 화면에 오면 계산된 점수를 저장 (홈·가능성 확인·단지 비교가 이 값을 씀. 원래 입력값은 저장하지 않음)
  const ready = step === RESULT && result.errors.length === 0;
  const saveKey = ready ? JSON.stringify([result.total, result.homeless.score, result.dependents.score, result.account.score, baseDate]) : null;
  useEffect(() => {
    if (!saveKey) return;
    saveMyScore({
      total: result.total,
      homeless: result.homeless.score,
      dependents: result.dependents.score,
      account: result.account.score,
      savedAt: baseDate,
      future: future.map((f) => ({ years: f.years, baseDate: f.baseDate, total: f.total })),
    });
    // 점수가 바뀔 때만 저장
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveKey]);

  return (
    <div className="max-w-xl">
      {/* 진행 표시 */}
      <div className="mb-6">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold text-brand">{step === RESULT ? "계산 결과" : STEPS[step - 1]}</span>
          <span className="text-xs tabular-nums text-muted">{step === RESULT ? "완료" : `${step} / ${STEPS.length}`}</span>
        </div>
        <div className="mt-2 h-0.5 bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={Math.min(step, STEPS.length)}>
          <div className="h-full bg-brand transition-[width] duration-200" style={{ width: `${(Math.min(step, STEPS.length) / STEPS.length) * 100}%` }} />
        </div>
      </div>

      <div key={step} className={dir === "next" ? "step-next" : "step-prev"}>
        {step === 1 && (
          <div className="border-t border-line">
            <Row label="생년월일">
              <DateInput value={birthDate} onChange={(v) => set({ birthDate: v })} />
            </Row>
            <Row label="혼인 여부">
              <Segment value={married ? "y" : "n"} options={[["n", "미혼"], ["y", "기혼"]]} onChange={(v) => set({ married: v === "y" })} />
            </Row>
            {married && (
              <Row label="혼인신고일">
                <DateInput value={marriageDate} onChange={(v) => set({ marriageDate: v })} />
              </Row>
            )}
            <Row label="계산 기준일" hint="보통 입주자모집공고일. 모르면 오늘 그대로">
              <DateInput value={baseDate} onChange={(v) => set({ baseDate: v || null })} />
            </Row>
          </div>
        )}

        {step === 2 && (
          <div className="border-t border-line">
            <Row label="주택 소유 이력" hint="본인과 배우자 기준">
              <Segment
                value={houseHistory}
                options={[["never", "없음"], ["sold", "있었지만 처분"], ["owning", "현재 소유"]]}
                onChange={(v) => set({ houseHistory: v as HouseHistory })}
              />
            </Row>
            {houseHistory === "sold" && (
              <Row label="처분일" hint="여러 채였다면 마지막 처분일">
                <DateInput value={soldDate} onChange={(v) => set({ soldDate: v })} />
              </Row>
            )}
            <p className="py-3 text-[13px] leading-relaxed text-muted">
              기산일은 앱이 자동으로 계산합니다. 만 30세가 되는 날과 혼인신고일 중 빠른 날부터 세고, 그 뒤에 주택을 처분했다면 처분일부터 셉니다.
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="border-t border-line">
            <Row label="배우자" hint="본인은 세지 않아요">
              <span className="text-sm text-muted">{married ? "기혼으로 선택해 자동 포함" : "미혼이라 해당 없음"}</span>
            </Row>

            {children.map((c, i) => (
              <div key={`c${i}`} className="border-b border-line py-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">자녀 {i + 1}</span>
                  <RemoveButton onClick={() => set({ children: children.filter((_, j) => j !== i) })} />
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  <Check label="혼인함" checked={c.married} onChange={(v) => updateChild(i, { married: v })} />
                  <Check label="만 30세 이상" checked={c.over30} onChange={(v) => updateChild(i, { over30: v })} />
                  {c.over30 && (
                    <Check label="1년 이상 같은 세대" checked={c.sameHousehold1Year} onChange={(v) => updateChild(i, { sameHousehold1Year: v })} />
                  )}
                </div>
              </div>
            ))}

            {parents.map((p, i) => (
              <div key={`p${i}`} className="border-b border-line py-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">직계존속 {i + 1}</span>
                    <select
                      value={p.relation}
                      onChange={(e) => updateParent(i, { relation: e.target.value as ParentRelation })}
                      className="rounded border border-line bg-white px-2 py-1 text-sm"
                    >
                      <option>본인 부모</option>
                      <option>배우자 부모</option>
                      <option>조부모</option>
                    </select>
                  </div>
                  <RemoveButton onClick={() => set({ parents: parents.filter((_, j) => j !== i) })} />
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  <Check label="3년 이상 같은 주민등록 세대" checked={p.sameHousehold3Years} onChange={(v) => updateParent(i, { sameHousehold3Years: v })} />
                  <Check label="주택 소유" checked={p.ownsHouse} onChange={(v) => updateParent(i, { ownsHouse: v })} />
                </div>
              </div>
            ))}

            <div className="flex flex-wrap gap-2 py-3">
              <AddButton onClick={() => set({ children: [...children, { married: false, over30: false, sameHousehold1Year: false }] })}>자녀 추가</AddButton>
              <AddButton onClick={() => set({ parents: [...parents, { relation: "본인 부모", sameHousehold3Years: true, ownsHouse: false }] })}>
                부모·조부모 추가
              </AddButton>
            </div>
            <p className="pb-3 text-[13px] leading-relaxed text-muted">미성년 자녀는 추가만 하고 체크 없이 두면 돼요. 부양가족이 없으면 그대로 다음으로 넘어가세요.</p>
          </div>
        )}

        {step === 4 && (
          <div className="border-t border-line">
            <Row label="본인 통장">
              <Segment value={hasAccount ? "y" : "n"} options={[["y", "있음"], ["n", "없음"]]} onChange={(v) => set({ hasAccount: v === "y" })} />
            </Row>
            {hasAccount && (
              <Row label="본인 가입일">
                <DateInput value={accountJoinDate} onChange={(v) => set({ accountJoinDate: v })} />
              </Row>
            )}
            {married && (
              <>
                <Row label="배우자 통장" hint="기간 점수의 50%, 최대 3점">
                  <Segment
                    value={spouseHasAccount ? "y" : "n"}
                    options={[["y", "있음"], ["n", "없음"]]}
                    onChange={(v) => set({ spouseHasAccount: v === "y" })}
                  />
                </Row>
                {spouseHasAccount && (
                  <Row label="배우자 가입일">
                    <DateInput value={spouseAccountJoinDate} onChange={(v) => set({ spouseAccountJoinDate: v })} />
                  </Row>
                )}
              </>
            )}
          </div>
        )}

        {step === RESULT &&
          (result.errors.length > 0 ? (
            <div className="border-t border-line">
              <ul className="py-4 text-sm text-muted">
                {result.errors.map((e) => (
                  <li key={e} className="py-0.5">
                    · {e}
                  </li>
                ))}
              </ul>
              <Link href="/score" className="text-sm text-brand underline">
                처음부터 입력하기 →
              </Link>
            </div>
          ) : (
            <ResultView result={result} future={future} gap={gapText(result.total, benchmark, benchLabel)} />
          ))}
      </div>

      {/* 이전 / 다음 */}
      {step < RESULT && (
        <div className="mt-6">
          {missing && <p className="mb-2 text-xs text-accent-dark">{missing}</p>}
          <div className="flex gap-2">
            {step > 1 && (
              <button type="button" onClick={() => go(step - 1)} className="rounded border border-line bg-white px-5 py-2.5 text-sm hover:border-brand">
                이전
              </button>
            )}
            <button
              type="button"
              disabled={!!missing}
              onClick={() => go(step + 1)}
              className="flex-1 rounded bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:bg-line disabled:text-muted"
            >
              {step === STEPS.length ? "결과 보기" : "다음"}
            </button>
          </div>
        </div>
      )}
      {step === RESULT && (
        <div className="mt-6">
          <button type="button" onClick={() => go(STEPS.length)} className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
            ← 입력 고치기
          </button>
        </div>
      )}
    </div>
  );
}

/** 결과: 총점, 성장 단계, 다음 행동 2개만 먼저. 항목별 점수와 근거는 접어 둠 */
function ResultView({ result, future, gap }: { result: ReturnType<typeof calcScore>; future: FutureScore[]; gap: string }) {
  const stage = growthStage(result.total);
  return (
    <>
      <table className="w-full border-t border-line text-sm">
        <tbody>
          <tr className="border-b border-line">
            <td className="py-3 pr-3 align-top whitespace-nowrap text-muted">총점</td>
            <td className="py-3 text-right tabular-nums">
              <b className="text-brand">{fmt(result.total)}점</b>
              <div className="text-xs text-accent-dark">{gap}</div>
            </td>
          </tr>
          <tr className="border-b border-line">
            <td className="py-3 pr-3 align-top whitespace-nowrap text-muted">성장 단계</td>
            <td className="py-3 text-right">
              {stage.name}{" "}
              <span className="text-xs text-muted">
                ({stage.step}/{stage.of}단계{stage.next ? ` · 다음 '${stage.next.name}'까지 ${fmt(stage.next.need)}점` : ""})
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link href="/check" className="rounded bg-brand py-2.5 text-center text-sm font-semibold text-white hover:bg-brand/90">
          가능성 확인하기
        </Link>
        <Link href="/eligibility" className="rounded border border-brand py-2.5 text-center text-sm font-semibold text-brand hover:bg-brand/5">
          부적격 점검하기
        </Link>
      </div>

      <Fold label="계산 근거 보기" className="mt-6">
        <ResultRow title="무주택기간" item={result.homeless} />
        <ResultRow title="부양가족 수" item={result.dependents} />
        <ResultRow title="청약통장 가입기간" item={result.account} />
        <FutureTable now={result} future={future} />
      </Fold>
    </>
  );
}

// ───────────────────────── 작은 부품들 ─────────────────────────

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

function Segment({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-line text-sm">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`border-l border-line px-3 py-1.5 first:border-l-0 ${
            value === v ? "bg-brand text-white" : "bg-white text-ink hover:bg-brand/5"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-brand"
      />
      {label}
    </label>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-brand px-3 py-1.5 text-sm text-brand hover:bg-brand hover:text-white"
    >
      + {children}
    </button>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-xs text-muted underline hover:text-ink">
      삭제
    </button>
  );
}

/** 지금 · 1년 뒤 · 3년 뒤 점수 표 */
function FutureTable({ now, future }: { now: ReturnType<typeof calcScore>; future: FutureScore[] }) {
  if (future.length === 0) return null;
  const rows = [
    { label: "지금", homeless: now.homeless.score, dependents: now.dependents.score, account: now.account.score, total: now.total, diff: 0 },
    ...future.map((f) => ({ label: `${f.years}년 뒤`, ...f, diff: f.total - now.total })),
  ];
  return (
    <div className="mt-6">
      <h3 className="border-b-2 border-brand pb-2 text-sm font-semibold text-brand">앞으로의 점수</h3>
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th className="py-2 text-left font-normal">시점</th>
            <th className="py-2 text-right font-normal">무주택</th>
            <th className="py-2 text-right font-normal">부양</th>
            <th className="py-2 text-right font-normal">통장</th>
            <th className="py-2 text-right font-normal">총점</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-line">
              <td className="py-2">{r.label}</td>
              <td className="py-2 text-right">{fmt(r.homeless)}</td>
              <td className="py-2 text-right">{fmt(r.dependents)}</td>
              <td className="py-2 text-right">{fmt(r.account)}</td>
              <td className="py-2 text-right">
                <b className="text-brand">{fmt(r.total)}</b>
                {r.diff > 0 && <span className="ml-1 text-xs text-accent-dark">+{fmt(r.diff)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-2 space-y-0.5 text-xs leading-relaxed text-muted">
        {FUTURE_ASSUMPTIONS.map((a) => (
          <li key={a}>· {a}</li>
        ))}
      </ul>
    </div>
  );
}

function ResultRow({ title, item }: { title: string; item: ItemResult }) {
  return (
    <div className="border-b border-line py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-sm tabular-nums">
          <b className="text-brand">{fmt(item.score)}</b>점
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {item.lines.map((l, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-snug">
            <span className={l.ok ? "text-brand" : "text-accent-dark"}>{l.ok ? "✓" : "✕"}</span>
            <span className={l.ok ? "text-ink/80" : "text-ink"}>{l.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
