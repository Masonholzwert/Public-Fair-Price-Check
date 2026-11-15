-- basic-lingo online features: leaderboards and shared sandbox programs.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run again: it only creates what is missing.

-- ---------- Players ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null default 'PLAYER' check (char_length(nickname) between 1 and 16),
  created_at timestamptz not null default now()
);

-- Nicknames are unique (not case-sensitive), so nobody can pose as someone else
create unique index if not exists profiles_nickname_unique on public.profiles (lower(nickname));

-- One row of stats per player, sent by the app after learning
create table if not exists public.stats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  current_streak int not null default 0 check (current_streak between 0 and 100000),
  best_streak int not null default 0 check (best_streak between 0 and 100000),
  units_done int not null default 0 check (units_done between 0 and 1000),
  programs int not null default 0 check (programs between 0 and 100000),
  program_lines int not null default 0 check (program_lines between 0 and 10000000),
  xp int not null default 0 check (xp between 0 and 10000000),
  updated_at timestamptz not null default now()
);

-- ---------- Shared sandbox programs ----------

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id text not null check (course_id in ('basic', '6502', 'fortran', 'c', 'pascal', 'altair', 'cobol')),
  name text not null check (char_length(name) between 1 and 24),
  code text not null check (char_length(code) between 1 and 20000),
  likes int not null default 0,
  reports int not null default 0,
  hidden boolean not null default false, -- hidden automatically after 3 reports
  created_at timestamptz not null default now()
);
create index if not exists programs_course_idx on public.programs (course_id, hidden, likes desc, created_at desc);

create table if not exists public.likes (
  program_id uuid references public.programs (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  primary key (program_id, user_id)
);

create table if not exists public.reports (
  program_id uuid references public.programs (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  reason text check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (program_id, user_id)
);

-- Keep the like and report counters up to date, and hide reported programs
create or replace function public.count_likes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update programs set likes = (select count(*) from likes where program_id = coalesce(new.program_id, old.program_id))
    where id = coalesce(new.program_id, old.program_id);
  return null;
end $$;
drop trigger if exists likes_count on public.likes;
create trigger likes_count after insert or delete on public.likes for each row execute function public.count_likes();

create or replace function public.count_reports() returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from reports where program_id = new.program_id;
  update programs set reports = n, hidden = (n >= 3) where id = new.program_id;
  return null;
end $$;
drop trigger if exists reports_count on public.reports;
create trigger reports_count after insert on public.reports for each row execute function public.count_reports();

-- Programs can't change their own counters
create or replace function public.protect_counters() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then
    new.likes := old.likes; new.reports := old.reports; new.hidden := old.hidden; new.user_id := old.user_id;
  end if;
  return new;
end $$;
drop trigger if exists programs_protect on public.programs;
create trigger programs_protect before update on public.programs for each row execute function public.protect_counters();

-- ---------- Leaderboards ----------

create or replace view public.leaderboard with (security_invoker = false) as
  select s.user_id, p.nickname, s.current_streak, s.best_streak, s.units_done, s.programs, s.program_lines, s.xp,
    coalesce((select sum(likes) from programs g where g.user_id = s.user_id and not g.hidden), 0)::int as likes
  from stats s join profiles p on p.id = s.user_id;

-- Shared programs with the author's nickname. Hidden (reported) programs are left out.
create or replace view public.shared_programs with (security_invoker = false) as
  select g.id, g.user_id, g.course_id, g.name, g.code, g.likes, g.created_at, coalesce(p.nickname, 'PLAYER') as nickname
  from programs g left join profiles p on p.id = g.user_id
  where not g.hidden;

-- ---------- Security: who may read and write what ----------

alter table public.profiles enable row level security;
alter table public.stats enable row level security;
alter table public.programs enable row level security;
alter table public.likes enable row level security;
alter table public.reports enable row level security;

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select using (true);
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "stats readable" on public.stats;
create policy "stats readable" on public.stats for select using (true);
drop policy if exists "own stats" on public.stats;
create policy "own stats" on public.stats for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "programs readable" on public.programs;
create policy "programs readable" on public.programs for select using (not hidden or auth.uid() = user_id);
drop policy if exists "share own programs" on public.programs;
create policy "share own programs" on public.programs for insert with check (auth.uid() = user_id);
drop policy if exists "delete own programs" on public.programs;
create policy "delete own programs" on public.programs for delete using (auth.uid() = user_id);

drop policy if exists "likes readable" on public.likes;
create policy "likes readable" on public.likes for select using (auth.uid() = user_id);
drop policy if exists "own likes" on public.likes;
create policy "own likes" on public.likes for insert with check (auth.uid() = user_id);
drop policy if exists "remove own likes" on public.likes;
create policy "remove own likes" on public.likes for delete using (auth.uid() = user_id);

drop policy if exists "own reports" on public.reports;
create policy "own reports" on public.reports for insert with check (auth.uid() = user_id);

grant select on public.leaderboard to anon, authenticated;
grant select on public.shared_programs to anon, authenticated;

-- ---------- Deleting your account (required by the App Store) ----------

create or replace function public.delete_own_account() returns void language plpgsql security definer set search_path = public, auth as $$
begin
  delete from auth.users where id = auth.uid(); -- profiles, stats, programs, likes and reports go with it
end $$;
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
-- Daily challenge: one result per player per day, and today's leaderboard.
-- Run this once in the Supabase SQL editor.

create table if not exists public.daily_results (
  day date not null,
  user_id uuid not null references auth.users on delete cascade,
  challenge_id text not null,
  course_id text not null,
  seconds int not null check (seconds >= 0 and seconds <= 172800),
  runs int not null default 1 check (runs >= 1),
  hints int not null default 0 check (hints >= 0),
  created_at timestamptz not null default now(),
  primary key (day, user_id)
);

alter table public.daily_results enable row level security;

drop policy if exists "daily readable" on public.daily_results;
create policy "daily readable" on public.daily_results for select using (true);
-- You can only add your own result, only for today or yesterday (UTC), and never change it afterwards
drop policy if exists "own daily result" on public.daily_results;
create policy "own daily result" on public.daily_results for insert
  with check (auth.uid() = user_id and day between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date);

create or replace view public.daily_board with (security_invoker = false) as
  select d.day, d.user_id, coalesce(p.nickname, 'PLAYER') as nickname, d.challenge_id, d.course_id, d.seconds, d.runs, d.hints
  from daily_results d left join profiles p on p.id = d.user_id;

grant select on public.daily_board to anon, authenticated;
