# 청약핏

내 청약 가점으로 관심 단지에 당첨 가능성이 있는지 알려주는 웹앱. 부동산프롭테크 기말 프로젝트.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:3000 을 엽니다.

## 파일 구조

| 파일 | 역할 |
| --- | --- |
| `lib/score.ts` | 가점 계산 규칙 전부. 제도가 바뀌면 이 파일 맨 위 `RULES`만 고치면 됩니다. |
| `components/Calculator.tsx` | 입력 폼과 결과 표. 계산은 하지 않고 `score.ts`에 맡깁니다. |
| `app/page.tsx` | 첫 화면. 제목, 계산기, 하단 안내 문구를 배치합니다. |
| `app/layout.tsx` | 모든 페이지 공통 틀. 한국어 설정, 웹폰트, 브라우저 탭 제목. |
| `app/globals.css` | 색상(초록·주황)과 기본 글꼴. |
| `data/complexes.json` | 단지 데이터(지금은 가상 예시, `isSample: true`). |
| `lib/complexes.ts` | 단지 데이터를 읽어오는 곳. API로 바꿀 때 이 파일만 수정. |
| `lib/judge.ts` | 안정·도전·어려움 판정 기준. |
| `lib/myScore.ts` | 내 점수를 브라우저(localStorage)에 저장·불러오기. |
| `app/compare/page.tsx` | 단지 비교 페이지 주소(/compare). |
| `components/CompareList.tsx` | 단지 비교 표, 지역·판정 필터, 정렬. |
| `components/SiteNav.tsx` | 맨 위 메뉴 바. |

## 진행 단계

1. 가점 계산기 ✅
2. 단지 목록과 내 점수 비교 판정 ✅
3. 미래 점수 예측
4. 추첨제 물량 안내
5. 입지 점수
6. 청약홈 공공데이터 API 연동
