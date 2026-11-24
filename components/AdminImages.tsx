"use client";

/**
 * 대표 이미지 고르기 표 (/admin/images, 내 컴퓨터에서만)
 * 단지마다 지금 이미지 + 상위 후보(최대 6개). 후보를 누르면 image-overrides.json에 저장(1순위),
 * "지도 사용"은 hide, "지정 해제"는 직접 지정을 지움. 맨 위에서 "확인 필요"·"지도"만 볼 수 있음.
 */

import { useMemo, useState } from "react";
import type { ResolvedImage } from "@/lib/image-resolve";

export type AdminRow = {
  name: string;
  current: ResolvedImage;
  manual: boolean;
  review: boolean;
  candidates: { url: string; width: number; height: number; note?: string }[];
  homepage: string | null;
  pdf: string | null;
  checkedAt: string | null;
};

type Filter = "all" | "review" | "map";

const KIND_COLOR: Record<string, string> = {
  "직접 지정": "text-brand",
  조감도: "text-brand",
  모집공고: "text-brand",
  "분양 홈페이지": "text-ok",
  공공기관: "text-ok",
  지도: "text-muted",
  숨김: "text-muted",
};

export default function AdminImages({ rows: initial }: { rows: AdminRow[] }) {
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [word, setWord] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.current.kind] = (c[r.current.kind] ?? 0) + 1;
    return c;
  }, [rows]);
  const isMap = (r: AdminRow) => r.current.kind === "지도" || r.current.kind === "숨김";
  const shown = rows.filter(
    (r) => (filter === "all" || (filter === "review" ? r.review : isMap(r))) && (!word.trim() || r.name.replace(/\s+/g, "").includes(word.replace(/\s+/g, ""))),
  );

  async function save(name: string, value: string | null) {
    setSaving(name);
    setMessage(null);
    const res = await fetch("/api/admin/image-override", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, value }) })
      .then((r) => r.json() as Promise<{ ok: boolean; reason?: string }>)
      .catch(() => ({ ok: false, reason: "서버에 연결하지 못했어요." }));
    setSaving(null);
    if (!res.ok) return setMessage(`저장 실패: ${res.reason ?? ""}`);
    setRows((list) =>
      list.map((r) =>
        r.name !== name
          ? r
          : {
              ...r,
              review: false,
              current:
                value === null
                  ? { ...r.current, kind: r.current.kind === "직접 지정" || r.current.kind === "숨김" ? "지도" : r.current.kind, note: "지정 해제 (새로고침하면 다음 순서 이미지로)" }
                  : value === "hide"
                    ? { image: null, kind: "숨김", source: null, homepage: null, review: false, note: "지도 사용" }
                    : { image: value, kind: "직접 지정", source: null, homepage: null, review: false },
            },
      ),
    );
    setMessage(`"${name}" 저장했어요. 사이트에 반영하려면 data/image-overrides.json을 커밋·배포하세요.`);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line pb-3 text-xs text-muted">
        {Object.entries(counts).map(([k, n]) => (
          <span key={k}>
            <span className={KIND_COLOR[k] ?? ""}>{k}</span> {n}
          </span>
        ))}
        <span>· 확인 필요 {rows.filter((r) => r.review).length}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 py-3 text-sm">
        {(
          [
            ["all", `전체 ${rows.length}`],
            ["review", "확인 필요만"],
            ["map", "지도만"],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs ${filter === f ? "border-brand bg-brand text-white" : "border-line bg-white"}`}
          >
            {label}
          </button>
        ))}
        <input
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder="단지명 찾기"
          aria-label="단지명 찾기"
          className="ml-auto w-44 rounded border border-line bg-white px-2 py-1 text-sm"
        />
      </div>
      {message && (
        <p className="mb-2 rounded bg-brand/5 px-3 py-2 text-xs text-brand" role="status">
          {message}
        </p>
      )}

      <ul className="border-t border-line">
        {shown.map((r) => (
          <li key={r.name} className="border-b border-line py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-sm font-medium">
                {r.name}
                {r.review && <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-xs text-accent-dark">확인 필요</span>}
              </span>
              <span className={`text-xs ${KIND_COLOR[r.current.kind] ?? ""}`}>
                {r.current.kind}
                {r.current.source && ` · ${r.current.source}`}
              </span>
            </div>
            {(r.current.note || r.pdf || r.checkedAt) && (
              <p className="mt-0.5 text-xs text-muted">
                {[r.current.note, r.pdf && `모집공고 PDF: ${r.pdf}`, r.checkedAt && `확인 ${r.checkedAt}`].filter(Boolean).join(" · ")}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <Thumb label="지금" src={r.current.image} />
              {r.candidates.map((c) => (
                <button
                  key={c.url}
                  type="button"
                  disabled={saving === r.name}
                  onClick={() => save(r.name, c.url)}
                  title={`${c.width}×${c.height}${c.note ? ` · ${c.note}` : ""} — 눌러서 이 이미지로 지정`}
                  className={`text-left ${r.current.image === c.url ? "ring-2 ring-brand" : "hover:ring-2 hover:ring-accent"} rounded`}
                >
                  <Thumb label={`${c.width}×${c.height}`} src={c.url} />
                </button>
              ))}
              <div className="flex flex-col gap-1 self-center text-xs">
                <button type="button" disabled={saving === r.name} onClick={() => save(r.name, "hide")} className="rounded border border-line px-2 py-1 hover:border-brand">
                  지도 사용
                </button>
                {(r.current.kind === "직접 지정" || r.current.kind === "숨김") && (
                  <button type="button" disabled={saving === r.name} onClick={() => save(r.name, null)} className="rounded border border-line px-2 py-1 text-muted hover:border-brand">
                    지정 해제
                  </button>
                )}
                {r.homepage && (
                  <a href={r.homepage} target="_blank" rel="noopener noreferrer" className="text-brand underline">
                    홈페이지
                  </a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="py-8 text-center text-sm text-muted">조건에 맞는 단지가 없어요.</p>}
    </div>
  );
}

function Thumb({ label, src }: { label: string; src: string | null }) {
  return (
    <figure className="w-28">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded border border-line bg-[#eef2f0] text-xs text-muted">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          "지도"
        )}
      </div>
      <figcaption className="mt-0.5 truncate text-[11px] text-muted">{label}</figcaption>
    </figure>
  );
}
