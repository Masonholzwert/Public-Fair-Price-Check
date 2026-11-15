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
