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

-- ============================================================
-- Migration: stat-tracked scouting reports
-- Apply in: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- A scouting report is a game row flagged is_scouting: the coach tracks
-- another team's stats (from film or in the stands) with the same tracker.
-- For these rows scouted_team is who is being scouted, opponent is who they
-- played, and our_score / opp_score are the scouted team's / opponent's score.
alter table public.games add column if not exists is_scouting       boolean not null default false;
alter table public.games add column if not exists scouted_team      text;
alter table public.games add column if not exists scout_key_players text;
alter table public.games add column if not exists scout_offense     text;
alter table public.games add column if not exists scout_defense     text;

-- Scouted players live in the players table (so stat and shot events keep
-- their foreign keys) but carry the team they belong to; null = our roster.
-- Reports on the same team share its roster.
alter table public.players add column if not exists scout_team text;
create index if not exists players_scout_team_idx on public.players (scout_team);

-- ============================================================
-- Migration: roles (admin / coach / player) and teams
-- Apply in: Supabase Dashboard → SQL Editor → New query → Run
-- Then promote yourself:  update public.profiles set role = 'admin'
--                         where email = 'you@example.com';
-- ============================================================

-- Every account gets a profile with a role:
--   admin  — sees and manages everything; invites coaches, admins, players
--   coach  — sees and edits the teams they coach (or created); creates teams
--            and players, adds co-coaches, invites player logins
--   player — read-only access to the teams they're on
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text,
  role         text not null default 'player' check (role in ('admin', 'coach', 'player')),
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- New accounts (created by the invite-user Edge Function) take the role and
-- name it put in their metadata. Sign-ups are off, so only invites get here.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'player')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Existing staff accounts become coaches (promote yourself to admin above).
insert into public.profiles (id, email, role)
select u.id, lower(u.email), 'coach'
from auth.users u
where u.email is not null
  and (to_regclass('public.staff') is null
       or exists (select 1 from public.staff s where s.email = lower(u.email)))
on conflict (id) do nothing;

