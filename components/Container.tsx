/**
 * 콘텐츠 컨테이너 (앱 전체 공용)
 * 상단 바, 페이지 제목·설명·구분선, 모든 섹션, 맨 아래 안내가 이 폭 안에 들어가
 * 왼쪽 끝과 오른쪽 끝이 같은 선에 맞습니다.
 *   Container: 최대 880px, 가운데 정렬, 좌우 여백 24px(모바일 16px)
 *   Narrow:    단계별 화면처럼 내용이 적은 페이지용. 최대 560px, 가운데 정렬 (Container 안에서 사용)
 */

type Props = { as?: "div" | "main" | "footer"; className?: string; children: React.ReactNode };

export default function Container({ as: Tag = "div", className = "", children }: Props) {
  return <Tag className={`mx-auto w-full max-w-[880px] px-4 sm:px-6 ${className}`}>{children}</Tag>;
}

export function Narrow({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[560px]">{children}</div>;
}
