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
npm test         # unit tests for the pure helpers in src/lib (Vitest)
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

### Roles and teams

Every account has a profile with a role, and data belongs to teams (e.g. Boys
Varsity, Boys JV, Girls Varsity):

| Role   | Sees                                   | Can change                                              |
|--------|----------------------------------------|---------------------------------------------------------|
| Admin  | every team                             | everything; invites coaches, admins and players; roles  |
| Coach  | teams they coach or created            | those teams' plays, games, stats, plans, rosters; creates teams and players; adds co-coaches; invites player logins |
| Player | teams they're on (no scouting reports) | nothing — read-only                                     |

A team can have several coaches and a player can be on several teams. Plays,
games and practice plans carry a `team_id`; stats, shots, clips and plan
blocks follow their parent. All of this is enforced by RLS
(`can_view_team` / `can_edit_team` in `supabase/schema.sql`); the UI only hides
what a role can't use. The Account tab switches the current team and manages
teams, rosters and people.

**Setting it up** (once):

1. Run the "roles (admin / coach / player) and teams" migration at the end of
   `supabase/schema.sql` in the SQL Editor. Existing data moves to a team
   named "Boys Varsity" (rename it in Account) with every current coach on it.
2. Make yourself an admin:
   `update public.profiles set role = 'admin' where email = 'you@example.com';`
3. Deploy the invite function (needs the [Supabase CLI](https://supabase.com/docs/guides/cli)):
   `supabase functions deploy invite-user --project-ref <your-project-ref>`
   If invites fail with "Invalid JWT" (projects on the newer JWT signing
   keys), redeploy with `--no-verify-jwt`; the function checks the caller's
   sign-in itself. Invite failures are logged under **Edge Functions →
   invite-user → Logs** in the dashboard.
4. In **Authentication → URL Configuration**, add the site's URL (e.g.
   `https://www.lcbasketball.com/`) to **Redirect URLs** so invite and reset
   links can return to the app. Keep public sign-ups off.
5. Send invite and reset emails through [Resend](https://resend.com):
   1. In Resend, verify the sending domain and create two templates — one for
      invites, one for password resets. Each gets these variables:
      `ACTION_URL` (the sign-in link; use it as the button's href),
      `EMAIL`, `DISPLAY_NAME` and `ROLE` (the last two may be blank). Set the
      subject and sender in the template, and publish it.
   2. Deploy the hook: `supabase functions deploy send-email --no-verify-jwt --project-ref <your-project-ref>`
      (it checks the hook's signature itself).
   3. In **Authentication → Hooks**, add a **Send Email** hook of type HTTPS
      pointing at `https://<your-project-ref>.supabase.co/functions/v1/send-email`
      and generate its secret.
   4. Set the function's secrets:
      ```sh
      supabase secrets set --project-ref <your-project-ref> \
        SEND_EMAIL_HOOK_SECRET='v1,whsec_…' \
        RESEND_API_KEY=re_… \
        RESEND_INVITE_TEMPLATE=<invite template id or alias> \
        RESEND_RECOVERY_TEMPLATE=<reset template id or alias>
      ```
      Add `RESEND_FROM='LC Basketball <noreply@your-domain>'` if the
      templates don't set a sender.

   Once the hook is on, Supabase sends no auth email itself. Failures are
   logged under **Edge Functions → send-email → Logs**, and the reason shows
   in the invite dialog.

**Invites and passwords.** Admins invite people from Account → People; coaches
invite a roster player's login from the envelope icon. The `invite-user` Edge
Function checks the caller's role, then has Supabase send the invite, which the
`send-email` hook delivers through Resend. The
link signs the person in and opens **Choose your password**. "Forgot
password?" on the login screen sends a reset link (also via Resend) that lands
on the same page.

## Remaining gaps

1. **Teams aren't seasons.** A new season is a new team (e.g. "Boys Varsity
   2027"); there's no archive or carry-over of rosters yet.
