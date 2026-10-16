-- ============================================================
-- Basketball Playbook — Supabase schema
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- ---------- extensions ----------
create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ---------- plays ----------
create table if not exists public.plays (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  category    text,
  court_type  text not null default 'half' check (court_type in ('full','half')),
  diagram     jsonb not null default '{"courtType":"half","elements":[]}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.play_videos (
  id           uuid primary key default gen_random_uuid(),
  play_id      uuid not null references public.plays(id) on delete cascade,
  storage_path text not null,
  title        text,
  created_at   timestamptz not null default now()
);
create index if not exists play_videos_play_id_idx on public.play_videos(play_id);

-- ---------- stats ----------
create table if not exists public.players (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  number   int,
  position text,
  active   boolean not null default true
);

create table if not exists public.games (
  id         uuid primary key default gen_random_uuid(),
  opponent   text not null,
  played_on  date not null default current_date,
  location   text,
  notes      text,
  created_at timestamptz not null default now()
);

-- Append-only event log (immutable audit trail). Box scores are derived.
create table if not exists public.stat_events (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  stat       text not null check (stat in (
    'fg_made','fg_miss','three_made','three_miss','ft_made','ft_miss',
    'rebound_off','rebound_def','assist','steal','block','turnover','foul'
  )),
  created_at timestamptz not null default now()
);
create index if not exists stat_events_game_idx on public.stat_events(game_id);

-- ---------- storage bucket for video clips ----------
insert into storage.buckets (id, name, public)
values ('play-videos', 'play-videos', true)
on conflict (id) do nothing;

-- ============================================================
-- Row Level Security
-- ------------------------------------------------------------
-- DEV MODE (default below): allows the anon key full access so the
-- app runs immediately on your machine with no login screen.
-- This is fine for a local / single-coach tool on a trusted network.
--
-- BEFORE exposing this to the internet: drop the dev policies and use
-- the AUTHENTICATED policies at the bottom (and add a login screen),
-- so financial/roster data isn't world-writable.
-- ============================================================
alter table public.plays        enable row level security;
alter table public.play_videos  enable row level security;
alter table public.players      enable row level security;
alter table public.games        enable row level security;
alter table public.stat_events  enable row level security;

-- ----- DEV policies (anon = full access) -----
create policy dev_all_plays       on public.plays       for all to anon using (true) with check (true);
create policy dev_all_play_videos on public.play_videos for all to anon using (true) with check (true);
create policy dev_all_players     on public.players     for all to anon using (true) with check (true);
create policy dev_all_games       on public.games       for all to anon using (true) with check (true);
create policy dev_all_stat_events on public.stat_events for all to anon using (true) with check (true);

-- storage: allow anon read + write to the play-videos bucket (dev)
create policy dev_video_read  on storage.objects for select to anon using (bucket_id = 'play-videos');
create policy dev_video_write on storage.objects for insert to anon with check (bucket_id = 'play-videos');
create policy dev_video_del   on storage.objects for delete to anon using (bucket_id = 'play-videos');

-- ============================================================
-- PRODUCTION policies: see the "Supabase Auth" migration at the bottom of this
-- file. It drops every dev_* policy above and replaces it with the
-- authenticated-only equivalents, covering the tables added by the migrations
-- in between as well.
-- ============================================================

-- ============================================================
-- Migration: opponent scouting, quarter tracking, shot chart,
--            practice plans, substitution log
-- Apply in: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- Opponent scouting flag on plays
alter table public.plays add column if not exists is_scouting boolean not null default false;

-- Period/quarter tracking on stat events
alter table public.stat_events add column if not exists period smallint not null default 1;

