"use client";

/**
 * 날짜 입력 (가점 계산 공용)
 *
 * - 모바일(768px 미만): 칸을 누르면 아래에서 시트가 올라오고, 연 / 월 / 일 세 줄을 위아래로 돌려 고름
 *   가운데 선택 줄은 연한 초록 띠, 위아래는 점점 흐리게, 멈추면 가장 가까운 칸에 맞춤(scroll-snap)
 *   항목을 눌러도 그 칸으로 이동. 바깥을 누르거나 아래로 끌어내리면 취소
 * - PC: 연 / 월 / 일 세 칸 선택 목록 + 숫자 직접 입력 칸 (예: 20040906, 2004.9.6)
 * - 일 목록은 고른 연·월에 맞게 28~31일(윤년 포함). 31일이었다가 2월로 바꾸면 그 달 마지막 날로
 * - 범위 밖(미래 등)은 목록에 나오지 않음
 * - 값은 지금처럼 "YYYY-MM-DD" 문자열로 넘김 (비어 있으면 "")
 * - 동작 줄이기 설정이면 시트가 효과 없이 바로 보이고, 돌림도 바로 맞춤
 */

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { todayKST } from "@/lib/mySchedule";

/**
 * 입력 종류별 범위
 *  birth: 생년월일 1940년 ~ 오늘 (처음 열면 1995년 1월 1일)
 *  past:  혼인신고일·처분일·통장 가입일 1970년 ~ 오늘 (처음 열면 오늘)
 *  base:  계산 기준일 1970년 ~ 내후년 말 (입주자모집공고일이 앞으로일 수 있어 미래도 허용, 처음 열면 오늘)
 */
export type DateKind = "birth" | "past" | "base";

type Ymd = { y: number; m: number; d: number };

const ITEM_H = 40; // 한 칸 높이(px)
const VISIBLE = 5; // 보이는 칸 수 (가운데가 선택)
const MOBILE_QUERY = "(max-width: 767px)";

// ───────────────────────── 날짜 도구 ─────────────────────────

export const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1~12
const pad = (n: number) => String(n).padStart(2, "0");
const toStr = (v: Ymd) => `${v.y}-${pad(v.m)}-${pad(v.d)}`;
const cmp = (a: Ymd, b: Ymd) => a.y - b.y || a.m - b.m || a.d - b.d;
export const formatKo = (v: Ymd) => `${v.y}년 ${v.m}월 ${v.d}일`;

function parse(s: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const v = { y: +m[1], m: +m[2], d: +m[3] };
  return v.m >= 1 && v.m <= 12 && v.d >= 1 && v.d <= daysIn(v.y, v.m) ? v : null;
}

/** 직접 입력: "20040906", "2004.9.6", "2004-09-06", "2004 9 6" */
export function parseTyped(s: string): Ymd | null {
  const t = s.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  const parts = compact ? compact.slice(1) : t.split(/[^\d]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m) ? { y, m, d } : null;
}

function rangeOf(kind: DateKind, today: string): { min: Ymd; max: Ymd } {
  const t = parse(today) ?? { y: 2026, m: 1, d: 1 };
  if (kind === "birth") return { min: { y: 1940, m: 1, d: 1 }, max: t };
  if (kind === "past") return { min: { y: 1970, m: 1, d: 1 }, max: t };
  return { min: { y: 1970, m: 1, d: 1 }, max: { y: t.y + 2, m: 12, d: 31 } };
}

/** 범위 안으로, 그리고 그 달의 마지막 날을 넘지 않게 */
export function clamp(v: Ymd, min: Ymd, max: Ymd): Ymd {
  const fixed = { ...v, d: Math.min(v.d, daysIn(v.y, v.m)) };
  if (cmp(fixed, min) < 0) return min;
  if (cmp(fixed, max) > 0) return max;
  return fixed;
}

