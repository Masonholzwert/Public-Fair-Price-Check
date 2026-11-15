-- basic-lingo: accounts with e-mail + password.
-- Paste this into Supabase → SQL Editor → New query → Run. Safe to run again.

-- Is a nickname still free? (Asked by the sign-up screen before the account exists.)
create or replace function public.nickname_available(name text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where lower(nickname) = lower(trim(name)));
$$;
revoke all on function public.nickname_available(text) from public;
grant execute on function public.nickname_available(text) to anon, authenticated;

-- Every new account gets its profile right away, with the nickname from the sign-up screen
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'nickname'), ''), 'PLAYER-' || left(new.id::text, 4)), 16))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
