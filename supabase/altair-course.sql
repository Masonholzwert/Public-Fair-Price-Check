-- basic-lingo: allow shared sandbox programs for the new Altair 8800 course.
-- Paste this into Supabase → SQL Editor → New query → Run. Safe to run again.
alter table public.programs drop constraint if exists programs_course_id_check;
alter table public.programs add constraint programs_course_id_check check (course_id in ('basic', '6502', 'fortran', 'c', 'pascal', 'altair'));