/** 고를 수 있는 연·월·일 목록 (범위 밖은 빼서 미래 날짜는 아예 나오지 않음) */
export function options(v: Ymd, min: Ymd, max: Ymd) {
  const years = Array.from({ length: max.y - min.y + 1 }, (_, i) => min.y + i);
  const mFrom = v.y === min.y ? min.m : 1;
  const mTo = v.y === max.y ? max.m : 12;
  const months = Array.from({ length: mTo - mFrom + 1 }, (_, i) => mFrom + i);
  const dFrom = v.y === min.y && v.m === min.m ? min.d : 1;
  const dTo = v.y === max.y && v.m === max.m ? max.d : daysIn(v.y, v.m);
  const days = Array.from({ length: dTo - dFrom + 1 }, (_, i) => dFrom + i);
  return { years, months, days };
}

const subscribeMedia = (cb: () => void) => {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const noSubscribe = () => () => {};

// ───────────────────────── 컴포넌트 ─────────────────────────

export default function DateWheel({ value, onChange, label, kind }: { value: string; onChange: (v: string) => void; label: string; kind: DateKind }) {
  const mobile = useSyncExternalStore(subscribeMedia, () => window.matchMedia(MOBILE_QUERY).matches, () => false);
  const today = useSyncExternalStore(noSubscribe, todayKST, () => "");
  const { min, max } = rangeOf(kind, today);
  const current = parse(value);
  const start = clamp(current ?? (kind === "birth" ? { y: 1995, m: 1, d: 1 } : (parse(today) ?? max)), min, max);

  return mobile ? (
    <MobileDate label={label} current={current} start={start} min={min} max={max} onChange={onChange} />
  ) : (
    <DesktopDate label={label} current={current} min={min} max={max} onChange={onChange} />
  );
}

// ───────────────────────── PC: 세 칸 선택 + 직접 입력 ─────────────────────────

function DesktopDate({ label, current, min, max, onChange }: { label: string; current: Ymd | null; min: Ymd; max: Ymd; onChange: (v: string) => void }) {
  // 세 칸을 다 고르기 전까지는 고른 칸만 기억 (값은 비워 둠)
  const [partial, setPartial] = useState<{ y: number | null; m: number | null; d: number | null }>({ y: null, m: null, d: null });
  const shown = current ?? partial;
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState(false);
  const id = useId();

  const years = Array.from({ length: max.y - min.y + 1 }, (_, i) => max.y - i); // 최근 연도가 위
  const refY = shown.y ?? max.y;
  const refM = shown.m ?? 1;
  const opts = options({ y: refY, m: refM, d: 1 }, min, max);
  const months = shown.y ? opts.months : Array.from({ length: 12 }, (_, i) => i + 1);
  const days = shown.y && shown.m ? opts.days : Array.from({ length: 31 }, (_, i) => i + 1);

  function pick(next: { y: number | null; m: number | null; d: number | null }) {
    if (next.y && next.m && next.d) {
      const v = clamp({ y: next.y, m: next.m, d: next.d }, min, max);
      setPartial({ y: null, m: null, d: null });
      onChange(toStr(v));
    } else {
      // 이미 값이 있었는데 한 칸을 비우면 값도 비움
      setPartial(next);
      if (current) onChange("");
    }
  }

  function applyTyped() {
    if (!typed.trim()) return;
    const v = parseTyped(typed);
    if (!v || cmp(v, min) < 0 || cmp(v, max) > 0) return setTypedError(true);
    setTypedError(false);
    setTyped("");
    onChange(toStr(v));
  }

  const sel = "rounded border border-line bg-white px-2 py-1.5 text-sm tabular-nums focus:border-brand focus:outline-none";
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <select aria-label={`${label} 연도`} value={shown.y ?? ""} onChange={(e) => pick({ ...shown, y: e.target.value ? +e.target.value : null })} className={sel}>
        <option value="">연</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}년
          </option>
        ))}
      </select>
      <select aria-label={`${label} 월`} value={shown.m ?? ""} onChange={(e) => pick({ ...shown, m: e.target.value ? +e.target.value : null })} className={sel}>
        <option value="">월</option>
        {months.map((m) => (
          <option key={m} value={m}>
            {m}월
          </option>
        ))}
      </select>
      <select aria-label={`${label} 일`} value={shown.d ?? ""} onChange={(e) => pick({ ...shown, d: e.target.value ? +e.target.value : null })} className={sel}>
        <option value="">일</option>
        {days.map((d) => (
          <option key={d} value={d}>
            {d}일
          </option>
        ))}
      </select>
      <label htmlFor={id} className="sr-only">
        {label} 직접 입력
      </label>
      <input
        id={id}
        inputMode="numeric"
        value={typed}
        onChange={(e) => {
          setTyped(e.target.value);
          setTypedError(false);
        }}
        onBlur={applyTyped}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyTyped())}
        placeholder="직접 입력 20040906"
        aria-invalid={typedError}
        aria-describedby={typedError ? `${id}-err` : undefined}
        className={`${sel} w-40 ${typedError ? "border-bad" : ""}`}
      />
      {typedError && (
        <span id={`${id}-err`} className="w-full text-xs text-bad" role="alert">
          {formatKo(min)} ~ {formatKo(max)} 사이의 날짜를 YYYYMMDD로 넣어 주세요.
        </span>
      )}
    </div>
  );
}

