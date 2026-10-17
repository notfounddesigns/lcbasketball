# Features

1. - [x] Edit/Delete players
2. - [x] Edit/Delete games
3. - [x] Multi phase plays. Sometimes plays have several different actions. Need to be able to create and display multiple phases
4. - [x] Ability to curve all cut lines
5. - [x] Duplicate a play (copy an existing play as a starting point)
6. - [x] Search / filter plays by category or name
7. - [x] Export a play as a PNG or PDF (screenshot the SVG canvas)
8. - [x] Print-friendly play sheet (one play per page, diagram + notes)
9. - [x] Drag-to-reorder plays in the grid
10. - [x] Quick-start marker templates (e.g. 5-out, 4-low, horns) to pre-place players
11. - [x] Link player markers in a diagram to actual roster players by name
12. - [x] Opponent scouting section — separate from team playbook, tag plays as "opponent tendency"
13. - [x] Practice plan builder — drag plays into an ordered session with time slots
14. - [x] Shot chart — tap a court location during a game to log shot attempts with make/miss
15. - [x] Quarter / period tracking — split stat events by quarter so box score can show per-quarter splits
16. - [x] Substitution log — track which players were on the floor each possession
17. - [x] Season stats view — aggregate box scores across all games into season averages and totals
18. - [x] PWA / offline support — service worker so the app loads and is usable without a network connection
19. - [x] Play animation mode — step through multi-phase plays with transitions on the diagram
20. - [x] Click/Touch drag to move markers on court
21. - [x] Click/Touch edit an existing cut line on court (extend/shorten, change direction)
22. - [x] Auto increment player number after dropping marker
23. - [x] Record final game score (our score vs. opponent score) on the Game record — currently no way to log the final result
24. - [x] Text annotations on play diagrams — allow coach to add a short text label anywhere on the court (e.g. "screen here", "wait for cut")
25. - [x] Delete individual shot events from the shot chart (tap a marker to highlight, then delete) — `deleteShot` exists in composable but no UI exposes it
26. - [x] Shot chart period filter — filter the displayed shot markers by quarter (currently all shots for the game are overlaid regardless of period)
27. - [x] Season stats CSV export — "Export Season CSV" button on the Season tab similar to the per-game export
28. - [x] Lineup / on-court tracker — show which 5 players are currently on the floor based on sub events, highlight them in the tracker
29. - [x] Per-quarter box score — reuse the shot chart's All/Q1–OT filter on the box score; `period` is already stored on every stat event (completes the splits promised by #15)
30. - [x] Team totals row in the game box score and season table (team FG%, 3P%, FT%)
31. - [x] Edit game details — `updateGame` exists but only the final score is editable; add opponent, date, location and notes
32. - [ ] Starting five at tip-off — let the coach set starters so the on-floor lineup is right from the first possession instead of inferred from stats/subs
33. - [ ] Opponent scoring by quarter, then plus/minus and minutes played computed from the sub log
34. - [ ] Player game log — tap a season row to see game-by-game lines and a season shot chart for that player
35. - [x] Foul alerts — warn at 4 and 5 personal fouls; team fouls per quarter with a bonus indicator
36. - [x] Multiple overtimes — only one OT (period 5) exists today; add OT2+
37. - [ ] Offline queue for stat taps — store writes in IndexedDB and replay when the connection returns (gyms with bad Wi-Fi); also add Workbox `runtimeCaching` so plays/plans can be read offline
38. - [ ] Whole-playbook export — multi-play PDF/print of the playbook or a category with a cover page and table of contents
39. - [ ] Play tags and filters (e.g. "vs zone", "late clock", "ATO"); include the notes text in search
40. - [ ] Share a play read-only — PNG/PDF via the Web Share API on iPad, or a share link
41. - [ ] Save whiteboard sketches as a new play (`WhiteboardView` has no persistence)
42. - [ ] Per-phase notes / captions, and link related plays as counters/variants
43. - [ ] Duplicate a practice plan or save it as a template
44. - [ ] Drill library with default durations and coaching points, separate from plays
45. - [ ] Drag-to-reorder practice blocks (arrows only today)
46. - [ ] Practice calendar/week view and a "Today's plan" shortcut
47. - [ ] Practice attendance, tied to the roster
48. - [ ] Live practice mode — countdown timer per block with a buzzer
49. - [ ] Post-practice notes / reflection per block

