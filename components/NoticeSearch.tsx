"use client";

/**
 * 분양 공고 검색창 (자동완성 + 최근 검색어)
 *
 * - 글자를 치면 아래에 후보를 분류별로 최대 8개 ("단지" / "지역" / "건설사")
 *   단지 → 그 공고 상세로, 지역 → 지역 태그로 목록 필터, 건설사 → 그 건설사 공고만
 * - ↑↓로 후보 이동, Enter로 선택, ESC로 닫기. 후보를 고르지 않고 Enter → 입력어가 들어간 공고 전체
 * - 비어 있을 때 누르면 최근 검색어 5개 (개별·전체 삭제). 브라우저 저장소에만 두고, 못 쓰면 저장만 건너뜀
 * 검색 규칙은 lib/notice-search.ts에 있습니다.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Notice } from "@/lib/applyhome";
import { addRecent, makeQuery, readRecent, suggest, writeRecent, type Suggestion } from "@/lib/notice-search";

type Props = {
  notices: Notice[];
  initial: string;
  onSubmit: (text: string) => void; // 후보 없이 Enter (빈 문자열이면 검색 해제)
  onPickComplex: (no: string) => void;
  onPickRegion: (region: string, unit: string) => void;
  onPickBuilder: (name: string) => void;
};

type Option = { id: string; kind: "suggest"; s: Suggestion } | { id: string; kind: "recent"; word: string };

export default function NoticeSearch({ notices, initial, onSubmit, onPickComplex, onPickRegion, onPickBuilder }: Props) {
  const [text, setText] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const query = makeQuery(text);
  const suggestions = useMemo(() => (query ? suggest(notices, query) : []), [notices, query]);
  const options: Option[] = query
    ? suggestions.map((s, i) => ({ id: `${listId}-s${i}`, kind: "suggest", s }))
    : recent.map((word, i) => ({ id: `${listId}-r${i}`, kind: "recent", word }));
  const showList = open && options.length > 0;

  // 바깥을 누르면 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function openList() {
    setRecent(readRecent());
    setActive(-1);
    setOpen(true);
  }

  function remember(word: string) {
    if (word.trim()) setRecent(addRecent(readRecent(), word.trim()));
  }

  function choose(o: Option) {
    setOpen(false);
    setActive(-1);
    if (o.kind === "recent") {
      setText(o.word);
      remember(o.word);
      onSubmit(o.word);
      return;
    }
    const s = o.s;
    remember(s.label);
    if (s.kind === "단지") onPickComplex(s.no);
    else if (s.kind === "지역") {
      setText("");
      onPickRegion(s.region, s.unit);
    } else {
      setText("");
      onPickBuilder(s.label);
    }
  }

  function submit() {
    setOpen(false);
    setActive(-1);
    remember(text);
    onSubmit(text.trim());
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openList();
      if (!options.length) return;
      const d = e.key === "ArrowDown" ? 1 : -1;
      // -1(입력칸) → 첫 후보 … 마지막 후보 → 다시 입력칸
      setActive((a) => {
        const n = options.length;
        const next = a + d;
        return next < -1 ? n - 1 : next >= n ? -1 : next;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && options[active]) choose(options[active]);
      else submit();
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    }
  }

  return (
    <div ref={boxRef} className="relative mb-3">
      <div className="flex h-11 items-center gap-2 rounded border border-line bg-white px-3 focus-within:border-brand">
        <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-muted" aria-hidden="true">
          <path d="M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM13.5 13.5 17 17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(-1);
            setOpen(true);
            if (!e.target.value) setRecent(readRecent());
          }}
          onFocus={openList}
          onClick={() => !open && openList()}
          onKeyDown={onKeyDown}
          placeholder="단지명, 지역, 건설사로 검색"
          aria-label="단지명, 지역, 건설사로 검색"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? options[active]?.id : undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {text && (
          <button
            type="button"
            onClick={() => {
              setText("");
              onSubmit("");
              setRecent(readRecent());
              inputRef.current?.focus();
            }}
            aria-label="검색어 지우기"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-black/5 hover:text-ink"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
              <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {showList && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 rounded border border-line bg-white py-1 shadow-sm">
          {!query && (
            <div className="flex items-center justify-between px-3 pt-1 pb-1.5 text-xs text-muted">
              <span>최근 검색어</span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setRecent(writeRecent([]))}
                className="hover:text-brand"
              >
                전체 삭제
              </button>
            </div>
          )}
          <ul id={listId} role="listbox" aria-label={query ? "검색어 후보" : "최근 검색어"}>
            {options.map((o, i) => {
              const prev = options[i - 1];
              const head = o.kind === "suggest" && (prev?.kind !== "suggest" || prev.s.kind !== o.s.kind) ? o.s.kind : null;
              return (
                <li key={o.id} role="presentation">
                  {head && <div className="px-3 pt-2 pb-0.5 text-xs text-muted">{head}</div>}
                  <div
                    id={o.id}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o)}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${i === active ? "bg-brand/5" : ""}`}
                  >
                    {o.kind === "suggest" ? (
                      <>
                        <span className="min-w-0 flex-1 truncate">
                          <Highlight text={o.s.label} range={o.s.range} />
                        </span>
                        <span className="shrink-0 text-xs text-muted">{o.s.kind === "단지" ? "상세 보기" : o.s.kind === "지역" ? "지역 추가" : "이 건설사만"}</span>
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-muted" aria-hidden="true">
                          <path d="M10 17a7 7 0 1 0-7-7M3 6v4h4M10 6.5V10l2.5 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="min-w-0 flex-1 truncate">{o.word}</span>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setRecent(writeRecent(recent.filter((w) => w !== o.word)));
                          }}
                          aria-label={`최근 검색어 ${o.word} 삭제`}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-black/5 hover:text-ink"
                        >
                          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
                            <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 일치한 글자만 주황색으로 */
export function Highlight({ text, range }: { text: string; range: [number, number] | null }) {
  if (!range) return <>{text}</>;
  const [s, e] = range;
  return (
    <>
      {text.slice(0, s)}
      <mark className="bg-transparent font-semibold text-accent-dark">{text.slice(s, e)}</mark>
      {text.slice(e)}
    </>
  );
}
