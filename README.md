# Basketball Playbook

A coaching tool: diagram plays on a half/full court, manage them (CRUD), attach
video examples, track live game stats, and export box scores to CSV.

**Stack** — Vite · Vue 3 (`<script setup>` + TS) · Tailwind CSS · Supabase
(Postgres + Storage). All free / open source.

## Features

- **Accounts** — email + password sign-in via Supabase Auth. Every screen is
  behind the login; the session persists, so it's a one-time step per device.
- **Play diagrams** — freehand pen, arrows (pass / cut / dribble / screen),
  player markers (home / defense / ball), color + width, undo / clear, and a
  half ↔ full court toggle. Stored as normalized JSON so plays stay editable and
  render crisply at any size.
- **Plays CRUD** — create, edit, delete; grid view with live diagram thumbnails.
- **Practice plans** — a tab on the playbook: build a session out of timed
  blocks, attach a drill from the playbook to any block, add session notes and
  clips, then view, edit or print the plan. Newest practice first.
- **Video clips** — upload examples per play to Supabase Storage, play inline.
- **Stat tracking** — roster + games, tap-to-record stat events (append-only
  audit trail), a box score that aggregates live.
- **Export** — one-click CSV of the current game's box score.

## Setup

### 1. Install

```bash
npm install
```

### 2. Create a Supabase project

At https://supabase.com → New project. Then **SQL Editor → New query**, paste
the contents of [`supabase/schema.sql`](supabase/schema.sql), and **Run**. That
creates the tables, the `play-videos` storage bucket, and RLS policies.

Read top to bottom, that file is a running log: the original schema plus each
migration since. Running the whole thing on a fresh project is correct — the
last section swaps the permissive `dev_*` policies for authenticated-only ones.

### 3. Turn on email auth

In the Supabase dashboard:

1. **Authentication → Sign In / Providers → Email** — enable it.
2. Create each coach's account in **Authentication → Users → Add user →
   Create new user** (with a password). The app has no sign-up screen.
3. **Disable new signups** (Authentication → Sign In / Providers → "Allow new
   users to sign up").
4. Run the **staff allow-list** migration in `schema.sql`. It seeds the
   `staff` table from the existing accounts — review it, delete anyone who
   isn't coaching staff, and add new coaches with
   `insert into public.staff (email) values ('coach@example.com');`.
   Only allow-listed emails can read or change data or clips.

> Ran only the top of `schema.sql` and left the `dev_*` policies in place? The
> login screen works, but the `anon` key still has full access — anyone can read
> the data straight from the API without signing in. Run the **Supabase Auth**
> migration at the bottom of the file to actually close it.

### 4. Configure env

```bash
cp .env.example .env.local
```

Fill in from **Supabase → Project Settings → API**:

```
VITE_SUPABASE_URL=https://<your-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

### 5. Run

```bash
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build to dist/
npm run preview  # serve the built bundle
```

If the env vars are missing, the app loads but shows a "Supabase not configured"
badge and read calls no-op — check `.env.local`.

## Project layout

```
src/
  components/
    CourtCanvas.vue         SVG court + drawing engine (the core piece)
    PlayEditorModal.vue     create/edit a play
    PracticePlanModal.vue   create/edit a practice plan (date, time blocks, clips)
    PracticePlanViewer.vue  read-only plan overlay
    VideoUploader.vue       Storage upload + inline playback
    AppNav.vue
  views/
    LoginView.vue              sign in (the only ungated route)
    AccountView.vue            who you're signed in as + sign out
    PlaysView.vue              playbook / scouting / practice-plan tabs + CRUD
    StatsView.vue              roster, games, live tracker, box score, CSV
    PrintPracticePlanView.vue  printable plan (timeline + a page per drill)
  composables/
    useAuth.ts           session state + sign in / up / out
    usePlays.ts          plays + video data layer
    usePracticePlan.ts   practice plans, their time blocks + clips
    useStats.ts          players/games/events + box-score aggregation + CSV
  lib/supabase.ts        client singleton
  lib/practice-utils.ts  plan/date/duration formatting shared by the plan views
  types.ts               shared types (diagram model, stats, practice plans)
supabase/schema.sql      run this once in the SQL editor
```

The Supabase calls are isolated in the two composables, so swapping in a
Node/TS API later (your "if needed" layer) means reimplementing those two files
against your own endpoints — the components don't touch Supabase directly.

## Stat model

Events are stored individually (e.g. `fg_made`, `rebound_def`, `assist`) rather
than as running totals, so the box score is always a pure function of the log
and nothing is destructively overwritten. "Undo" deletes the player's most
recent event. Points are derived (FT=1, FG=2, 3PT=3); a made three also counts
toward FG made/attempted, matching standard box-score convention.

## Auth model

Sign-in is email + password. `initAuth()` restores the persisted session before
the first navigation resolves, and a `router.beforeEach` guard sends anyone
without one to `/login` (carrying a `redirect` query param so they land where
they were headed). The guard is UX only — the real enforcement is the
`authenticated` RLS policies, so a faked client-side session still reads
nothing.

Access is limited to emails on the `staff` allow-list: every RLS policy (and
the clip storage policies) checks `public.is_staff()`. A valid login that
isn't on the list is told so at sign-in and signed straight back out.
Allow-listed coaches share one program's data — there's no per-coach scoping.

**Password resets** aren't in the app. Supabase can send a reset link
(`resetPasswordForEmail`), but that needs a redirect target and a "set a new
password" screen; for now, reset from **Authentication → Users** in the
dashboard.

## Remaining gaps

1. **No per-user ownership.** Add a `user_id` column and owner-scoped policies
   if two coaching staffs ever share one project.
