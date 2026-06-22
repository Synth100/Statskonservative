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
  source_page text not null default 'statskonservative-homepage',
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.signups enable row level security;

revoke all on table public.signups from anon, authenticated;

alter table public.signups
  alter column source_page set default 'statskonservative-homepage';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'signups_postcode_format_check'
  ) then
    alter table public.signups
      add constraint signups_postcode_format_check
      check (postcode is null or postcode ~ '^[0-9]{4}$');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'signups_interest_area_check'
  ) then
    alter table public.signups
      add constraint signups_interest_area_check
      check (
        interest_area is null
        or interest_area in (
          'membership',
          'newsletter',
          'volunteering',
          'local-branch',
          'general'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'signups_source_page_length_check'
  ) then
    alter table public.signups
      add constraint signups_source_page_length_check
      check (char_length(trim(source_page)) between 1 and 80);
  end if;
end $$;

create table if not exists public.signup_rate_limits (
  scope text not null,
  identifier_hash text not null,
  window_start timestamptz not null,
  attempts integer not null default 1 check (attempts > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, identifier_hash, window_start)
);

alter table public.signup_rate_limits enable row level security;

revoke all on table public.signup_rate_limits from anon, authenticated;

create or replace function public.record_signup_attempt(
  p_scope text,
  p_identifier_hash text,
  p_window_start timestamptz,
  p_max_attempts integer
)
returns table(allowed boolean, attempts integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_attempts integer;
begin
  if p_scope not in ('signup_ip', 'signup_email') then
    raise exception 'Invalid rate limit scope';
  end if;

  if p_identifier_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid rate limit identifier';
  end if;

  insert into public.signup_rate_limits (
    scope,
    identifier_hash,
    window_start,
    attempts
  )
  values (
    p_scope,
    p_identifier_hash,
    p_window_start,
    1
  )
  on conflict (scope, identifier_hash, window_start)
  do update set
    attempts = public.signup_rate_limits.attempts + 1,
    updated_at = now()
  returning public.signup_rate_limits.attempts into current_attempts;

  return query
    select current_attempts <= p_max_attempts, current_attempts;
end;
$$;

revoke all on function public.record_signup_attempt(text, text, timestamptz, integer)
  from public, anon, authenticated;

grant execute on function public.record_signup_attempt(text, text, timestamptz, integer)
  to service_role;

comment on table public.signups is
  'Political website signups collected via the Statskonservative public website.';

comment on column public.signups.consent_text is
  'The exact consent text shown to the user when the signup was submitted.';

comment on column public.signups.source_page is
  'The page or form source that submitted the signup.';

comment on table public.signup_rate_limits is
  'Hashed IP/email rate limit counters for public signup submissions.';