-- Teams, e.g. "Boys Varsity", "Girls JV". A team can have several coaches and
-- a player can be on several teams.
create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.team_coaches (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (team_id, user_id)
);
create table if not exists public.team_players (
  team_id   uuid not null references public.teams(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  primary key (team_id, player_id)
);
alter table public.teams        enable row level security;
alter table public.team_coaches enable row level security;
alter table public.team_players enable row level security;

-- Who made a player, the login a player signs in with, and (for a scouted
-- opponent's player) which of our teams scouted them.
alter table public.players add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid();
alter table public.players add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.players add column if not exists scout_for_team uuid references public.teams(id) on delete cascade;

-- Everything a team owns. Restrict: a team with games or plays can't be
-- deleted by accident.
alter table public.plays          add column if not exists team_id uuid references public.teams(id) on delete restrict;
alter table public.games          add column if not exists team_id uuid references public.teams(id) on delete restrict;
alter table public.practice_plans add column if not exists team_id uuid references public.teams(id) on delete restrict;
create index if not exists plays_team_idx          on public.plays (team_id);
create index if not exists games_team_idx          on public.games (team_id);
create index if not exists practice_plans_team_idx on public.practice_plans (team_id);

-- Put everything that exists today on one team (rename it in the app), with
-- every current coach on it, so nothing disappears when this runs.
do $$
declare t uuid;
begin
  if not exists (select 1 from public.teams) then
    insert into public.teams (name, created_by) values ('Boys Varsity', null) returning id into t;
    update public.plays          set team_id = t where team_id is null;
    update public.games          set team_id = t where team_id is null;
    update public.practice_plans set team_id = t where team_id is null;
    insert into public.team_players (team_id, player_id)
      select t, id from public.players where scout_team is null
      on conflict do nothing;
    update public.players set scout_for_team = t where scout_team is not null and scout_for_team is null;
    insert into public.team_coaches (team_id, user_id)
      select t, id from public.profiles where role in ('admin', 'coach')
      on conflict do nothing;
  end if;
end $$;

-- New rows must say which team they belong to.
alter table public.plays          alter column team_id set not null;
alter table public.games          alter column team_id set not null;
alter table public.practice_plans alter column team_id set not null;

-- ---------- access checks (security definer: they read past RLS) ----------
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false);
$$;

-- Coach (or creator) of the team, or an admin: may change its data.
create or replace function public.can_edit_team(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.my_role() = 'coach' and (
            exists (select 1 from public.team_coaches where team_id = t and user_id = auth.uid())
         or exists (select 1 from public.teams where id = t and created_by = auth.uid())));
$$;

-- Anyone above, plus players on the team: may see its data.
create or replace function public.can_view_team(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_edit_team(t)
      or exists (
           select 1 from public.team_players tp
           join public.players p on p.id = tp.player_id
           where tp.team_id = t and p.user_id = auth.uid());
$$;

-- "Signed in with a profile" replaces the old staff allow-list check.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

grant execute on function public.my_role()           to authenticated;
grant execute on function public.is_admin()          to authenticated;
grant execute on function public.can_edit_team(uuid) to authenticated;
grant execute on function public.can_view_team(uuid) to authenticated;
grant execute on function public.is_staff()          to authenticated;

-- A coach who creates a team coaches it.
create or replace function public.add_creator_as_coach()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null and public.my_role() = 'coach' then
    insert into public.team_coaches (team_id, user_id) values (new.id, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists teams_add_creator on public.teams;
create trigger teams_add_creator after insert on public.teams
  for each row execute function public.add_creator_as_coach();

-- Only admins change roles or emails; everyone may edit their own name. No
-- signed-in user (SQL Editor, the invite function's service role) is trusted.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.role is distinct from old.role or new.email is distinct from old.email) then
    raise exception 'Only an admin can change roles';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------- policies ----------
-- Drop the old allow-list policies.
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

-- profiles: your own; admins and coaches can see everyone (to pick co-coaches
-- and see who has a login); admins edit roles.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.my_role() in ('admin', 'coach'));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy profiles_delete on public.profiles for delete to authenticated using (public.is_admin());

-- teams
create policy teams_select on public.teams for select to authenticated using (public.can_view_team(id));
create policy teams_insert on public.teams for insert to authenticated
  with check (public.my_role() in ('admin', 'coach') and created_by = auth.uid());
create policy teams_update on public.teams for update to authenticated
  using (public.can_edit_team(id)) with check (public.can_edit_team(id));
create policy teams_delete on public.teams for delete to authenticated using (public.can_edit_team(id));

create policy team_coaches_select on public.team_coaches for select to authenticated using (public.can_view_team(team_id));
create policy team_coaches_write  on public.team_coaches for all    to authenticated
  using (public.can_edit_team(team_id)) with check (public.can_edit_team(team_id));
create policy team_players_select on public.team_players for select to authenticated using (public.can_view_team(team_id));
create policy team_players_write  on public.team_players for all    to authenticated
  using (public.can_edit_team(team_id)) with check (public.can_edit_team(team_id));

-- Team-owned tables: view with can_view_team, change with can_edit_team.
create policy plays_select on public.plays for select to authenticated using (public.can_view_team(team_id));
create policy plays_write  on public.plays for all    to authenticated
  using (public.can_edit_team(team_id)) with check (public.can_edit_team(team_id));
-- Scouting reports are coaches' material: players see only our own games.
create policy games_select on public.games for select to authenticated
  using (public.can_edit_team(team_id) or (public.can_view_team(team_id) and not is_scouting));
create policy games_write  on public.games for all    to authenticated
  using (public.can_edit_team(team_id)) with check (public.can_edit_team(team_id));
create policy plans_select on public.practice_plans for select to authenticated using (public.can_view_team(team_id));
create policy plans_write  on public.practice_plans for all    to authenticated
  using (public.can_edit_team(team_id)) with check (public.can_edit_team(team_id));

-- Child rows follow their parent's team.
create or replace function public.play_team(id uuid) returns uuid
  language sql stable security definer set search_path = public as $$ select team_id from public.plays where plays.id = $1 $$;
create or replace function public.game_team(id uuid) returns uuid
  language sql stable security definer set search_path = public as $$ select team_id from public.games where games.id = $1 $$;
create or replace function public.plan_team(id uuid) returns uuid
  language sql stable security definer set search_path = public as $$ select team_id from public.practice_plans where practice_plans.id = $1 $$;
-- A game's rows (stats, shots, subs) are visible exactly when the game is.
create or replace function public.can_view_game(gid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.can_edit_team(g.team_id) or (public.can_view_team(g.team_id) and not g.is_scouting)
  from public.games g where g.id = gid
$$;
grant execute on function public.can_view_game(uuid) to authenticated;
grant execute on function public.play_team(uuid) to authenticated;
grant execute on function public.game_team(uuid) to authenticated;
grant execute on function public.plan_team(uuid) to authenticated;

create policy play_videos_select on public.play_videos for select to authenticated using (public.can_view_team(public.play_team(play_id)));
create policy play_videos_write  on public.play_videos for all    to authenticated
  using (public.can_edit_team(public.play_team(play_id))) with check (public.can_edit_team(public.play_team(play_id)));
create policy stat_events_select on public.stat_events for select to authenticated using (public.can_view_game(game_id));
create policy stat_events_write  on public.stat_events for all    to authenticated
  using (public.can_edit_team(public.game_team(game_id))) with check (public.can_edit_team(public.game_team(game_id)));
create policy shot_events_select on public.shot_events for select to authenticated using (public.can_view_game(game_id));
create policy shot_events_write  on public.shot_events for all    to authenticated
  using (public.can_edit_team(public.game_team(game_id))) with check (public.can_edit_team(public.game_team(game_id)));
create policy sub_events_select  on public.sub_events  for select to authenticated using (public.can_view_game(game_id));
create policy sub_events_write   on public.sub_events  for all    to authenticated
  using (public.can_edit_team(public.game_team(game_id))) with check (public.can_edit_team(public.game_team(game_id)));
create policy plan_items_select  on public.practice_plan_items for select to authenticated using (public.can_view_team(public.plan_team(plan_id)));
create policy plan_items_write   on public.practice_plan_items for all    to authenticated
  using (public.can_edit_team(public.plan_team(plan_id))) with check (public.can_edit_team(public.plan_team(plan_id)));
create policy plan_videos_select on public.practice_plan_videos for select to authenticated using (public.can_view_team(public.plan_team(plan_id)));
create policy plan_videos_write  on public.practice_plan_videos for all    to authenticated
  using (public.can_edit_team(public.plan_team(plan_id))) with check (public.can_edit_team(public.plan_team(plan_id)));

-- players: visible to whoever can see a team they're on (or that scouted
-- them), to their creator, and to the player themself; changed by coaches of
-- those teams, their creator, or an admin.
create or replace function public.can_view_player(p public.players)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or p.created_by = auth.uid()
      or p.user_id = auth.uid()
      or (p.scout_for_team is not null and public.can_edit_team(p.scout_for_team))
      or exists (select 1 from public.team_players tp where tp.player_id = p.id and public.can_view_team(tp.team_id));
$$;
create or replace function public.can_edit_player(p public.players)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.my_role() = 'coach' and (
            p.created_by = auth.uid()
         or (p.scout_for_team is not null and public.can_edit_team(p.scout_for_team))
         or exists (select 1 from public.team_players tp where tp.player_id = p.id and public.can_edit_team(tp.team_id))));
$$;
grant execute on function public.can_view_player(public.players) to authenticated;
grant execute on function public.can_edit_player(public.players) to authenticated;

create policy players_select on public.players for select to authenticated using (public.can_view_player(players));
create policy players_insert on public.players for insert to authenticated
  with check (public.my_role() in ('admin', 'coach'));
create policy players_update on public.players for update to authenticated
  using (public.can_edit_player(players)) with check (public.my_role() in ('admin', 'coach'));
create policy players_delete on public.players for delete to authenticated using (public.can_edit_player(players));

-- Clips: readable by anyone who can see the play / plan they belong to;
-- uploads and deletes by coaches and admins.
drop policy if exists auth_video_read  on storage.objects;
drop policy if exists auth_video_write on storage.objects;
drop policy if exists auth_video_del   on storage.objects;
create policy auth_video_read on storage.objects for select to authenticated using (
  bucket_id = 'play-videos' and (
       public.is_admin()
    or exists (select 1 from public.play_videos v where v.storage_path = storage.objects.name
               and public.can_view_team(public.play_team(v.play_id)))
    or exists (select 1 from public.practice_plan_videos v where v.storage_path = storage.objects.name
               and public.can_view_team(public.plan_team(v.plan_id)))
    or (owner = auth.uid())));
create policy auth_video_write on storage.objects for insert to authenticated
  with check (bucket_id = 'play-videos' and public.my_role() in ('admin', 'coach'));
create policy auth_video_del on storage.objects for delete to authenticated
  using (bucket_id = 'play-videos' and public.my_role() in ('admin', 'coach'));

-- Invites go through the invite-user Edge Function (supabase/functions); keep
-- public sign-ups off (Authentication → Sign In / Providers).

-- Used by the invite-user Edge Function to check a coach may invite a player.
create or replace function public.can_edit_player_id(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_edit_player(p) from public.players p where p.id = pid;
$$;
grant execute on function public.can_edit_player_id(uuid) to authenticated;

-- ============================================================
-- Migration: accounts created in the Supabase dashboard are coaches
-- Apply in: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- The invite-user Edge Function always puts a role in the new user's
-- metadata. A user invited or added from Authentication → Users has none;
-- only someone with dashboard access can do that, so make them a coach.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'coach')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
