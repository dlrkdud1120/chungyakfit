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
| `app/page.tsx`, `components/HomeDashboard.tsx` | 메인 화면(/): 내 청약 현황, 노려볼 단지, 1년 뒤 변화, 다가오는 분양공고. |
| `app/score/page.tsx` | 가점 계산 화면(/score)과 하단 "가점 계산 기준" 표. |
| `lib/benchmark.ts` | 내 점수와 관심 단지 평균 당첨 가점의 차이 계산. |
| `lib/anchors.ts` | 메인 화면에서 단지 비교의 특정 줄로 이동하는 주소 만들기. |
| `lib/score.ts` | 가점 계산 규칙 전부. 제도가 바뀌면 이 파일 맨 위 `RULES`만 고치면 됩니다. |
| `components/Calculator.tsx` | 입력 폼과 결과 표. 계산은 하지 않고 `score.ts`에 맡깁니다. |
| `app/layout.tsx` 아래 각 화면: `/` 홈, `/score` 가점 계산, `/compare` 단지 비교, `/location` 입지 점수, `/notice` 분양 공고 | |
| `app/layout.tsx` | 모든 페이지 공통 틀. 한국어 설정, 웹폰트, 브라우저 탭 제목. |
| `app/globals.css` | 색상(초록·주황)과 기본 글꼴. |
| `data/complexes.csv` | 청약홈 당첨가점을 직접 옮겨 적는 파일. `#`로 시작하는 줄은 무시. |
| `lib/csv.ts` | CSV를 줄·칸으로 나누는 도구. |
| `lib/complexes.ts` | CSV를 읽어 단지 목록으로 바꾸고, 잘못된 값을 경고로 모음. API로 바꿀 때 이 파일만 수정. |
| `lib/judge.ts` | 안정·도전·어려움 판정 기준. |
| `lib/myScore.ts` | 내 점수를 브라우저(localStorage)에 저장·불러오기. |
| `app/compare/page.tsx` | 단지 비교 페이지 주소(/compare). |
| `components/CompareList.tsx` | 단지 비교 표, 지역·판정 필터, 정렬. |
| `components/SiteNav.tsx` | 맨 위 메뉴 바. |

## 진행 단계

1. 가점 계산기 ✅
2. 단지 목록과 내 점수 비교 판정 ✅
3. 미래 점수 예측 ✅ (`lib/score.ts`의 `projectScores`, 시점은 `FUTURE_YEARS`)
4. 추첨제 물량 안내 ✅ (`lib/lottery.ts`, 기준값은 `LOTTERY_RULES`)
5. 입지 점수 ✅ (기준표 `lib/location.ts`, 데이터 `data/locations.csv`, 화면 `/location`)
6. 청약홈 공공데이터 API 연동 ✅ (분양 공고 화면 `/notices`)

## 청약홈 API 설정

분양정보 API는 공고와 공급세대수만 주고 당첨가점은 주지 않습니다. 당첨가점 판정은 계속 `data/complexes.csv`를 씁니다.

| 파일 | 역할 |
| --- | --- |
| `lib/applyhome.ts` | 서버에서만 청약홈 API를 부르는 코드. 키는 환경변수에서만 읽음. |
| `app/api/notices/route.ts` | 브라우저가 부르는 중계 주소(/api/notices). 키를 숨기는 역할. |
| `components/NoticeList.tsx` | 공고 목록 화면. 실패하면 complexes.csv 단지를 대신 보여줌. |
| `.env.example` | 환경변수 견본. 복사해서 `.env.local`로 사용. |

1. 공공데이터포털에서 "한국부동산원_청약홈 분양정보 조회 서비스" 활용신청 (개발계정 자동승인)
2. 마이페이지에서 일반 인증키(Decoding) 복사
3. 내 컴퓨터: `.env.example`을 복사해 `.env.local`을 만들고 `APPLYHOME_API_KEY=키` 입력 → `npm run dev` 다시 실행
4. Vercel: 프로젝트 Settings → Environment Variables에 `APPLYHOME_API_KEY` 추가 → Redeploy
