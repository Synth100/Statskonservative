create extension if not exists pgcrypto;

create table if not exists public.signups (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(trim(first_name)) between 2 and 80),
  last_name text not null check (char_length(trim(last_name)) between 2 and 80),
  email text not null unique check (email = lower(email)),
  postcode text,
  interest_area text,
  consent boolean not null default false,
  consent_text text not null,
  source_page text not null default 'homepage',
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.signups enable row level security;

revoke all on table public.signups from anon, authenticated;

comment on table public.signups is
  'Political website signups collected via the Statskonservative public website.';