"use client";

/**
 * 가점 계산기 화면 (입력 + 결과)
 * 계산은 전부 lib/score.ts가 하고, 이 파일은 입력을 모아 넘기고 결과를 보여주기만 합니다.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveMyScore } from "@/lib/myScore";
import {
  calcScore,
  fmt,
  TOTAL_MAX,
  type Child,
  type HouseHistory,
  type ItemResult,
  type Parent,
  type ParentRelation,
} from "@/lib/score";

// 한국 시간 기준 오늘 날짜 ("YYYY-MM-DD")
function todayKST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export default function Calculator() {
  const router = useRouter();
  const [baseDate, setBaseDate] = useState(todayKST);
  const [birthDate, setBirthDate] = useState("");
  const [married, setMarried] = useState(false);
  const [marriageDate, setMarriageDate] = useState("");
  const [houseHistory, setHouseHistory] = useState<HouseHistory>("never");
  const [soldDate, setSoldDate] = useState("");
  const [children, setChildren] = useState<Child[]>([]);
  const [parents, setParents] = useState<Parent[]>([]);
  const [hasAccount, setHasAccount] = useState(true);
  const [accountJoinDate, setAccountJoinDate] = useState("");
  const [spouseHasAccount, setSpouseHasAccount] = useState(false);
  const [spouseAccountJoinDate, setSpouseAccountJoinDate] = useState("");

  const result = useMemo(
    () =>
      calcScore({
        baseDate,
        birthDate,
        married,
        marriageDate,
        houseHistory,
        soldDate,
        children,
        parents,
        hasAccount,
        accountJoinDate,
        spouseHasAccount,
        spouseAccountJoinDate,
      }),
    [baseDate, birthDate, married, marriageDate, houseHistory, soldDate, children, parents, hasAccount, accountJoinDate, spouseHasAccount, spouseAccountJoinDate],
  );

  const updateChild = (i: number, patch: Partial<Child>) =>
    setChildren((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const updateParent = (i: number, patch: Partial<Parent>) =>
    setParents((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-14">
      {/* ───────── 입력 ───────── */}
      <div>
        <Section title="기본 정보">
          <Row label="계산 기준일" hint="보통 입주자모집공고일">
            <DateInput value={baseDate} onChange={setBaseDate} />
          </Row>
          <Row label="생년월일">
            <DateInput value={birthDate} onChange={setBirthDate} />
          </Row>
          <Row label="혼인 여부">
            <Segment
              value={married ? "y" : "n"}
              options={[["n", "미혼"], ["y", "기혼"]]}
              onChange={(v) => setMarried(v === "y")}
            />
          </Row>
          {married && (
            <Row label="혼인신고일">
              <DateInput value={marriageDate} onChange={setMarriageDate} />
            </Row>
          )}
        </Section>

        <Section title="무주택기간">
          <Row label="주택 소유 이력" hint="본인과 배우자 기준">
            <Segment
              value={houseHistory}
              options={[["never", "없음"], ["sold", "있었지만 처분"], ["owning", "현재 소유"]]}
              onChange={(v) => setHouseHistory(v as HouseHistory)}
            />
          </Row>
          {houseHistory === "sold" && (
            <Row label="처분일" hint="여러 채였다면 마지막 처분일">
              <DateInput value={soldDate} onChange={setSoldDate} />
            </Row>
          )}
          <p className="py-3 text-[13px] leading-relaxed text-muted">
            기산일은 앱이 자동으로 계산합니다. 만 30세가 되는 날과 혼인신고일 중 빠른 날부터 세고, 그 뒤에 주택을 처분했다면 처분일부터 셉니다.
          </p>
        </Section>

        <Section title="부양가족" hint="본인 제외">
          <Row label="배우자">
            <span className="text-sm text-muted">
              {married ? "기혼으로 선택해 자동 포함" : "미혼이라 해당 없음"}
            </span>
          </Row>

          {children.map((c, i) => (
            <div key={`c${i}`} className="border-b border-line py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">자녀 {i + 1}</span>
                <RemoveButton onClick={() => setChildren((l) => l.filter((_, j) => j !== i))} />
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <Check label="혼인함" checked={c.married} onChange={(v) => updateChild(i, { married: v })} />
                <Check label="만 30세 이상" checked={c.over30} onChange={(v) => updateChild(i, { over30: v })} />
                {c.over30 && (
                  <Check
                    label="1년 이상 같은 세대"
                    checked={c.sameHousehold1Year}
                    onChange={(v) => updateChild(i, { sameHousehold1Year: v })}
                  />
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
                <RemoveButton onClick={() => setParents((l) => l.filter((_, j) => j !== i))} />
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <Check
                  label="3년 이상 같은 주민등록 세대"
                  checked={p.sameHousehold3Years}
                  onChange={(v) => updateParent(i, { sameHousehold3Years: v })}
                />
                <Check label="주택 소유" checked={p.ownsHouse} onChange={(v) => updateParent(i, { ownsHouse: v })} />
              </div>
            </div>
          ))}

          <div className="flex flex-wrap gap-2 py-3">
            <AddButton
              onClick={() => setChildren((l) => [...l, { married: false, over30: false, sameHousehold1Year: false }])}
            >
              자녀 추가
            </AddButton>
            <AddButton
              onClick={() =>
                setParents((l) => [...l, { relation: "본인 부모", sameHousehold3Years: true, ownsHouse: false }])
              }
            >
              부모·조부모 추가
            </AddButton>
          </div>
        </Section>

        <Section title="청약통장">
          <Row label="본인 통장">
            <Segment
              value={hasAccount ? "y" : "n"}
              options={[["y", "있음"], ["n", "없음"]]}
              onChange={(v) => setHasAccount(v === "y")}
            />
          </Row>
          {hasAccount && (
            <Row label="본인 가입일">
              <DateInput value={accountJoinDate} onChange={setAccountJoinDate} />
            </Row>
          )}
          {married && (
            <>
              <Row label="배우자 통장" hint="기간 점수의 50%, 최대 3점">
                <Segment
                  value={spouseHasAccount ? "y" : "n"}
                  options={[["y", "있음"], ["n", "없음"]]}
                  onChange={(v) => setSpouseHasAccount(v === "y")}
                />
              </Row>
              {spouseHasAccount && (
                <Row label="배우자 가입일">
                  <DateInput value={spouseAccountJoinDate} onChange={setSpouseAccountJoinDate} />
                </Row>
              )}
            </>
          )}
        </Section>
      </div>

      {/* ───────── 결과 ───────── */}
      <div className="lg:sticky lg:top-8 lg:self-start">
        <h2 className="border-b-2 border-brand pb-2 text-sm font-semibold text-brand">계산 결과</h2>

        {result.errors.length > 0 ? (
          <ul className="py-4 text-sm text-muted">
            {result.errors.map((e) => (
              <li key={e} className="py-0.5">· {e}</li>
            ))}
          </ul>
        ) : (
          <>
            <ResultRow title="무주택기간" item={result.homeless} />
            <ResultRow title="부양가족 수" item={result.dependents} />
            <ResultRow title="청약통장 가입기간" item={result.account} />
            <div className="flex items-baseline justify-between border-t-2 border-brand py-3">
              <span className="font-semibold">총점</span>
              <span className="tabular-nums">
                <b className="text-xl text-brand">{fmt(result.total)}</b>
                <span className="text-sm text-muted"> / {TOTAL_MAX}점</span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                saveMyScore({
                  total: result.total,
                  homeless: result.homeless.score,
                  dependents: result.dependents.score,
                  account: result.account.score,
                  savedAt: baseDate,
                });
                router.push("/compare");
              }}
              className="mt-2 w-full rounded bg-brand py-3 text-sm font-semibold text-white hover:bg-brand/90"
            >
              이 점수로 단지 비교하기 →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── 작은 부품들 ─────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="flex items-baseline gap-2 border-b-2 border-brand pb-2 text-sm font-semibold text-brand">
        {title}
        {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
      </h2>
      {children}
    </section>
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

function ResultRow({ title, item }: { title: string; item: ItemResult }) {
  const pct = (item.score / item.max) * 100;
  return (
    <div className="border-b border-line py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-sm tabular-nums">
          <b className="text-brand">{fmt(item.score)}</b>
          <span className="text-muted"> / {item.max}</span>
        </span>
      </div>
      <div className="mt-2 h-1 w-full bg-line">
        <div className="h-1 bg-accent" style={{ width: `${pct}%` }} />
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
