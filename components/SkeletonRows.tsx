/**
 * 불러오는 중 뼈대 — 실제 목록 행과 같은 자리·높이의 회색 줄 (모든 목록 화면 공용)
 *
 * 청약홈 API가 몇 초 걸리는 동안 빈 화면 대신 보여 줍니다. 카드가 아니라 얇은 구분선이 있는 행 모양입니다.
 * 반짝이는 효과는 app/globals.css의 .skeleton (동작 줄이기 설정이면 멈춘 회색).
 * 화면 읽기 프로그램에는 label 문구 한 줄만 읽힙니다.
 */

export default function SkeletonRows({
  label,
  rows = 4,
  thumb = true,
  className = "",
}: {
  label: string; // 예: "청약홈에서 공고를 불러오는 중"
  rows?: number;
  thumb?: boolean; // 왼쪽 썸네일 자리
  className?: string;
}) {
  // 줄마다 글자 길이를 조금씩 달리해 실제 목록처럼 보이게
  const widths = ["w-2/5", "w-1/2", "w-1/3", "w-[45%]", "w-2/5", "w-1/2"];
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}…</span>
      <ul aria-hidden className="border-t border-line">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-center gap-3 border-b border-line py-3">
            {thumb && <span className="skeleton h-12 w-16 shrink-0" />}
            <span className="min-w-0 flex-1 space-y-2">
              <span className={`skeleton block h-3.5 ${widths[i % widths.length]}`} />
              <span className="skeleton block h-3 w-1/4" />
            </span>
            <span className="skeleton h-3 w-14 shrink-0" />
          </li>
        ))}
      </ul>
      <p aria-hidden className="mt-3 text-xs text-muted">
        {label}…
      </p>
    </div>
  );
}
