-- basic-lingo: cloud save, so the phone and the computer share one account.
-- Paste this into Supabase → SQL Editor → New query → Run. Safe to run again.

create table if not exists public.saves (
  user_id uuid primary key references auth.users (id) on delete cascade, -- deleted with the account
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint saves_size check (pg_column_size(data) < 2000000) -- about 2 MB per player is plenty
);

alter table public.saves enable row level security;

-- Every player can only see and change their own save
drop policy if exists "own save: read" on public.saves;
create policy "own save: read" on public.saves for select to authenticated using (user_id = auth.uid());
drop policy if exists "own save: insert" on public.saves;
create policy "own save: insert" on public.saves for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "own save: update" on public.saves;
create policy "own save: update" on public.saves for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.saves to authenticated;
