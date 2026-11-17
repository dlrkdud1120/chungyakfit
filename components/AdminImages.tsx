"use client";

/**
 * 이미지 점검 표 (/admin/images)
 * 분양 공고마다 어떤 이미지가 쓰이는지 보여줍니다.
 * 자동 이미지는 우리 컴퓨터에서 `npm run collect-images`로 모아 data/auto-images.json에 적어 둔 것입니다.
 */

import { useCallback, useEffect, useState } from "react";
import type { Notice, NoticeResult } from "@/lib/applyhome";
import { imageFor, type ComplexImages } from "@/lib/complexImage";
import { PICK_RULES } from "@/lib/image-pick";

type Got = { ok: boolean; image?: string | null; homepage?: string | null; kind?: string; note?: string; checkedAt?: string };
type RowState = { status: "wait" | "loading" } | { status: "done"; got: Got };

const KIND_COLOR: Record<string, string> = {
  "직접 넣은 조감도": "text-brand",
  "자동 이미지": "text-ok",
  "직접 지정": "text-brand",
  지도: "text-muted",
  숨김: "text-muted",
};

export default function AdminImages({ images }: { images: ComplexImages }) {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [failed, setFailed] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const load = useCallback(async (no: string) => {
    setRows((r) => ({ ...r, [no]: { status: "loading" } }));
    const got = await fetch(`/api/og-image?no=${no}`)
      .then((r) => r.json() as Promise<Got>)
      .catch((): Got => ({ ok: false }));
    setRows((r) => ({ ...r, [no]: { status: "done", got } }));
  }, []);

  // 한꺼번에 몰리지 않게 세 개씩 차례로
  const loadAll = useCallback(
    async (list: Notice[]) => {
      const queue = [...list];
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          for (let n = queue.shift(); n; n = queue.shift()) await load(n.houseManageNo);
        }),
      );
    },
    [load],
  );

  useEffect(() => {
    let alive = true;
    fetch("/api/notices")
      .then((r) => r.json() as Promise<NoticeResult>)
      .catch((): NoticeResult => ({ ok: false, reason: "서버에 연결하지 못했습니다." }))
      .then((res) => {
        if (!alive) return;
        if (!res.ok) return setFailed(res.reason);
        setNotices(res.notices);
        void loadAll(res.notices);
      });
    return () => {
      alive = false;
    };
  }, [loadAll]);

  if (failed) return <p className="py-6 text-sm text-muted">공고를 불러오지 못했습니다. ({failed})</p>;
  if (!notices) return <p className="py-6 text-sm text-muted">공고를 불러오는 중…</p>;

  // 화면에 실제로 쓰이는 종류 (직접 넣은 조감도가 있으면 그게 먼저)
  const shownKind = (n: Notice): string | null => {
    if (imageFor(images, n.name)) return "직접 넣은 조감도";
    const r = rows[n.houseManageNo];
    return r?.status === "done" ? (r.got.kind ?? "지도") : null;
  };
  const counts: Record<string, number> = {};
  for (const n of notices) {
    const k = shownKind(n);
    if (k) counts[k] = (counts[k] ?? 0) + 1;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3 text-sm">
        <span>
          공고 {notices.length}건
          {Object.entries(counts).map(([k, c]) => (
            <span key={k} className="ml-3">
              <span className={KIND_COLOR[k] ?? ""}>{k}</span> {c}
            </span>
          ))}
        </span>
      </div>
      <p className="border-b border-line py-2 text-xs leading-relaxed text-muted">
        자동 이미지 기준: 가로 {PICK_RULES.minWidth}px 이상, 비율 {PICK_RULES.minRatio}~{PICK_RULES.maxRatio}, 복잡도(entropy) {PICK_RULES.minEntropy} 이상, 한 가지 색{" "}
        {Math.round(PICK_RULES.maxDominant * 100)}% 이하. 새 공고가 생기면 내 컴퓨터에서 npm run collect-images 를 실행한 뒤 올리세요.
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="py-2 font-normal">단지</th>
            <th className="py-2 font-normal">쓰는 이미지</th>
            <th className="py-2 font-normal">미리보기</th>
          </tr>
        </thead>
        <tbody>
          {notices.map((n) => {
            const manual = imageFor(images, n.name);
            const r = rows[n.houseManageNo];
            const got = r?.status === "done" ? r.got : null;
            const kind = shownKind(n);
            const src = manual?.src ?? got?.image ?? null;
            return (
              <tr key={n.houseManageNo} className="border-b border-line align-top">
                <td className="py-3 pr-3">
                  <div className="font-medium">{n.name}</div>
                  <div className="text-xs text-muted">
                    {n.region} {n.unit} · {n.houseManageNo}
                  </div>
                  {n.homepage && (
                    <a href={n.homepage} target="_blank" rel="noopener noreferrer" className="text-xs break-all text-brand underline">
                      {n.homepage}
                    </a>
                  )}
                </td>
                <td className="py-3 pr-3">
                  {kind ? <span className={`font-semibold ${KIND_COLOR[kind] ?? ""}`}>{kind}</span> : <span className="text-xs text-muted">확인 중…</span>}
                  {got && (
                    <div className="mt-0.5 text-xs text-muted">
                      {manual && got.kind !== "지도" && `조감도가 없었다면: ${got.kind} · `}
                      {got.note}
                      {got.checkedAt && ` · 확인 ${got.checkedAt}`}
                    </div>
                  )}
                </td>
                <td className="py-3 pr-3">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-[60px] w-20 rounded border border-line object-cover" />
                  ) : (
                    <span className="text-xs text-muted">지도</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        엉뚱한 이미지가 걸린 단지는 data/image-overrides.json에 &ldquo;단지명&rdquo;: &ldquo;hide&rdquo; (지도로) 또는 &ldquo;단지명&rdquo;: &ldquo;이미지
        주소&rdquo;를 적으세요. 고르는 기준값은 lib/image-pick.ts의 PICK_RULES에 있어요.
      </p>
    </div>
  );
}