---

# Bugs

1. - [x] Switching court type (half ↔ full) does not reposition existing diagram elements — markers drawn on a half court will appear in the wrong spot if you switch to full court mid-draw
2. - [x] `newDate` in StatsView initializes from `new Date().toISOString()` which is UTC — coaches in US evening sessions will see yesterday's date
3. - [x] `fetchGames` in `useStats` does not guard against Supabase being unconfigured the way `fetchPlayers` does — will throw a cryptic network error instead of the friendly banner
4. - [x] No client-side file-size check before video upload — very large files queue silently and may fail at the Storage level with no actionable message shown to the user
5. - [x] The empty `watch(() => props.modelValue.courtType, () => {})` in `CourtCanvas.vue` is dead code and should be removed
6. - [x] Saving a play does not disable the Save button during the async call — rapid double-taps can create duplicate records
7. - [x] `JSON.parse` on the localStorage play-order key in PlaysView has no try/catch — corrupted storage will crash the plays grid with an uncaught SyntaxError
8. - [x] Shot chart pending-shot overlay (`pendingScreenX/Y`) is computed at click time and not updated if the viewport is resized or device is rotated before the user taps Made/Miss — overlay can end up off-screen
9. - [x] Creating a game with an empty opponent string is not blocked — after the `.trim()` check passes an empty string, the row is inserted with `opponent: ""` and shows as a blank entry in the list
10. - [x] Play editor: deleting the last phase while `activePhase` is on it doesn't guard the index — `phaseDiagram` getter may reference `phases[undefined]` and render a blank canvas
11. - [x] Play editor: saving a play with multiple phases only saves the last phase
12. - [x] Placing a shot on the court away from the center of the court does not render in the correct place
13. - [x] Print Practice Plan - right now it is only displaying the 1st phase of the drill. Needs to handle showing all phases in a grid
14. - [x] **[high]** Removing a player deletes all of their stats, shots and subs — `stat_events`, `shot_events` and `sub_events` use `on delete cascade` on `player_id` (`schema.sql:52,118,152-153`) while the confirm dialog says "Their recorded stats will remain" (`StatsView.vue:95`). Retire players via the unused `players.active` flag instead of deleting
15. - [x] **[high]** Season stats silently truncate — `fetchAllEvents` (`useStats.ts`) loads every stat event in one unpaged query; Supabase caps responses at 1,000 rows by default, so after a handful of games the newest games drop out of Season stats and the season CSV
16. - [x] **[high]** Double-tapping Made/Miss records the shot twice — `confirmShot` (`ShotChart.vue`) only clears `pendingShot` after both inserts finish and has no in-flight guard
17. - [x] **[high]** The bottom tool strip's eraser button wipes the whole phase — its click handler calls `clearAll()` (`CourtCanvas.vue:1191`) with no confirm or undo, so the real pixel eraser (`eraseAt`) is unreachable. Make it select the eraser tool and put "Clear all" behind a confirm
18. - [x] **[high]** PNG export includes selection rings/handles and drops the LC logo and Inter font — `exportPng` serializes the live SVG, and an SVG loaded as `<img>` can't fetch external resources. Deselect before export and inline the logo as a data URL
19. - [x] **[high]** Print play sheet renders phases 2+ as empty boxes — `PrintPlayView.vue:58` doesn't pass `auto-height`, so courts below the fold measure to 0 height
20. - [x] **[high]** Practice plan save can silently lose all blocks — `updatePlan` deletes items then re-inserts, and `createPlan`/`updatePlan` ignore the insert result (`usePracticePlan.ts`) before closing the modal. Do it in one transaction (RPC) or keep the modal open on failure
21. - [x] Shot can be credited to the wrong player — `confirmShot` re-reads `props.playerId`/`props.period` after `await recordShot`; capture them before awaiting
22. - [ ] Shot markers and box-score stats can drift apart — `recordShot`'s result is ignored, and shots/stats are paired only by time, so Undo can delete an unrelated shot. Add a `stat_event_id` column on `shot_events`
23. - [x] Jump shots from the free-throw line are logged as free throws (1 pt) — `getShotType` treats any tap near the FT line as an FT. Add an explicit FT button instead of inferring from position
24. - [x] Season tab is stale until reload — `recordStat`, `undoLastFor` and `deleteGame` update `events` but not `allEvents`
25. - [x] Switching games can show the previous game's events/subs/shots — `openGame` doesn't clear them first and late responses aren't ignored
26. - [x] Reopening a game (or refreshing) resets the quarter to Q1, so later stats are filed under the wrong period — persist the open game and quarter
27. - [x] Desktop Undo button only appears when the selected player has shots (`StatsView.vue`) — use `selectedHasEvents` like the phone pad
28. - [x] Stat flash badges leak — `pushFlash` reassigns `id`, so the cleanup timeout removes only the last badge of a made shot
29. - [x] A saved final score can't be cleared — an empty number input yields `''`, which fails validation
30. - [x] Sub picker allows impossible subs (bench player "out", on-court player "in"), subs can't be undone, and OT shows as "Q5" in the sub log
31. - [x] Season percentages differ between screen (whole %) and CSV (one decimal) — the view rebuilds rows instead of using `buildSeasonStats`
32. - [x] Saving a play jumps back to phase 1 and can overwrite strokes drawn while the save was in flight — `updatePlay` replaces the store object, retriggering `watch(play)` which reloads the form
33. - [x] No unsaved-changes guard in the play editor or practice plan modal — back button, tab bar and practice-modal backdrop click discard edits without asking (the backdrop also isn't disabled while saving)
34. - [x] Reordering plays in one category wipes the saved order of other categories — `onDragOver` saves only the filtered ids (`PlaysView.vue`)
35. - [ ] Deleting a play leaves its video files in Storage (rows cascade, files don't); a failed `play_videos` insert after upload leaves an orphan file; same pattern for practice plan clips, whose upload/delete failures are also ignored by the modal
36. - [x] Formation templates are placed for a half court — on a full court the players land along the sideline
37. - [x] Print views (play and practice plan) have no close/back button and cover the tab bar — in the installed PWA there's no way out; they also print the "Loading…" screen when the record isn't found
38. - [x] Supabase health check never runs — `App.vue` imports `useSupabaseHealth`/`healthMessage` but never calls them, so a paused project shows a raw "Failed to fetch"
39. - [x] No redirect to /login when the session ends (token refresh failure or sign-out in another tab) — views just start failing
40. - [x] Practice plan editor: the over/under-window message (`windowFit.text`) is computed but never rendered; duration-only blocks are dropped on save; a 0/blank duration saves as 1
41. - [x] Editor back button drops `?category=` and the Playbook/Scouting tab resets
42. - [ ] Duplicate play doesn't copy its video clips
43. - [x] No `pointercancel` handler on the court — a system-interrupted touch can leave a stroke or drag stuck

---

# Refactor

1. - [x] Extract court geometry constants (basket position, 3-point radius, key dimensions) from the SVG template into named constants so the magic numbers are documented in one place
2. - [x] Move `buildBoxScore`, `boxScoreToCsv`, and `downloadCsv` out of `useStats.ts` into a `src/lib/stats-utils.ts` — they are pure functions with no Supabase dependency and are easier to unit-test standalone
3. - [x] `usePlays` and `useStats` use module-level refs (singleton state) — this is fine for a single-coach app but should be called out explicitly in comments so it's not surprising if the app ever supports multiple active contexts
4. - [x] The `PlayEditorModal` `save()` handler emits synchronously and doesn't await the Supabase call — the parent `onSave` is async but the modal doesn't track the result; consider passing a loading state back down or lifting error handling into the modal
5. - [x] Wrap the modal `<div>` in `<Teleport to="body">` to avoid potential z-index stacking context issues when the modal is nested inside a transformed or overflow-hidden ancestor
6. - [x] Redo new/edit play UI/UX. Instead of displaying in a modal, route to new page. The new play container should not overflow the screen width or height.
7. - [x] Play category should be a picklist instead of text field. Hardcode categories on client side for now.
8. - [x] Move `default_preview_mode` off the `Play` type (it's UI-only, has no DB column, and is written onto shared store objects)
9. - [ ] Replace the order-based undo (pop last element) with snapshot undo/redo history per phase, so moves, erases, template applies and clears can be undone
10. - [x] Use stable ids instead of index keys for practice plan blocks (`v-for :key="i"` while blocks reorder)
11. - [x] Remove or wire up the practice plan `name` field — the modal always saves `name: null`
12. - [x] Scope the print views' global `@media print` styles so they don't linger after leaving the route

---

# UI / UX

1. - [x] UI / UX should feel like a modern iPhone / iPad app
2. - [x] Color palette: Draw from Lawrence County High School in Moulton, AL. Some variation of red, black, grey and white
3. - [x] Icons: Find free library online or importable package. should have the native iPhone / ipad look
     - Used **Heroicons** (free, MIT licensed, designed by the Tailwind CSS team)
4. - [x] Font: Barlow Condensed for display headings; Inter for body text
5. - [x] Swap current orange `rim` accent to **red** to match Lawrence County's school colors
6. - [x] Replace dark `ink-900` background with true black (`#000`) to match iOS dark mode aesthetic on OLED screens
7. - [x] Add a bottom tab bar navigation (Plays / Stats) in place of the current top nav — standard iOS navigation pattern on mobile
8. - [x] Add LC logo to court
9. - [x] Use icons instead of buttons where it makes sense to conserve space
10. - [x] Success toast / snackbar feedback after saving a play, creating a game, or adding a player — currently there is no visual confirmation the action succeeded
11. - [x] Stat tap buttons on the tracker are small and easy to miss-tap during a live game — consider larger tap targets or a compact "scoreboard" layout optimized for one-handed use on a phone
12. - [x] Shot chart markers should use both color AND shape to distinguish 2pt/3pt/miss (colorblind-friendly) — e.g. circle for made, X for miss already done, but 2pt vs 3pt rely on color alone
13. - [ ] Animate player movement between phases in the play animator (markers keep ids across phases, so positions can be tweened); when adding a phase, move players to the head of their arrows
14. - [ ] Copy/duplicate a phase and reorder phase tabs
15. - [ ] Defensive formation presets (2-3, 1-3-1, man) alongside the offensive templates
16. - [x] Show play notes on every page of the print sheet
17. - [x] Give the eraser its own icon (it currently shares the trash icon with "Clear all")
18. - [ ] Proper dialog behaviour for modals — Escape to close, focus trap/return, `role="dialog"`/`aria-labelledby` (PracticePlanModal, PracticePlanViewer, ConfirmDialog)
19. - [ ] Re-enable pinch zoom outside the court canvas (`user-scalable=no` fails WCAG 1.4.4)
20. - [ ] "New version available" prompt for the PWA — `autoUpdate` leaves open tabs on old code
21. - [ ] Drag-to-reorder plays may not work on iPhone (HTML5 drag-and-drop) — use a pointer-based sort

---

# Security

1. - [x] **[high]** Anyone who signs up can read and change all team data — the login page offers "Sign up" and every RLS policy is `to authenticated using (true)`. Hide sign-up and restrict policies to an allow-list (e.g. a `staff` table or email/role claim)
2. - [x] Video buckets are public, so clip URLs play without signing in — switch to private buckets with signed URLs
3. - [x] Any signed-in user can delete any stored clip (storage delete policy has no ownership check)

---

# Tooling

1. - [ ] Add unit tests (Vitest) for the pure helpers — `stats-utils.ts`, `practice-utils.ts`, `diagram-utils.ts`
2. - [ ] Add ESLint + Prettier, and run typecheck, lint and tests on pull requests (CI only builds and deploys today)
3. - [ ] Move `supabase/schema.sql` to Supabase CLI migrations; add `updated_at` to `practice_plans`
4. - [ ] Persist play order in the database (`sort_order` column) instead of localStorage so it follows the coach across devices

---
