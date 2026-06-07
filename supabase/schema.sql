-- ─────────────────────────────────────────────────────────────
-- 명함 · 영수증 스캐너 — Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.users (
  name        text primary key,
  pin         text not null default '',
  cards       jsonb not null default '[]'::jsonb,
  receipts    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

-- RLS를 켜고 정책은 만들지 않는다.
-- → anon/authenticated 키로는 어떤 행에도 접근 불가.
-- → 오직 서버리스 함수의 service-role 키만 접근 가능(RLS 우회).
-- 이렇게 해야 브라우저에서 DB를 직접 읽어 다른 사용자 PIN/데이터를 보는 일이 불가능하다.
alter table public.users enable row level security;

-- (혹시 이전에 만든 정책이 있다면 정리)
-- drop policy if exists "..." on public.users;
