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
| `app/layout.tsx` | 모든 페이지 공통 틀. 한국어 설정, 웹폰트, 브라우저 탭 제목. |
| `app/globals.css` | 색상(초록·주황)과 기본 글꼴. |
| `data/complexes.csv` | API가 실패할 때 쓰는 예비 데이터. 청약홈 당첨가점을 직접 옮겨 적는 파일(`#` 줄은 무시). |
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
6. 청약홈 공공데이터 API 연동 ✅ (분양 공고 화면 `/notice`)
7. 원하는 단지 당첨 가능성 확인 ✅ (`/check`)


## 당첨 가능성 확인 (/check) — 핵심 기능

원하는 단지를 고르면 같은 지역·같은 면적대의 최근 과거 당첨가점과 내 가점을 비교합니다.

| 파일 | 역할 |
| --- | --- |
| `lib/similar.ts` | "비슷한 사례" 기준(`SIMILAR_RULES`: 기간·면적대·최소 사례 수), 해당지역/기타지역 판단, 판정용 최저·평균 계산. |
| `lib/applyhome.ts` | 분양정보 + 당첨가점 API를 주택관리번호로 이어 붙여 과거 이력을 만듦(하루 캐시). |
| `app/api/similar/route.ts` | 비슷한 사례를 찾아 돌려주는 서버 주소. 내 가점은 서버로 보내지 않음. |
| `components/CheckPossibility.tsx` | 가능성 확인 화면. 판정은 `lib/judge.ts`를 그대로 사용. |
| `lib/myHome.ts` | 내 거주지를 브라우저에 저장. |
| `lib/competition.ts` | 청약 경쟁률(getAPTLttotPblancCmpet) 읽기·표시 도구. 1순위 내 거주 구분 경쟁률을 대표로 고르고, 미달(△n)을 구분. 판정에는 쓰지 않음. |
| `check-cmpet.mjs` | 경쟁률 API 응답 확인용 스크립트 (`node check-cmpet.mjs`). |
| `check-api.mjs` | 청약홈 API 응답 확인용 스크립트 (`node check-api.mjs`). |

필요한 활용신청: 분양정보 조회 서비스, 청약접수 경쟁률 및 특별공급 신청현황 조회 서비스 (같은 인증키 사용).

## 부적격 위험 점검 (/score 아래, /eligibility)

| 파일 | 역할 |
| --- | --- |
| `lib/eligibility-check.ts` | 점검 규칙과 문구 전부(무주택 기산일, 세대원 주택 소유, 해당지역/기타지역, 부양가족 본인 제외, 공고 규제 조건 설명). |
| `components/EligibilityCheck.tsx` | 질문과 "확인됨 / 다시 확인 필요" 결과 화면. 입력값은 저장하지 않음. |
| `app/eligibility/page.tsx` | 점검만 따로 여는 페이지. `?no=주택관리번호`로 공고를 고른 채 열 수 있음. |

## 캘린더 추가 (분양 공고, 가능성 확인)

| 파일 | 역할 |
| --- | --- |
| `lib/calendar.ts` | 공고 일정(특별공급·1순위·2순위 접수, 당첨자 발표, 계약 시작) 정리와 .ics 파일 만들기. 하루 전 오전 9시(한국시간) 알림. |
| `components/CalendarButton.tsx` | "내 캘린더에 추가" 버튼. 브라우저에서 바로 파일을 만들어 내려받음(서버 저장 없음). |

## 카카오 로그인(선택)과 마이페이지 (/mypage)

로그인은 선택입니다. 로그인하지 않으면 서버에 아무것도 저장하지 않고 기존 기능은 그대로 동작합니다.
저장하는 것: 카카오 회원번호, 닉네임, 계산된 점수 기록, 거주지(시·군), 관심 공고, 최근 열람 공고, 캘린더에 담은 일정.
저장하지 않는 것: 생년월일, 혼인신고일, 주택 처분일, 가족 구성 같은 원래 입력값.

| 파일 | 역할 |
| --- | --- |
| `lib/auth.ts`, `app/api/auth/[...nextauth]/route.ts` | Auth.js 카카오 로그인. 동의 항목은 닉네임만, 쿠키에는 회원번호와 닉네임만. |
| `lib/db.ts`, `supabase/schema.sql` | Supabase 저장소(서버 전용)와 테이블 만드는 SQL. |
| `lib/meApi.ts`, `app/api/me/**` | 내 데이터 주소(/api/me…). 로그인한 사람만, 자기 데이터만. |
| `lib/meTypes.ts`, `lib/mySchedule.ts`, `lib/growth.ts` | 저장 데이터 모양, 다음 일정·D-day 계산, 성장 단계 이름. |
| `components/Providers.tsx` | 로그인 상태와 내 데이터를 모든 화면에 나눠 줌. 점수를 저장하면 계정에도 기록. |
| `components/KakaoLogin.tsx` | 로그인 버튼, 내비게이션 오른쪽 메뉴, 별을 눌렀을 때 로그인 안내, 계정으로 옮기기 안내. |
| `components/FavoriteStar.tsx` | 관심 공고 별 표시 (분양 공고·단지 비교·가능성 확인). |
| `components/MyPage.tsx`, `app/mypage/page.tsx` | 마이페이지: 점수 기록, 관심 공고, 달력, 최근 열람, 계정. |

