-- 청약핏 마이페이지용 테이블 (Supabase > SQL Editor에 통째로 붙여 넣고 Run)
-- 저장하는 것: 카카오 회원번호, 닉네임, 거주지(시·군), 계산된 점수 기록, 관심 공고, 최근 열람 공고, 캘린더에 담은 일정
-- 저장하지 않는 것: 생년월일, 혼인신고일, 주택 처분일, 가족 구성 같은 원래 입력값

create table if not exists users (
  kakao_id   text primary key,            -- 카카오 회원번호
  nickname   text not null default '',
  home_sido  text not null default '',    -- 거주지 시·도
  home_unit  text not null default '',    -- 거주지 시·군·구
  created_at timestamptz not null default now()
);

create table if not exists score_records (
  id         bigint generated always as identity primary key,
  kakao_id   text not null references users(kakao_id) on delete cascade,
  total      numeric not null,
  homeless   numeric not null,            -- 무주택기간 점수
  dependents numeric not null,            -- 부양가족 점수
  account    numeric not null,            -- 청약통장 점수
  base_date  date,                        -- 계산 기준일
  calc_date  date not null,               -- 계산해서 저장한 날 (한국 날짜)
  created_at timestamptz not null default now()
);
create index if not exists score_records_user on score_records (kakao_id, created_at desc);

create table if not exists favorites (
  kakao_id        text not null references users(kakao_id) on delete cascade,
  house_manage_no text not null,          -- 청약홈 주택관리번호
  name            text not null,
  sido            text not null default '',
  unit            text not null default '',
  house_ty        text,                   -- 판정에 쓸 주택형 (없으면 판정하지 않음)
  url             text,
  notice_date     date,
  schedule        jsonb,                  -- 담을 때의 공고 일정 (접수·발표·계약)
  last_verdict    text,                   -- 지난번 마이페이지에서 본 판정
  created_at      timestamptz not null default now(),
  primary key (kakao_id, house_manage_no)
);

create table if not exists recent_views (
  kakao_id        text not null references users(kakao_id) on delete cascade,
  house_manage_no text not null,
  name            text not null,
  sido            text not null default '',
  unit            text not null default '',
  viewed_at       timestamptz not null default now(),
  primary key (kakao_id, house_manage_no)
);

create table if not exists calendar_items (
  kakao_id        text not null references users(kakao_id) on delete cascade,
  house_manage_no text not null,
  event_key       text not null,          -- special, rank1, rank2, winner, contract
  label           text not null,
  start_date      date not null,
  end_date        date not null,
  added_at        timestamptz not null default now(),
  primary key (kakao_id, house_manage_no, event_key)
);

-- 브라우저에서 직접 읽고 쓰지 못하게 잠급니다. 앱 서버만 비밀 키(Secret key)로 접근합니다.
alter table users          enable row level security;
alter table score_records  enable row level security;
alter table favorites      enable row level security;
alter table recent_views   enable row level security;
alter table calendar_items enable row level security;