// ───────────────────────── 모바일: 아래 시트 + 세 줄 돌림 ─────────────────────────

function MobileDate({
  label,
  current,
  start,
  min,
  max,
  onChange,
}: {
  label: string;
  current: Ymd | null;
  start: Ymd;
  min: Ymd;
  max: Ymd;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${label}: ${current ? formatKo(current) : "선택 안 함"}. 눌러서 고르기`}
        className="flex w-full items-center justify-between rounded border border-line bg-white px-3 py-2.5 text-left text-sm tabular-nums"
      >
        <span className={current ? "text-ink" : "text-muted"}>{current ? formatKo(current) : "날짜 선택"}</span>
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-muted" aria-hidden="true">
          <path d="M4 5h12v11H4zM4 8.5h12M7 3v3M13 3v3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <Sheet
          label={label}
          start={current ?? start}
          min={min}
          max={max}
          onCancel={() => {
            setOpen(false);
            buttonRef.current?.focus();
          }}
          onConfirm={(v) => {
            setOpen(false);
            onChange(toStr(v));
            buttonRef.current?.focus();
          }}
        />
      )}
    </>
  );
}

function Sheet({ label, start, min, max, onCancel, onConfirm }: { label: string; start: Ymd; min: Ymd; max: Ymd; onCancel: () => void; onConfirm: (v: Ymd) => void }) {
  const [draft, setDraft] = useState<Ymd>(start);
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const { years, months, days } = options(draft, min, max);

  // 연·월이 바뀌면 일을 그 달 안으로 (31일 → 2월이면 28·29일), 범위 밖이면 안으로
  const set = (next: Ymd) => setDraft(clamp(next, min, max));

  // 열릴 때 뒤 화면 스크롤 막기, ESC로 취소, 첫 줄에 포커스
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    boxRef.current?.querySelector<HTMLElement>("[role=listbox]")?.focus();
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 motion-safe:animate-[fade-in_0.15s_ease-out]" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined }}
        className="w-full rounded-t-xl bg-white pb-[env(safe-area-inset-bottom)] motion-safe:animate-[sheet-up_0.2s_ease-out]"
      >
        {/* 손잡이: 아래로 끌어내리면 취소 */}
        <div
          className="flex touch-none justify-center pt-2 pb-1"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = e.clientY;
          }}
          onPointerMove={(e) => drag.current !== null && setDragY(Math.max(0, e.clientY - drag.current))}
          onPointerUp={() => {
            const moved = dragY;
            drag.current = null;
            setDragY(0);
            if (moved > 80) onCancel();
          }}
          aria-hidden="true"
        >
          <span className="h-1 w-10 rounded-full bg-line" />
        </div>
        <div className="px-4 pb-2 text-center">
          <p id={titleId} className="text-xs text-muted">
            {label}
          </p>
          <p className="mt-0.5 text-base font-semibold text-brand tabular-nums" aria-live="polite">
            {formatKo(draft)}
          </p>
        </div>

        <div className="relative grid grid-cols-3 gap-1 px-4">
          {/* 가운데 선택 줄 */}
          <div className="pointer-events-none absolute inset-x-4 rounded-md bg-brand/10" style={{ top: ITEM_H * 2, height: ITEM_H }} aria-hidden="true" />
          <Wheel name="연도" unit="년" items={years} value={draft.y} onChange={(y) => set({ ...draft, y })} />
          <Wheel name="월" unit="월" items={months} value={draft.m} onChange={(m) => set({ ...draft, m })} />
          <Wheel name="일" unit="일" items={days} value={draft.d} onChange={(d) => set({ ...draft, d })} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line px-4 py-3">
          <button type="button" onClick={onCancel} className="rounded border border-line py-2.5 text-sm text-ink">
            취소
          </button>
          <button type="button" onClick={() => onConfirm(draft)} className="rounded bg-brand py-2.5 text-sm font-semibold text-white">
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

/** 위아래로 돌리는 한 줄 (연·월·일) */
function Wheel({ name, unit, items, value, onChange }: { name: string; unit: string; items: number[]; value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 코드로 옮기는 중이면 그 목표 위치. 목표에 닿기 전까지는 스크롤 이벤트로 값을 바꾸지 않음
  const target = useRef<number | null>(null);
  const first = useRef(true);
  const idx = Math.max(0, items.indexOf(value));
  const [live, setLive] = useState(idx); // 흐림 효과용 (스크롤 중 가운데에 온 칸)
  const id = useId();

  // 값이나 목록이 바뀌면 그 칸이 가운데로 오게 (처음 열 때와 동작 줄이기 설정이면 바로)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const top = idx * ITEM_H;
    if (Math.abs(el.scrollTop - top) < 1) return;
    const instant = first.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    first.current = false;
    target.current = top;
    el.scrollTo({ top, behavior: instant ? "auto" : "smooth" });
    // 목표에 못 닿고 끝나는 경우(사용자가 중간에 잡는 등)를 대비해 잠시 뒤 풀어 줌
    const t = setTimeout(() => (target.current = null), 1500);
    return () => clearTimeout(t);
  }, [idx, items.length]);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)));
    setLive(i);
    if (target.current !== null) {
      if (Math.abs(el.scrollTop - target.current) < 2) target.current = null;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    // 멈추면 (scroll-snap이 맞춘 뒤) 그 칸으로 값 바꾸기
    timer.current = setTimeout(() => items[i] !== value && onChange(items[i]), 120);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "PageDown" ? 5 : e.key === "PageUp" ? -5 : 0;
    if (e.key === "Home") return e.preventDefault(), onChange(items[0]);
    if (e.key === "End") return e.preventDefault(), onChange(items[items.length - 1]);
    if (!d) return;
    e.preventDefault();
    onChange(items[Math.min(items.length - 1, Math.max(0, idx + d))]);
  }

  return (
    <div className="relative">
      <div
        ref={ref}
        role="listbox"
        tabIndex={0}
        aria-label={name}
        aria-activedescendant={`${id}-${value}`}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        className="relative snap-y snap-mandatory overflow-y-scroll overscroll-contain rounded-md outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-brand/50 [&::-webkit-scrollbar]:hidden"
        style={{ height: ITEM_H * VISIBLE, paddingBlock: ITEM_H * 2 }}
      >
        {items.map((v, i) => {
          const dist = Math.abs(i - live);
          return (
            <div
              key={v}
              id={`${id}-${v}`}
              role="option"
              aria-selected={v === value}
              onClick={() => onChange(v)}
              className={`flex snap-center items-center justify-center text-base tabular-nums ${v === value ? "font-semibold text-brand" : "text-ink"}`}
              style={{ height: ITEM_H, opacity: dist === 0 ? 1 : dist === 1 ? 0.55 : 0.25 }}
            >
              {v}
              {unit}
            </div>
          );
        })}
      </div>
    </div>
  );
}