환경변수(`.env.local`과 Vercel 둘 다): `AUTH_SECRET`, `AUTH_KAKAO_ID`(비우면 `KAKAO_REST_KEY` 사용), `AUTH_KAKAO_SECRET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.
카카오 Redirect URI: `http://localhost:3000/api/auth/callback/kakao`, `https://내주소.vercel.app/api/auth/callback/kakao`.

## 화면 구성과 이동 방식

한 화면에 섹션은 세 개까지만 두고, 자세한 정보는 "자세히 보기"로 접어 둡니다. 단계와 상세 화면은 주소에 반영되어 브라우저 뒤로 가기로 돌아갈 수 있습니다.

| 파일 | 역할 |
| --- | --- |
| `components/SiteNav.tsx` | 위 바(메뉴 버튼·아이콘·로그인), 왼쪽 메뉴 판, 모바일 하단 탭 4개. |
| `components/Fold.tsx` | "자세히 보기" 접기 부품 (공용). |
| `components/Calculator.tsx`, `components/scoreDraft.ts` | 가점 계산을 한 화면에 한 질문씩(`/score?step=2`). 입력값은 이 브라우저 탭 안에만 보관. |
| `components/CheckPossibility.tsx` | 가능성 확인: 고르기(`/check`) → 결과(`/check?no=…&view=result`). |
| `components/CompareList.tsx` | 단지 비교: 목록(`/compare`) → 상세(`/compare?id=…&t=…`). |
| `components/NoticeList.tsx`, `components/useNoticeVerdict.ts` | 분양 공고: 목록(`/notice`) → 상세(`/notice?no=…`), 공고별 내 판정. |
| `components/HomeDashboard.tsx` | 홈: 내 점수 한 줄, 노려볼 단지 3개, 다가오는 분양공고 3개. |

## 앱 아이콘

| 파일 | 역할 |
| --- | --- |
| `public/icons/icon.svg` | 아이콘 원본. |
| `app/icon.svg` | 브라우저 탭 파비콘(작은 크기용, 선이 조금 굵음). |
| `app/apple-icon.png` | 아이폰 홈 화면 아이콘(180×180). |
| `app/manifest.ts`, `public/icons/icon-192.png`, `icon-512.png` | 안드로이드 홈 화면 추가용 앱 정보와 아이콘. |
| `scripts/make-icons.mjs` | 원본 SVG에서 PNG를 다시 만드는 도구 (`node scripts/make-icons.mjs`). 앱 실행과는 무관. |

## 청약홈 API 설정

분양정보 API는 공고와 공급세대수를, 경쟁률 API(getAptLttotPblancScore)는 주택형·거주구분별 당첨가점을 줍니다. 가능성 확인(/check)과 단지 비교(/compare)·메인·가점 계산의 평균 비교는 둘을 이어 붙인 과거 당첨가점(`/api/complexes`, `lib/useComplexes.ts`)을 쓰고, API가 실패할 때만 `data/complexes.csv`를 씁니다. API에는 가점제·추첨제 세대수가 없어 추첨제 안내는 CSV 데이터에서만 계산됩니다.

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

## 단지 썸네일 (조감도 / 위치 지도)

단지 비교·분양 공고·가능성 확인 화면의 단지명 옆에 이미지를 보여줍니다.

| 파일 | 역할 |
| --- | --- |
| `components/ComplexThumb.tsx` | 썸네일. 조감도 → 위치 지도 → 빈 칸 순서. 화면에 보일 때만 불러옴. |
| `lib/kakaoMap.ts` | 카카오맵 SDK 불러오기, 카카오맵 링크 만들기. |
| `lib/coords.ts`, `app/api/coords/route.ts` | 주소 → 좌표. coords.json(직접 입력) 먼저, 없으면 카카오 로컬 API 실시간 호출. |
| `data/coords.json` | 카카오가 못 찾는 단지의 좌표를 직접 적는 파일. |
| `lib/complexImage.ts` | 조감도를 단지명으로 연결. |
| `public/images/complexes/` | 조감도 이미지 폴더. |

- 카카오 로컬 API 결과(좌표·주소)는 카카오 운영정책상 저장·캐시하면 안 되므로 매번 실시간으로 부르고 저장하지 않습니다.
- 조감도: 이미지를 `public/images/complexes/`에 넣고 `data/complexes.csv`의 "조감도 파일명", "이미지 출처" 열에 적습니다. 단지명은 화면에 나오는 이름과 같게(띄어쓰기는 달라도 됨). 주택형을 비워 두면 조감도 등록용 줄로만 쓰입니다.
- 환경변수: `KAKAO_REST_KEY`(서버 전용), `NEXT_PUBLIC_KAKAO_JS_KEY`(지도용, 카카오에 도메인 등록 필요).