-- Shot chart events
create table if not exists public.shot_events (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  x          float8 not null,
  y          float8 not null,
  made       boolean not null,
  period     smallint not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists shot_events_game_idx on public.shot_events(game_id);

-- Practice plan builder
create table if not exists public.practice_plans (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  planned_for date,
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.practice_plan_items (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.practice_plans(id) on delete cascade,
  play_id      uuid references public.plays(id) on delete set null,
  label        text,
  duration_min int not null default 5,
  sort_order   int not null default 0,
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists plan_items_plan_idx on public.practice_plan_items(plan_id);

-- Substitution log
create table if not exists public.sub_events (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references public.games(id) on delete cascade,
  player_id_in   uuid not null references public.players(id) on delete cascade,
  player_id_out  uuid not null references public.players(id) on delete cascade,
  period         smallint not null default 1,
  created_at     timestamptz not null default now()
);
create index if not exists sub_events_game_idx on public.sub_events(game_id);

-- RLS dev policies for new tables
create policy dev_all_shot_events  on public.shot_events  for all to anon using (true) with check (true);
create policy dev_all_plans        on public.practice_plans for all to anon using (true) with check (true);
create policy dev_all_plan_items   on public.practice_plan_items for all to anon using (true) with check (true);
create policy dev_all_sub_events   on public.sub_events   for all to anon using (true) with check (true);

alter table public.shot_events       enable row level security;
alter table public.practice_plans    enable row level security;
alter table public.practice_plan_items enable row level security;
alter table public.sub_events        enable row level security;

-- ============================================================
-- Migration: practice plans are date-titled + take video clips
-- Apply in: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- Plans are identified by the date they're planned for, so a name is optional.
alter table public.practice_plans alter column name drop not null;

-- Clips attached to a whole practice plan (reuses the play-videos bucket).
create table if not exists public.practice_plan_videos (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.practice_plans(id) on delete cascade,
  storage_path text not null,
  title        text,
  created_at   timestamptz not null default now()
);
create index if not exists plan_videos_plan_idx on public.practice_plan_videos(plan_id);

alter table public.practice_plan_videos enable row level security;
create policy dev_all_plan_videos on public.practice_plan_videos for all to anon using (true) with check (true);
-- Production equivalent (see the hardening notes above):
-- create policy auth_all_plan_videos on public.practice_plan_videos for all to authenticated using (true) with check (true);

-- ============================================================
-- Migration: Supabase Auth — lock every table to signed-in users
-- Apply in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Run this AFTER you have:
--   1. Enabled Authentication → Providers → Email, and
--   2. Created at least one user (sign up through the app's login screen, or
--      Authentication → Users → Add user).
--
-- It revokes the anon key's access, so an app build without the login screen
-- will read and write nothing once this has run. Re-runnable: every policy is
-- dropped before it is created.
-- ============================================================

-- ----- drop the dev (anon) policies -----
drop policy if exists dev_all_plays        on public.plays;
drop policy if exists dev_all_play_videos  on public.play_videos;
drop policy if exists dev_all_players      on public.players;
drop policy if exists dev_all_games        on public.games;
drop policy if exists dev_all_stat_events  on public.stat_events;
drop policy if exists dev_all_shot_events  on public.shot_events;
drop policy if exists dev_all_plans        on public.practice_plans;
drop policy if exists dev_all_plan_items   on public.practice_plan_items;
drop policy if exists dev_all_plan_videos  on public.practice_plan_videos;
drop policy if exists dev_all_sub_events   on public.sub_events;
drop policy if exists dev_video_read       on storage.objects;
drop policy if exists dev_video_write      on storage.objects;
drop policy if exists dev_video_del        on storage.objects;

-- ----- authenticated policies -----
-- Shared model: any signed-in coach sees the whole program. There is no owner
-- column, so keep signups closed (Authentication → Sign In / Providers →
-- disable "Allow new users to sign up") and invite staff from the dashboard —
-- otherwise anyone who can register can read the roster.
drop policy if exists auth_all_plays        on public.plays;
drop policy if exists auth_all_play_videos  on public.play_videos;
drop policy if exists auth_all_players      on public.players;
drop policy if exists auth_all_games        on public.games;
drop policy if exists auth_all_stat_events  on public.stat_events;
drop policy if exists auth_all_shot_events  on public.shot_events;
drop policy if exists auth_all_plans        on public.practice_plans;
drop policy if exists auth_all_plan_items   on public.practice_plan_items;
drop policy if exists auth_all_plan_videos  on public.practice_plan_videos;
drop policy if exists auth_all_sub_events   on public.sub_events;

create policy auth_all_plays        on public.plays                for all to authenticated using (true) with check (true);
create policy auth_all_play_videos  on public.play_videos          for all to authenticated using (true) with check (true);
create policy auth_all_players      on public.players              for all to authenticated using (true) with check (true);
create policy auth_all_games        on public.games                for all to authenticated using (true) with check (true);
create policy auth_all_stat_events  on public.stat_events          for all to authenticated using (true) with check (true);
create policy auth_all_shot_events  on public.shot_events          for all to authenticated using (true) with check (true);
create policy auth_all_plans        on public.practice_plans       for all to authenticated using (true) with check (true);
create policy auth_all_plan_items   on public.practice_plan_items  for all to authenticated using (true) with check (true);
create policy auth_all_plan_videos  on public.practice_plan_videos for all to authenticated using (true) with check (true);
create policy auth_all_sub_events   on public.sub_events           for all to authenticated using (true) with check (true);

-- ----- storage: uploading and deleting clips now requires a session -----
-- NOTE: the play-videos bucket is still public, so anyone holding a clip's URL
-- can play it without signing in — these policies gate writes, not reads. To
-- close that, flip the bucket private (below) and switch resolveVideoUrl() in
-- usePlays.ts / usePracticePlan.ts from getPublicUrl() to createSignedUrl().
--   update storage.buckets set public = false where id = 'play-videos';
drop policy if exists auth_video_read  on storage.objects;
drop policy if exists auth_video_write on storage.objects;
drop policy if exists auth_video_del   on storage.objects;

create policy auth_video_read  on storage.objects for select to authenticated using (bucket_id = 'play-videos');
create policy auth_video_write on storage.objects for insert to authenticated with check (bucket_id = 'play-videos');
create policy auth_video_del   on storage.objects for delete to authenticated using (bucket_id = 'play-videos');

-- ============================================================
-- Migration: practice plans carry a start and end time
-- Apply in: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- Wall-clock times, no zone: a practice at 4pm is at 4pm in the gym. The blocks
-- are laid out from start_time; end_time is the window the plan is judged
-- against. Both nullable — plans saved before this migration have neither.
alter table public.practice_plans add column if not exists start_time time;
alter table public.practice_plans add column if not exists end_time   time;

-- ============================================================
-- Migration: practice plans carry a motivational quote
-- Apply in: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- Printed at the top of the plan's first two pages. Pre-filled from a built-in
-- list when a plan is created, but free text — the coach can type their own.
-- Both nullable — plans saved before this migration have neither.
alter table public.practice_plans add column if not exists quote        text;
alter table public.practice_plans add column if not exists quote_author text;

-- ============================================================
-- Migration: games record the final score
-- Apply in: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- Entered by the coach once the game ends. Both nullable — a game in progress
-- (or saved before this migration) has no final score yet.
alter table public.games add column if not exists our_score int check (our_score >= 0);
alter table public.games add column if not exists opp_score int check (opp_score >= 0);

-- ============================================================
-- Migration: restrict access to an allow-list of coaching staff
-- Apply in: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- Until now every policy was `to authenticated using (true)`, so anyone who
-- could create an account could read and change the whole program. Access now
-- requires the signed-in email to be on this list.
create table if not exists public.staff (
  email      text primary key,
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;
-- No policies on staff itself: it's managed from the SQL editor / dashboard,
-- and is_staff() below reads it as the table owner.

-- Seed with the accounts that exist today so nobody is locked out by running
-- this. REVIEW THE RESULT and delete anyone who isn't coaching staff:
--   select * from public.staff;
--   delete from public.staff where email = 'someone@example.com';
-- To add a coach later: create their account (Authentication → Users → Add
-- user → Create new user, with a password) and allow-list the email:
--   insert into public.staff (email) values ('coach@example.com');
insert into public.staff (email)
select lower(email) from auth.users where email is not null
on conflict do nothing;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.is_staff() to authenticated;

drop policy if exists auth_all_plays        on public.plays;
drop policy if exists auth_all_play_videos  on public.play_videos;
drop policy if exists auth_all_players      on public.players;
drop policy if exists auth_all_games        on public.games;
drop policy if exists auth_all_stat_events  on public.stat_events;
drop policy if exists auth_all_shot_events  on public.shot_events;
drop policy if exists auth_all_plans        on public.practice_plans;
drop policy if exists auth_all_plan_items   on public.practice_plan_items;
drop policy if exists auth_all_plan_videos  on public.practice_plan_videos;
drop policy if exists auth_all_sub_events   on public.sub_events;

create policy auth_all_plays        on public.plays                for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy auth_all_play_videos  on public.play_videos          for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy auth_all_players      on public.players              for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy auth_all_games        on public.games                for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy auth_all_stat_events  on public.stat_events          for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy auth_all_shot_events  on public.shot_events          for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy auth_all_plans        on public.practice_plans       for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy auth_all_plan_items   on public.practice_plan_items  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy auth_all_plan_videos  on public.practice_plan_videos for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy auth_all_sub_events   on public.sub_events           for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Clips: private bucket (the app now plays them through signed URLs) and
-- staff-only read/write/delete.
update storage.buckets set public = false where id = 'play-videos';

drop policy if exists auth_video_read  on storage.objects;
drop policy if exists auth_video_write on storage.objects;
drop policy if exists auth_video_del   on storage.objects;

create policy auth_video_read  on storage.objects for select to authenticated using (bucket_id = 'play-videos' and public.is_staff());
create policy auth_video_write on storage.objects for insert to authenticated with check (bucket_id = 'play-videos' and public.is_staff());
create policy auth_video_del   on storage.objects for delete to authenticated using (bucket_id = 'play-videos' and public.is_staff());

-- Also turn off public sign-ups: Authentication → Sign In / Providers →
-- disable "Allow new users to sign up". The app no longer offers sign-up.

-- ============================================================
-- Migration: never cascade-delete a player's stats
-- Apply in: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- The app now retires players (players.active = false) instead of deleting
-- them. These constraints make sure a delete from anywhere else can't silently
-- wipe their stats, shots and subs either: it fails while history exists.
alter table public.stat_events drop constraint if exists stat_events_player_id_fkey;
alter table public.stat_events add constraint stat_events_player_id_fkey
  foreign key (player_id) references public.players(id) on delete restrict;

alter table public.shot_events drop constraint if exists shot_events_player_id_fkey;
alter table public.shot_events add constraint shot_events_player_id_fkey
  foreign key (player_id) references public.players(id) on delete restrict;

alter table public.sub_events drop constraint if exists sub_events_player_id_in_fkey;
alter table public.sub_events add constraint sub_events_player_id_in_fkey
  foreign key (player_id_in) references public.players(id) on delete restrict;

alter table public.sub_events drop constraint if exists sub_events_player_id_out_fkey;
alter table public.sub_events add constraint sub_events_player_id_out_fkey
  foreign key (player_id_out) references public.players(id) on delete restrict;
