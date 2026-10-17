<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Game, Player, ShotEvent, StatEvent, StatType } from '@/types'
import { useStats } from '@/composables/useStats'
import { useShotChart } from '@/composables/useShotChart'
import { useConfirm } from '@/composables/useConfirm'
import { useToast } from '@/composables/useToast'
import { useAccess } from '@/composables/useAccess'
import { buildBoxScore, buildSeasonStats, boxScoreToCsv, downloadCsv, formatPct, periodLabel, seasonStatsToCsv, teamTotals } from '@/lib/stats-utils'
import ShotChart from '@/components/ShotChart.vue'
import PlaysView from '@/views/PlaysView.vue'
import ScoutNotesDrawer from '@/components/ScoutNotesDrawer.vue'
import ScoutReportView from '@/components/ScoutReportView.vue'
import ScoutTeamView from '@/components/ScoutTeamView.vue'
import SeasonStatsTable from '@/components/SeasonStatsTable.vue'
import StatFlash from '@/components/StatFlash.vue'
import TrashIcon from '@heroicons/vue/24/outline/TrashIcon'
import { ArchiveBoxIcon, ArrowDownTrayIcon, ArrowLeftIcon, ArrowUturnUpIcon, ArrowUturnLeftIcon, ChartBarIcon, CheckIcon, DocumentTextIcon, FolderArrowDownIcon, PencilIcon, PlusIcon, UserGroupIcon, UserPlusIcon, XMarkIcon } from '@heroicons/vue/24/outline'

const {
  players, scoutPlayers, games, events, allEvents, error,
  fetchPlayers, fetchGames, fetchEvents, fetchAllEvents,
  addPlayer, updatePlayer,
  createGame, updateGame, deleteGame,
  recordStat, undoLastFor,
} = useStats()
const { shots, deleteShot, fetchShotsForGames } = useShotChart()
const { confirm } = useConfirm()
// Players get a read-only view: games open as a box score + shot chart, and
// there's no tracker, scouting or roster editing.
const { canEdit } = useAccess()
const { toast } = useToast()

// Field goals are recorded alongside a shot_event on the shot chart, so
// undoing one must also remove its paired shot marker. Free throws have their
// own buttons and no marker, so they're not in this set.
const SHOOTING_STATS = new Set<StatType>([
  'fg_made', 'fg_miss', 'three_made', 'three_miss',
])

// ---- Mode: game | season | scouting ----
const route = useRoute()
const router = useRouter()
type Mode = 'game' | 'season' | 'scouting'
// In the URL (?mode=) so the play editor's Back returns to the Scouting tab.
const mode = computed<Mode>({
  get: () => {
    const m = route.query.mode
    if (m === 'scouting' && !canEdit.value) return 'game'
    return m === 'season' || m === 'scouting' ? m : 'game'
  },
  set: (m) => {
    router.replace({ query: m === 'game' ? {} : { mode: m } })
  },
})

const activeGame = ref<Game | null>(null)
// The tracker shows on the tab its game belongs to: our games on Game,
// scouting reports on Scouting. A game left open stays open underneath.
const isScout = computed(() => !!activeGame.value?.is_scouting)
const inGame = computed(() =>
  !!activeGame.value && mode.value === (isScout.value ? 'scouting' : 'game'),
)

// Our games and scouting reports share the games table.
const ourGames = computed(() => games.value.filter((g) => !g.is_scouting))
const scoutReports = computed(() => games.value.filter((g) => g.is_scouting))
// A finished (or not yet tracked) scouting report opened from the list.
const viewingScout = ref<Game | null>(null)

// ---- Period tracking ----
const activePeriod = ref(1)
// Q1–Q4 plus one OT by default; "+OT" adds more for multi-overtime games.
const maxPeriod = ref(5)
const PERIODS = computed(() =>
  Array.from({ length: maxPeriod.value }, (_, i) => ({ label: periodLabel(i + 1), value: i + 1 })),
)
function addOvertime() {
  maxPeriod.value += 1
  activePeriod.value = maxPeriod.value
}

// The open game and its quarter survive a refresh or an app restart mid-game,
// so stats after a reload aren't filed under Q1.
const LIVE_GAME_KEY = 'lcbb-live-game'
function readLiveGame(): { gameId: string; period: number } | null {
  try {
    return JSON.parse(localStorage.getItem(LIVE_GAME_KEY) ?? 'null')
  } catch {
    return null
  }
}
watch([activeGame, activePeriod], ([g, period]) => {
  try {
    if (g) localStorage.setItem(LIVE_GAME_KEY, JSON.stringify({ gameId: g.id, period }))
    else localStorage.removeItem(LIVE_GAME_KEY)
  } catch {
    // Storage can be unavailable (private mode); resuming is a convenience.
  }
})

onMounted(async () => {
  await Promise.all([fetchPlayers(), fetchGames(), fetchAllEvents()])
  const live = readLiveGame()
  const game = live && games.value.find((g) => g.id === live.gameId)
  if (game && !activeGame.value && canEdit.value) {
    if (game.is_scouting && mode.value !== 'scouting') mode.value = 'scouting'
    await openGame(game)
  }
})

// ----- roster drawer -----
const showRosterDrawer = ref(false)

// ----- roster management -----
const newPlayerName = ref('')
const newPlayerNumber = ref<number | null>(null)
async function onAddPlayer() {
  if (!newPlayerName.value.trim()) return
  const added = await addPlayer({
    name: newPlayerName.value.trim(),
    number: newPlayerNumber.value,
    position: null,
    active: true,
    // In a scouting report the roster being built is the scouted team's.
    ...(isScout.value ? { scout_team: scoutTeam.value } : {}),
  })
  if (!added) return
  toast(`${added.name} added`)
  newPlayerName.value = ''
  newPlayerNumber.value = null
}

const editingPlayerId = ref<string | null>(null)
const editPlayerName = ref('')
const editPlayerNumber = ref<number | null>(null)

function startEditPlayer(p: Player) {
  editingPlayerId.value = p.id
  editPlayerName.value = p.name
  editPlayerNumber.value = p.number
}

async function saveEditPlayer(id: string) {
  if (!editPlayerName.value.trim()) return
  const updated = await updatePlayer(id, {
    name: editPlayerName.value.trim(),
    number: editPlayerNumber.value,
  })
  if (!updated) return
  toast('Player updated')
  editingPlayerId.value = null
}

// Players are retired, never deleted: deleting the row would cascade away
// every stat, shot and sub they ever recorded.
async function onRetirePlayer(p: Player) {
  const ok = await confirm({
    title: 'Retire player',
    message: `Retire ${p.name}? They'll be hidden from the roster and new games. Their stats stay in past box scores and season totals, and you can reactivate them any time.`,
    confirmText: 'Retire',
  })
  if (!ok) return
  if (await updatePlayer(p.id, { active: false })) toast(`${p.name} retired`)
}

async function onReactivatePlayer(p: Player) {
  if (await updatePlayer(p.id, { active: true })) toast(`${p.name} is back on the roster`)
}

// The team whose players the tracker shows: ours, or the scouted team's
// roster (shared by every report on that team).
const sameTeam = (a?: string | null, b?: string | null) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()
const scoutTeam = computed(() => (activeGame.value ?? viewingScout.value)?.scouted_team?.trim() ?? '')
const rosterPool = computed(() =>
  (activeGame.value ?? viewingScout.value)?.is_scouting
    ? scoutPlayers.value.filter((p) => sameTeam(p.scout_team, scoutTeam.value))
    : players.value,
)

const activePlayers = computed(() => rosterPool.value.filter((p) => p.active !== false))
const retiredPlayers = computed(() => rosterPool.value.filter((p) => p.active === false))

// Box scores list the current roster plus any retired player who has stats in
// the events being summarised, so history never loses a name.
function rosterFor(evts: StatEvent[], pool: Player[] = rosterPool.value): Player[] {
  const withStats = new Set(evts.map((e) => e.player_id))
  return pool.filter((p) => p.active !== false || withStats.has(p.id))
}

// ----- game sheet: create a game or scouting report, or edit one's details -----
const gameSheet = ref<'new' | 'new-scout' | 'edit' | null>(null)
const sheetGame = ref<Game | null>(null) // the game being edited
const sheetIsScout = computed(() =>
  gameSheet.value === 'new-scout' || (gameSheet.value === 'edit' && !!sheetGame.value?.is_scouting),
)
const sheetScoutedTeam = ref('')
const sheetOpponent = ref('')
const sheetDate = ref('')
const sheetLocation = ref('')
const sheetNotes = ref('')
const sheetTeamScore = ref<number | string | null>(null)
const sheetOppScore = ref<number | string | null>(null)
const savingGame = ref(false)

// Teams already scouted, offered as suggestions so a second report on the
// same team picks up its roster.
const knownScoutTeams = computed(() =>
  [...new Set(scoutReports.value.map((g) => g.scouted_team?.trim()).filter(Boolean) as string[])].sort(),
)

function resetSheet() {
  sheetScoutedTeam.value = ''
  sheetOpponent.value = ''
  sheetDate.value = new Date().toLocaleDateString('en-CA')
  sheetLocation.value = ''
  sheetNotes.value = ''
  sheetTeamScore.value = null
  sheetOppScore.value = null
}

function openNewGameSheet() {
  resetSheet()
  sheetGame.value = null
  gameSheet.value = 'new'
}

function openNewScoutSheet() {
  resetSheet()
  sheetGame.value = null
  gameSheet.value = 'new-scout'
}

function openEditGameSheet(g: Game | null = activeGame.value) {
  if (!g) return
  sheetGame.value = g
  sheetScoutedTeam.value = g.scouted_team ?? ''
  sheetOpponent.value = g.opponent
  sheetDate.value = g.played_on
  sheetLocation.value = g.location ?? ''
  sheetNotes.value = g.notes ?? ''
  sheetTeamScore.value = g.our_score ?? null
  sheetOppScore.value = g.opp_score ?? null
  gameSheet.value = 'edit'
}

const sheetValid = computed(() =>
  !!sheetOpponent.value.trim() && !!sheetDate.value && (!sheetIsScout.value || !!sheetScoutedTeam.value.trim()),
)

async function onSubmitGameSheet() {
  if (!sheetValid.value || savingGame.value) return
  const blankToNull = (n: number | string | null) => (n === '' || n == null ? null : Number(n))
  const details: Partial<Omit<Game, 'id' | 'created_at'>> & { opponent: string; played_on: string } = {
    opponent: sheetOpponent.value.trim(),
    played_on: sheetDate.value,
    location: sheetLocation.value.trim() || null,
  }
  if (sheetIsScout.value) {
    details.scouted_team = sheetScoutedTeam.value.trim()
    details.our_score = blankToNull(sheetTeamScore.value)
    details.opp_score = blankToNull(sheetOppScore.value)
    const valid = (n: number | null | undefined) => n == null || (Number.isInteger(n) && n >= 0)
    if (!valid(details.our_score) || !valid(details.opp_score)) {
      toast('Scores must be whole numbers', 'error')
      return
    }
  } else {
    details.notes = sheetNotes.value.trim() || null
  }
  savingGame.value = true
  try {
    if (gameSheet.value === 'edit' && sheetGame.value) {
      const updated = await updateGame(sheetGame.value.id, details)
      if (!updated) {
        toast(error.value ?? 'Could not save details', 'error')
        return
      }
      if (activeGame.value?.id === updated.id) activeGame.value = updated
      if (viewingScout.value?.id === updated.id) viewingScout.value = updated
      gameSheet.value = null
      toast(updated.is_scouting ? 'Matchup details saved' : 'Game details saved')
      return
    }
    const scouting = gameSheet.value === 'new-scout'
    const g = await createGame({
      location: null, notes: null, ...details,
      ...(scouting ? { is_scouting: true } : {}),
    } as Omit<Game, 'id' | 'created_at'>)
    if (!g) {
      toast(error.value ?? 'Could not create', 'error')
      return
    }
    toast(scouting ? `Scouting ${g.scouted_team}` : `Game vs ${g.opponent} created`)
    gameSheet.value = null
    selectedPlayerId.value = null
    viewingScout.value = null
    await openGame(g)
    // A team scouted for the first time has no roster yet: start there.
    if (scouting && !rosterPool.value.length) showRosterDrawer.value = true
  } finally {
    savingGame.value = false
  }
}

async function openGame(g: Game) {
  const live = readLiveGame()
  activeGame.value = g
  boxPeriod.value = 'all'
  activePeriod.value = 1
  maxPeriod.value = 5
  selectedPlayerId.value = null
  editingScore.value = false
  await fetchEvents(g.id)
  if (activeGame.value?.id !== g.id) return // switched again while loading
  // Resume where the game left off: the saved quarter, else the latest one
  // that has stats.
  const latest = Math.max(1, ...events.value.map((e) => e.period ?? 1))
  const resume = live?.gameId === g.id ? live.period : latest
  maxPeriod.value = Math.max(5, latest, resume)
  activePeriod.value = resume
}

// Players open a game as a read-only box score and shot chart.
const viewingGame = ref<Game | null>(null)
async function viewGame(g: Game) {
  viewingGame.value = g
  await fetchEvents(g.id)
}

async function onDeleteGame(g: Game) {
  const ok = await confirm({
    title: g.is_scouting ? 'Delete scouting report' : 'Delete game',
    message: g.is_scouting
      ? `Delete the report on ${g.scouted_team} vs ${g.opponent}? Its stats, shots and notes will be removed.`
      : `Delete game vs ${g.opponent}? All stat events will be removed.`,
    confirmText: 'Delete',
    tone: 'danger',
  })
  if (!ok) return
  await deleteGame(g.id)
  if (activeGame.value?.id === g.id) activeGame.value = null
  if (viewingScout.value?.id === g.id) viewingScout.value = null
}

// ----- free throws: one tap each, no court position needed -----
const FT_STATS: { stat: StatType; label: string; tone: string }[] = [
  { stat: 'ft_made', label: 'FT Make', tone: 'bg-green-700/30 text-green-300 ring-1 ring-green-500/40' },
  { stat: 'ft_miss', label: 'FT Miss', tone: 'bg-red-900/40 text-red-300 ring-1 ring-red-500/40' },
]

// ----- non-shooting stat buttons (field goals handled by shot chart) -----
const ACTION_STATS: { stat: StatType; label: string; tone: string }[] = [
  { stat: 'rebound_def', label: 'DREB', tone: 'bg-ink-700 text-chalk' },
  { stat: 'rebound_off', label: 'OREB', tone: 'bg-ink-700 text-chalk' },
  { stat: 'assist',      label: 'AST',  tone: 'bg-ink-700 text-chalk' },
  { stat: 'steal',       label: 'STL',  tone: 'bg-ink-700 text-chalk' },
  { stat: 'block',       label: 'BLK',  tone: 'bg-ink-700 text-chalk' },
  { stat: 'turnover',    label: 'TOV',  tone: 'bg-rim/20 text-rim' },
  { stat: 'foul',        label: 'FOUL', tone: 'bg-rim/20 text-rim' },
]

const selectedPlayerId = ref<string | null>(null)
const selectedPlayer = computed(() => rosterPool.value.find((p) => p.id === selectedPlayerId.value) ?? null)

async function tap(stat: StatType) {
  if (!activeGame.value || !selectedPlayerId.value) return
  // A short buzz confirms the tap without looking down (Android; no-op on iOS)
  navigator.vibrate?.(15)
  const playerId = selectedPlayerId.value
  const recorded = await recordStat(activeGame.value.id, playerId, stat, activePeriod.value)
  if (recorded && stat === 'foul') warnFouls(playerId)
}

// ----- foul trouble -----
const FOUL_WARN = 4
const FOUL_OUT = 5
// Team fouls reset each quarter; the opponent shoots bonus free throws from the
// fifth (NFHS). Overtime periods carry the fourth quarter's count.
const BONUS_AT = 5

const fouls = computed(() => {
  const byPlayer = new Map<string, number>()
  for (const e of events.value) {
    if (e.stat === 'foul') byPlayer.set(e.player_id, (byPlayer.get(e.player_id) ?? 0) + 1)
  }
  return byPlayer
})

const teamFouls = computed(() => {
  const inPeriod = (p: number) => (activePeriod.value > 4 ? p >= 4 : p === activePeriod.value)
  return events.value.filter((e) => e.stat === 'foul' && inPeriod(e.period ?? 1)).length
})

function warnFouls(playerId: string) {
  const n = fouls.value.get(playerId) ?? 0
  const name = playerName(playerId)
  if (n === FOUL_OUT) toast(`${name} has fouled out (${n} fouls)`, 'error')
  else if (n === FOUL_WARN) toast(`${name} has ${n} fouls — one more and they're out`, 'error')
  if (teamFouls.value === BONUS_AT) toast(`Team fouls: ${BONUS_AT} — opponent in the bonus`)
}

function foulTone(playerId: string) {
  const n = fouls.value.get(playerId) ?? 0
  return n >= FOUL_OUT ? 'text-red-400 font-bold line-through' : n >= FOUL_WARN ? 'text-yellow-400 font-bold' : ''
}

async function onUndo(playerId: string) {
  const undone = await undoLastFor(playerId)
  if (!undone || !SHOOTING_STATS.has(undone.stat)) return
  // The undone shooting stat was paired with the player's most recent shot;
  // remove that marker too. Shots stay ordered by created_at.
  const playerShots = shots.value.filter((s) => s.player_id === playerId)
  const lastShot = playerShots[playerShots.length - 1]
  if (lastShot) await deleteShot(lastShot.id)
}

const boxScore = computed(() => buildBoxScore(rosterFor(events.value), events.value))

// One period filter (above the court) drives both the shot chart and the box
// score; `period` is stored on every stat event. The roster stays the whole
// game's so rows don't jump.
const boxPeriod = ref<number | 'all'>('all')
const shownBoxScore = computed(() => {
  if (boxPeriod.value === 'all') return boxScore.value
  const inPeriod = events.value.filter((e) => (e.period ?? 1) === boxPeriod.value)
  return buildBoxScore(rosterFor(events.value), inPeriod)
})

const selectedHasEvents = computed(() =>
  !!selectedPlayerId.value && events.value.some((e) => e.player_id === selectedPlayerId.value),
)

// ----- box-score stat flash feedback -----
// Maps each stat to the box-score column it animates over and the amount shown
// (points for made shots, otherwise 1).
const STAT_FLASH: Record<StatType, { col: string; amount: number }> = {
  fg_made:     { col: 'fg',  amount: 2 },
  fg_miss:     { col: 'fg',  amount: 1 },
  three_made:  { col: 'tp',  amount: 3 },
  three_miss:  { col: 'tp',  amount: 1 },
  ft_made:     { col: 'ft',  amount: 1 },
  ft_miss:     { col: 'ft',  amount: 1 },
  rebound_off: { col: 'reb', amount: 1 },
  rebound_def: { col: 'reb', amount: 1 },
  assist:      { col: 'ast', amount: 1 },
  steal:       { col: 'stl', amount: 1 },
  block:       { col: 'blk', amount: 1 },
  turnover:    { col: 'tov', amount: 1 },
  foul:        { col: 'pf',  amount: 1 },
}

interface Flash { id: number; playerId: string; col: string; text: string; positive: boolean; color: 'green' | 'red' }
const flashes = ref<Flash[]>([])
let flashSeq = 0

function pushFlash(playerId: string, stat: StatType, positive: boolean, color: 'green' | 'red') {
  const meta = STAT_FLASH[stat]
  if (!meta) return
  const sign = positive ? '+' : '-'
  const add = (col: string, text: string) => {
    const id = ++flashSeq
    flashes.value = [...flashes.value, { id, playerId, col, text, positive, color }]
    // Drop each badge once its animation (0.85s) has finished.
    setTimeout(() => {
      flashes.value = flashes.value.filter((f) => f.id !== id)
    }, 900)
  }
  if (stat === 'fg_made' || stat === 'three_made' || stat === 'ft_made') {
    add(meta.col, `${sign}1`)
    if (stat === 'three_made') add('fg', `${sign}1`)
    add('pts', `${sign}${meta.amount}`)
  } else if (stat === 'fg_miss' || stat === 'three_miss' || stat === 'ft_miss') {
    add(meta.col, `${sign}1`)
    if (stat === 'three_miss') add('fg', `${sign}1`)
  } else {
    add(meta.col, `${sign}${meta.amount}`)
  }
}

function flashesFor(playerId: string, col: string) {
  return flashes.value.filter((f) => f.playerId === playerId && f.col === col) 
}

// Watch the game's events (the box-score source of truth) and animate single
// add/remove changes. This catches action taps, shot-chart shots, and undo
// alike, while ignoring bulk loads (game switches, initial fetch).
let prevEvents: StatEvent[] = []
watch(events, (curr) => {
  const currIds = new Set(curr.map((e) => e.id))
  const prevIds = new Set(prevEvents.map((e) => e.id))
  const added = curr.filter((e) => !prevIds.has(e.id))
  const removed = prevEvents.filter((e) => !currIds.has(e.id))
  if (added.length === 1 && removed.length === 0) {
    if (added[0].stat.includes('made')) {
      // push is positive and was a made basket so color is green
      pushFlash(added[0].player_id, added[0].stat, true, 'green')
    } else if (added[0].stat.includes('miss')) {
      // push is positive but was a missed basket so color is red
      pushFlash(added[0].player_id, added[0].stat, true, 'red')
    } else {
      // push is positive and a non-shooting stat so color is green
      pushFlash(added[0].player_id, added[0].stat, true, 'green')
    }
  } else if (removed.length === 1 && added.length === 0) {
    // push is negative so always red
    pushFlash(removed[0].player_id, removed[0].stat, false, 'red')
  }
  prevEvents = curr
}, { immediate: true })

function exportCsv() {
  if (!activeGame.value) return
  const period = boxPeriod.value === 'all' ? '' : ` ${periodLabel(boxPeriod.value)}`
  const label = `${activeGame.value.opponent} ${activeGame.value.played_on}${period}`
  const csv = boxScoreToCsv(shownBoxScore.value, label)
  downloadCsv(`boxscore-${activeGame.value.opponent}-${activeGame.value.played_on}${period.replace(' ', '-')}.csv`, csv)
}

// Season numbers are our team's only: scouting reports are left out.
const seasonEvents = computed(() => {
  const scoutIds = new Set(scoutReports.value.map((g) => g.id))
  return allEvents.value.filter((e) => !scoutIds.has(e.game_id))
})

function exportSeasonCsv() {
  const csv = seasonStatsToCsv(buildSeasonStats(rosterFor(seasonEvents.value, players.value), seasonEvents.value))
  downloadCsv(`season-stats-${new Date().toLocaleDateString('en-CA')}.csv`, csv)
}

// ----- final score -----
const editingScore = ref(false)
const ourScoreInput = ref<number | string | null>(null)
const oppScoreInput = ref<number | string | null>(null)

const boxScoreTotals = computed(() => teamTotals(shownBoxScore.value))
// The final-score default is always the whole game, whatever quarter is shown.
const teamPoints = computed(() => teamTotals(boxScore.value).pts)

function hasFinal(g: Game) {
  return g.our_score != null && g.opp_score != null
}

function resultLabel(g: Game) {
  if (!hasFinal(g)) return null
  const diff = g.our_score! - g.opp_score!
  return diff > 0 ? 'W' : diff < 0 ? 'L' : 'T'
}

function startEditScore() {
  if (!activeGame.value) return
  // Default our score to the box-score total so the coach only types theirs.
  ourScoreInput.value = activeGame.value.our_score ?? teamPoints.value
  oppScoreInput.value = activeGame.value.opp_score ?? null
  editingScore.value = true
}

async function saveScore() {
  if (!activeGame.value) return
  // An emptied number input yields '' — that means "clear the score".
  const blankToNull = (n: number | string | null) => (n === '' || n == null ? null : Number(n))
  const ours = blankToNull(ourScoreInput.value)
  const theirs = blankToNull(oppScoreInput.value)
  const valid = (n: number | null) => n == null || (Number.isInteger(n) && n >= 0)
  if (!valid(ours) || !valid(theirs)) {
    toast('Scores must be whole numbers', 'error')
    return
  }
  const updated = await updateGame(activeGame.value.id, { our_score: ours, opp_score: theirs })
  if (!updated) {
    toast('Could not save score', 'error')
    return
  }
  activeGame.value = updated
  editingScore.value = false
  toast(ours == null && theirs == null ? 'Final score cleared' : 'Final score saved')
}

// Players with a stat this game get a dot in the box score.
const playedIds = computed(() => new Set(events.value.map((e) => e.player_id)))

function playerName(id: string) {
  return [...players.value, ...scoutPlayers.value].find((p) => p.id === id)?.name ?? 'Unknown'
}

// ----- tracker sizing -----
// The tracker fills the screen below the sticky header, which can wrap onto a
// second line (a long matchup name), so measure where it starts.
const trackerEl = ref<HTMLElement | null>(null)
const trackerTop = ref(128)
function measureTracker() {
  const el = trackerEl.value
  if (el) trackerTop.value = Math.round(el.getBoundingClientRect().top + window.scrollY)
}
const headerObserver = new ResizeObserver(() => measureTracker())
watch(trackerEl, (el) => {
  headerObserver.disconnect()
  const header = document.querySelector('[data-stats-header]')
  if (el && header) {
    headerObserver.observe(header)
    nextTick(measureTracker)
  }
})
window.addEventListener('resize', measureTracker)
onBeforeUnmount(() => {
  headerObserver.disconnect()
  window.removeEventListener('resize', measureTracker)
})

// A column the app expects is missing from the database (Supabase's
// "Could not find the 'x' column … in the schema cache").
const needsMigration = computed(() => /schema cache|column .* does not exist/i.test(error.value ?? ''))

// ----- scouting reports -----
const showScoutNotes = ref(false)
const notesGame = computed(() => activeGame.value?.is_scouting ? activeGame.value : viewingScout.value)

function onNotesSaved(g: Game) {
  if (activeGame.value?.id === g.id) activeGame.value = g
  if (viewingScout.value?.id === g.id) viewingScout.value = g
}

async function openScoutReport(g: Game) {
  activeGame.value = null
  viewingScoutTeam.value = null
  viewingScout.value = g
  selectedPlayerId.value = null
  await fetchEvents(g.id)
}

// Leaving the tracker of a scouting report lands on the report itself.
async function leaveTracker() {
  const g = activeGame.value
  activeGame.value = null
  if (g?.is_scouting) await openScoutReport(g)
}

async function trackScout(g: Game) {
  viewingScout.value = null
  await openGame(g)
}

// Every report on one scouted team, combined.
const viewingScoutTeam = ref<string | null>(null)
const teamReports = computed(() =>
  viewingScoutTeam.value ? scoutReports.value.filter((g) => sameTeam(g.scouted_team, viewingScoutTeam.value)) : [],
)
const teamEvents = computed(() => {
  const ids = new Set(teamReports.value.map((g) => g.id))
  return allEvents.value.filter((e) => ids.has(e.game_id))
})
const teamRoster = computed(() => scoutPlayers.value.filter((p) => sameTeam(p.scout_team, viewingScoutTeam.value)))
const teamShots = ref<ShotEvent[]>([])

async function openScoutTeam(team: string) {
  viewingScout.value = null
  activeGame.value = null
  viewingScoutTeam.value = team
  teamShots.value = []
  teamShots.value = await fetchShotsForGames(teamReports.value.map((g) => g.id))
}

// Reports grouped by team (most recently scouted team first) for the list.
const scoutGroups = computed(() => {
  const groups: { team: string; reports: Game[] }[] = []
  for (const g of scoutReports.value) {
    const group = groups.find((x) => sameTeam(x.team, g.scouted_team))
    if (group) group.reports.push(g)
    else groups.push({ team: g.scouted_team?.trim() || 'Unknown team', reports: [g] })
  }
  return groups
})

// The Scouting tab lists stat reports, with diagrammed plays on a sub-tab.
const scoutingView = computed<'reports' | 'plays'>({
  get: () => (route.query.view === 'plays' ? 'plays' : 'reports'),
  set: (v) => { router.replace({ query: { mode: 'scouting', ...(v === 'plays' ? { view: 'plays' } : {}) } }) },
})

// ----- season stats -----
const seasonStats = computed(() => buildSeasonStats(rosterFor(seasonEvents.value, players.value), seasonEvents.value))
const seasonGames = computed(() => new Set(seasonEvents.value.map((e) => e.game_id)).size)

// Season shot chart / heat map across all our games; tap a player to filter.
const seasonShots = ref<ShotEvent[]>([])
const seasonPlayerId = ref<string | null>(null)
const seasonPeriod = ref<number | 'all'>('all')
watch(
  () => mode.value === 'season' && ourGames.value.map((g) => g.id).join(','),
  async (key) => {
    if (!key) return
    seasonShots.value = await fetchShotsForGames(ourGames.value.map((g) => g.id))
  },
  { immediate: true },
)
</script>

<template>
  <section class="flex flex-col gap-4">
    <!-- Sticky page header: page title + tabs, or the open game's controls -->
    <div
      data-stats-header
      class="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 bg-ink-900/95 px-4 pt-6 pb-2 backdrop-blur-xl">
      <h1 v-if="!inGame" class="font-stencil text-xl font-bold capitalize leading-tight">Stats</h1>
      <template v-if="inGame && activeGame">
        <button class="inline-flex items-center gap-1 py-1.5" @click="leaveTracker">
          <ArrowLeftIcon class="h-5 w-5 text-chalk" />
          <span class="font-stencil text-[clamp(0.875rem,2vw,1.15rem)] font-bold uppercase text-chalk">{{ isScout ? 'Report' : 'Games' }}</span>
        </button>
        <button
          class="group text-left font-stencil text-[clamp(0.875rem,2vw,1.15rem)] font-bold uppercase leading-tight"
          :title="isScout ? 'Edit matchup details' : 'Edit game details'"
          @click="openEditGameSheet()"
        >
          <template v-if="isScout">{{ activeGame.scouted_team }} <span class="text-ink-500">vs</span> {{ activeGame.opponent }}</template>
          <template v-else>vs {{ activeGame.opponent }}</template><PencilIcon class="ml-1 inline h-3.5 w-3.5 align-baseline text-ink-500 group-hover:text-chalk" /><br />
          <span class="font-sans text-xs font-normal normal-case text-ink-500">{{ activeGame.played_on }}<template v-if="activeGame.location"> · {{ activeGame.location }}</template></span>
        </button>
        <button
          v-if="!editingScore"
          class="inline-flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-800 px-2 py-1 font-mono text-xs hover:text-chalk"
          :title="hasFinal(activeGame) ? 'Edit final score' : 'Record final score'"
          @click="startEditScore"
        >
          <template v-if="hasFinal(activeGame)">
            <span
              class="font-bold"
              :class="resultLabel(activeGame) === 'W' ? 'text-green-400' : resultLabel(activeGame) === 'L' ? 'text-rim' : 'text-ink-400'"
            >{{ resultLabel(activeGame) }}</span>
            {{ activeGame.our_score }}–{{ activeGame.opp_score }}
          </template>
          <span v-else class="font-sans text-ink-400">Final score</span>
        </button>
        <form v-else class="flex items-center gap-1" @submit.prevent="saveScore">
          <input
            v-model.number="ourScoreInput"
            type="number" min="0" inputmode="numeric" aria-label="Our score"
            class="input w-14 py-1 text-center text-xs"
          />
          <span class="text-ink-500">–</span>
          <input
            v-model.number="oppScoreInput"
            type="number" min="0" inputmode="numeric" :aria-label="`${activeGame.opponent} score`"
            :placeholder="activeGame.opponent.slice(0, 3).toUpperCase()"
            class="input w-14 py-1 text-center text-xs"
          />
          <button type="submit" class="text-home" title="Save score"><CheckIcon class="h-5 w-5" /></button>
          <button type="button" class="text-ink-500" title="Cancel" @click="editingScore = false"><XMarkIcon class="h-5 w-5" /></button>
        </form>
        <button
          v-if="isScout"
          class="inline-flex items-center gap-1 rounded-lg border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-gray-300 hover:text-chalk"
          title="Scouting notes"
          @click="showScoutNotes = true"
        ><DocumentTextIcon class="h-4 w-4" />Notes</button>

        <!-- Period selector, team fouls, undo, export -->
        <div class="ml-auto flex items-center gap-1">
          <span
            class="mr-1 rounded px-2 py-1 text-[11px] font-semibold"
            :class="teamFouls >= BONUS_AT ? 'bg-rim/20 text-rim' : 'text-ink-500'"
            :title="`Team fouls this ${activePeriod > 4 ? 'overtime (4th quarter counts carry over)' : 'quarter'}`"
          >Fouls {{ teamFouls }}<template v-if="teamFouls >= BONUS_AT"> · BONUS</template></span>
          <button
            v-for="p in PERIODS"
            :key="p.value"
            class="rounded px-2.5 py-1 text-xs font-bold transition"
            :class="activePeriod === p.value ? 'bg-rim text-white' : 'bg-ink-700 text-ink-500 hover:text-chalk'"
            @click="activePeriod = p.value"
          >{{ p.label }}</button>
          <button
            class="rounded px-2 py-1 text-xs font-bold text-ink-500 hover:text-chalk"
            title="Add another overtime" aria-label="Add another overtime"
            @click="addOvertime"
          >+OT</button>
          <button
            v-if="selectedPlayer && selectedHasEvents"
            class="ml-1 hidden rounded-lg bg-away p-1.5 text-white hover:bg-away/90 md:inline-flex"
            title="Undo last stat" aria-label="Undo last stat"
            @click="onUndo(selectedPlayerId!)"
          ><ArrowUturnLeftIcon class="h-5 w-5" /></button>
          <button
            class="ml-1 hidden rounded-lg border border-ink-700 bg-ink-800 p-1.5 text-ink-400 hover:text-chalk md:inline-flex"
            title="Export box score (CSV)" aria-label="Export box score"
            @click="exportCsv"
          ><ArrowDownTrayIcon class="h-5 w-5" /></button>
        </div>
      </template>
      <!-- Mode tabs -->
      <div v-if="!inGame" class="flex gap-1 ml-auto rounded-lg bg-ink-800 p-0.5">
        <button
          class="rounded-md px-3 py-1 text-xs font-semibold transition"
          :class="mode === 'game' ? 'bg-rim text-white' : 'text-ink-500 hover:text-chalk'"
          @click="mode = 'game'"
        >Game</button>
        <button
          class="rounded-md px-3 py-1 text-xs font-semibold transition"
          :class="mode === 'season' ? 'bg-rim text-white' : 'text-ink-500 hover:text-chalk'"
          @click="mode = 'season'"
        >Season</button>
        <button
          v-if="canEdit"
          class="rounded-md px-3 py-1 text-xs font-semibold transition"
          :class="mode === 'scouting' ? 'bg-rim text-white' : 'text-ink-500 hover:text-chalk'"
          @click="mode = 'scouting'"
        >Scouting</button>
      </div>

      <button
        v-if="mode === 'season'"
        class="inline-flex items-center justify-center gap-1 rounded-md px-3 bg-ink-500 py-1.5 text-xs hover:bg-ink-500/90 disabled:opacity-40"
        title="Export season CSV"
        :disabled="!seasonEvents.length"
        @click="exportSeasonCsv">
        <FolderArrowDownIcon class="h-5 w-5" />Export
      </button>

      <button
        v-if="mode === 'game' && !inGame && canEdit"
        class="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs bg-rim hover:bg-rim/80 sm:px-3"
        title="New game" aria-label="New game"
        @click="openNewGameSheet"
      ><PlusIcon class="h-5 w-5" /><span class="hidden sm:inline">New Game</span></button>
      <button
        v-if="mode === 'scouting' && !inGame && !viewingScout && !viewingScoutTeam && scoutingView === 'reports'"
        class="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs bg-rim hover:bg-rim/80 sm:px-3"
        title="New scouting report" aria-label="New scouting report"
        @click="openNewScoutSheet"
      ><PlusIcon class="h-5 w-5" /><span class="hidden sm:inline">Scouting Report</span></button>
    </div>
    <hr class="h-[2px] bg-ink-700/60 border-0 rounded-lg" />

    <div v-if="error" class="flex items-start gap-3 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert">
      <p class="grow">
        {{ error }}
        <span v-if="needsMigration" class="mt-1 block text-red-200/80">
          The database is missing a recent update — run the newest migration at the end of
          <code class="font-mono">supabase/schema.sql</code> in the Supabase SQL Editor.
        </span>
      </p>
      <button class="shrink-0 rounded p-0.5 hover:bg-red-500/20 hover:text-red-200" title="Dismiss" aria-label="Dismiss error" @click="error = null">
        <XMarkIcon class="h-5 w-5" />
      </button>
    </div>

    <!-- ==================== GAME MODE ==================== -->
    <template v-if="mode === 'game' || inGame">

      <!-- A game opened read-only (players) -->
      <ScoutReportView
        v-if="!inGame && viewingGame"
        :game="viewingGame"
        :roster="players"
        :events="events"
        readonly
        @back="viewingGame = null"
      />

      <!-- No open game: game cards grid -->
      <template v-else-if="!inGame">
        <div v-if="!ourGames.length" class="flex h-48 items-center justify-center rounded-2xl border border-dashed border-ink-700 text-sm text-ink-500">
          <template v-if="canEdit">No games yet — tap <strong class="mx-1 text-chalk">New Game</strong> to start tracking.</template>
          <template v-else>No games yet.</template>
        </div>
        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div
            v-for="g in ourGames"
            :key="g.id"
            class="group relative cursor-pointer rounded-2xl border border-ink-700 bg-ink-800 p-4 transition hover:border-ink-600 hover:bg-ink-700"
            @click="canEdit ? openGame(g) : viewGame(g)">
            <p class="font-stencil font-bold leading-tight">vs {{ g.opponent }}</p>
            <p class="mt-1 text-xs text-ink-500">{{ g.played_on }}<template v-if="g.location"> · {{ g.location }}</template></p>
            <p v-if="hasFinal(g)" class="mt-2 font-mono text-sm">
              <span
                class="mr-1 font-bold"
                :class="resultLabel(g) === 'W' ? 'text-green-400' : resultLabel(g) === 'L' ? 'text-rim' : 'text-ink-400'"
              >{{ resultLabel(g) }}</span>{{ g.our_score }}–{{ g.opp_score }}
            </p>
            <button
              v-if="canEdit"
              class="absolute right-2 top-2 rounded p-1 text-[10px] text-red-500 hover:text-red-300 group-hover:block"
              @click.stop="onDeleteGame(g)">
              <TrashIcon class="h-4 w-4" />
            </button>
          </div>
        </div>
      </template>

      <!-- Open game or scouting report: stat column | shot chart over box score -->
      <template v-else-if="activeGame">
        <div ref="trackerEl" class="flex gap-3" :style="{ '--tracker-top': `${trackerTop}px` }">

          <!-- Stat column (tablet/desktop; phones get the bottom stat pad) -->
          <div class="stat-column hidden w-32 shrink-0 flex-col gap-2 md:flex">
            <button
              class="inline-flex items-center justify-center gap-1.5 rounded-lg border border-ink-700 bg-ink-800 py-2 text-sm text-gray-300 hover:text-chalk"
              @click="showRosterDrawer = true">
              <UserGroupIcon class="h-5 w-5" />Roster
            </button>
            <p class="truncate text-center text-xs" :class="selectedPlayer ? 'font-semibold text-rim' : 'italic text-ink-500'">
              {{ selectedPlayer ? `#${selectedPlayer.number ?? '—'} ${selectedPlayer.name}` : 'Pick a player' }}
            </p>
            <button
              v-for="b in FT_STATS"
              :key="b.stat"
              class="stat-btn rounded-lg text-sm font-bold transition"
              :class="[b.tone, selectedPlayerId ? 'hover:brightness-125 active:scale-95' : 'cursor-default opacity-30']"
              :disabled="!selectedPlayerId"
              @click="tap(b.stat)"
            >{{ b.label }}</button>
            <div class="my-0.5 border-t border-ink-700" />
            <button
              v-for="b in ACTION_STATS"
              :key="b.stat"
              class="stat-btn rounded-lg text-sm font-bold transition"
              :class="[b.tone, selectedPlayerId ? 'hover:brightness-125 active:scale-95' : 'cursor-default opacity-30']"
              :disabled="!selectedPlayerId"
              @click="tap(b.stat)"
            >{{ b.label }}</button>
          </div>

          <!-- Shot chart, then box score (side by side on wide screens) -->
          <div class="boxscore-shotchart-container flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden lg:flex-row lg:overflow-y-hidden">
            <ShotChart
              v-model:filter="boxPeriod"
              :game-id="activeGame.id"
              :player-id="selectedPlayerId"
              :period="activePeriod"/>

            <!-- Box score (tap a row to select the player) -->
            <div class="boxscore card min-w-0 overflow-auto p-3 lg:w-1/2">
              <h2 class="mb-2 font-stencil font-bold">
                Box Score<span v-if="boxPeriod !== 'all'" class="ml-2 font-sans text-xs font-normal text-ink-500">{{ periodLabel(boxPeriod) }} only</span>
              </h2>
              <table class="w-full text-right font-mono text-sm">
                <thead class="text-ink-500">
                  <tr class="border-b border-ink-700">
                    <th class="py-1 text-left">Player</th>
                    <th>PTS</th><th>FG</th><th>3P</th><th>FT</th>
                    <th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TOV</th><th>PF</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="r in shownBoxScore"
                    :key="r.player_id"
                    class="cursor-pointer border-b border-ink-800 transition"
                    :class="selectedPlayerId === r.player_id
                      ? 'bg-ink-700'
                      : 'hover:bg-ink-800/70'"
                    @click="selectedPlayerId = selectedPlayerId === r.player_id ? null : r.player_id"
                  >
                    <td class="py-2 text-left">
                      <span
                        class="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                        :class="playedIds.has(r.player_id) ? 'bg-green-400' : 'bg-transparent'"
                        :title="playedIds.has(r.player_id) ? 'Has stats this game' : undefined"
                      />
                      <span class="font-mono text-xs text-ink-500">#{{ r.number ?? '—' }}</span>
                      <span class="ml-1">{{ r.name }}</span>
                    </td>
                    <td class="font-bold text-chalk relative">{{ r.pts }}<StatFlash :items="flashesFor(r.player_id, 'pts')" /></td>
                    <td class="relative">{{ r.fgm }}/{{ r.fga }}<StatFlash :items="flashesFor(r.player_id, 'fg')" /></td>
                    <td class="relative">{{ r.tpm }}/{{ r.tpa }}<StatFlash :items="flashesFor(r.player_id, 'tp')" /></td>
                    <td class="relative">{{ r.ftm }}/{{ r.fta }}<StatFlash :items="flashesFor(r.player_id, 'ft')" /></td>
                    <td class="relative">{{ r.reb }}<StatFlash :items="flashesFor(r.player_id, 'reb')" /></td>
                    <td class="relative">{{ r.ast }}<StatFlash :items="flashesFor(r.player_id, 'ast')" /></td>
                    <td class="relative">{{ r.stl }}<StatFlash :items="flashesFor(r.player_id, 'stl')" /></td>
                    <td class="relative">{{ r.blk }}<StatFlash :items="flashesFor(r.player_id, 'blk')" /></td>
                    <td class="relative">{{ r.tov }}<StatFlash :items="flashesFor(r.player_id, 'tov')" /></td>
                    <td class="relative" :class="boxPeriod === 'all' ? foulTone(r.player_id) : ''" :title="fouls.get(r.player_id) ? `${fouls.get(r.player_id)} fouls this game` : undefined">{{ r.pf }}<StatFlash :items="flashesFor(r.player_id, 'pf')" /></td>
                  </tr>
                </tbody>
                <tfoot v-if="shownBoxScore.length" class="font-semibold text-chalk">
                  <tr class="border-t border-ink-600">
                    <td class="py-2 text-left">Team</td>
                    <td>{{ boxScoreTotals.pts }}</td>
                    <td :title="formatPct(boxScoreTotals.fgm, boxScoreTotals.fga)">{{ boxScoreTotals.fgm }}/{{ boxScoreTotals.fga }}</td>
                    <td :title="formatPct(boxScoreTotals.tpm, boxScoreTotals.tpa)">{{ boxScoreTotals.tpm }}/{{ boxScoreTotals.tpa }}</td>
                    <td :title="formatPct(boxScoreTotals.ftm, boxScoreTotals.fta)">{{ boxScoreTotals.ftm }}/{{ boxScoreTotals.fta }}</td>
                    <td>{{ boxScoreTotals.reb }}</td><td>{{ boxScoreTotals.ast }}</td><td>{{ boxScoreTotals.stl }}</td>
                    <td>{{ boxScoreTotals.blk }}</td><td>{{ boxScoreTotals.tov }}</td><td>{{ boxScoreTotals.pf }}</td>
                  </tr>
                  <tr class="text-xs font-normal text-ink-500">
                    <td class="text-left">Shooting</td>
                    <td></td>
                    <td>{{ formatPct(boxScoreTotals.fgm, boxScoreTotals.fga) }}</td>
                    <td>{{ formatPct(boxScoreTotals.tpm, boxScoreTotals.tpa) }}</td>
                    <td>{{ formatPct(boxScoreTotals.ftm, boxScoreTotals.fta) }}</td>
                    <td colspan="6"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        <!-- Phone stat pad: big thumb-reachable buttons pinned above the tab bar -->
        <div
          class="fixed inset-x-0 z-20 border-t border-ink-700/60 bg-ink-900/95 px-3 pb-2 pt-2 backdrop-blur-xl md:hidden"
          style="bottom: calc(62px + env(safe-area-inset-bottom, 0px))"
        >
          <div class="mb-2 flex items-center gap-2">
            <template v-if="selectedPlayer">
              <span class="font-mono text-xl font-black leading-none text-rim">#{{ selectedPlayer.number ?? '—' }}</span>
              <span class="truncate text-sm font-semibold">{{ selectedPlayer.name }}</span>
            </template>
            <span v-else class="text-sm italic text-ink-500">Tap a player in the box score</span>
            <button
              class="ml-auto rounded-lg bg-ink-800 p-2 text-ink-400"
              title="Roster" aria-label="Roster"
              @click="showRosterDrawer = true"
            ><UserGroupIcon class="h-5 w-5" /></button>
            <button
              class="rounded-lg bg-ink-800 p-2 text-ink-400"
              title="Export box score (CSV)" aria-label="Export box score"
              @click="exportCsv"
            ><ArrowDownTrayIcon class="h-5 w-5" /></button>
            <button
              v-if="selectedPlayer"
              class="rounded-lg bg-ink-800 p-2 text-ink-400 disabled:opacity-30"
              :disabled="!selectedHasEvents"
              title="Undo last stat" aria-label="Undo last stat"
              @click="onUndo(selectedPlayerId!)"
            ><ArrowUturnLeftIcon class="h-5 w-5" /></button>
          </div>
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="b in FT_STATS"
              :key="b.stat"
              class="col-span-2 min-h-[52px] rounded-xl text-sm font-bold transition"
              :class="[b.tone, selectedPlayerId ? 'active:scale-95 active:brightness-125' : 'opacity-30']"
              :disabled="!selectedPlayerId"
              @click="tap(b.stat)"
            >{{ b.label }}</button>
            <button
              v-for="b in ACTION_STATS"
              :key="b.stat"
              class="min-h-[52px] rounded-xl text-sm font-bold transition"
              :class="[b.tone, selectedPlayerId ? 'active:scale-95 active:brightness-125' : 'opacity-30']"
              :disabled="!selectedPlayerId"
              @click="tap(b.stat)"
            >{{ b.label }}</button>
          </div>
        </div>
      </template>
    </template>

    <!-- ==================== SCOUTING ==================== -->
    <template v-else-if="mode === 'scouting'">
      <ScoutTeamView
        v-if="viewingScoutTeam"
        :team="viewingScoutTeam"
        :reports="teamReports"
        :roster="teamRoster"
        :events="teamEvents"
        :shots="teamShots"
        @back="viewingScoutTeam = null"
        @open-report="openScoutReport"
      />
      <ScoutReportView
        v-else-if="viewingScout"
        :game="viewingScout"
        :roster="rosterPool"
        :events="events"
        @back="viewingScout = null"
        @track="trackScout(viewingScout)"
        @edit-details="openEditGameSheet(viewingScout)"
        @edit-notes="showScoutNotes = true"
        @team="openScoutTeam(viewingScout.scouted_team ?? '')"
      />
      <template v-else>
        <div class="flex gap-1 self-start rounded-lg bg-ink-800 p-0.5" role="tablist">
          <button
            class="rounded-md px-3 py-1 text-xs font-semibold transition"
            :class="scoutingView === 'reports' ? 'bg-ink-600 text-chalk' : 'text-ink-500 hover:text-chalk'"
            role="tab" :aria-selected="scoutingView === 'reports'"
            @click="scoutingView = 'reports'"
          >Reports</button>
          <button
            class="rounded-md px-3 py-1 text-xs font-semibold transition"
            :class="scoutingView === 'plays' ? 'bg-ink-600 text-chalk' : 'text-ink-500 hover:text-chalk'"
            role="tab" :aria-selected="scoutingView === 'plays'"
            @click="scoutingView = 'plays'"
          >Scouted plays</button>
        </div>

        <PlaysView v-if="scoutingView === 'plays'" scouting />
        <template v-else>
          <div
            v-if="!scoutReports.length"
            class="flex h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-ink-700 px-6 text-center text-sm text-ink-500"
          >
            <p>Track an opponent's stats from film or the stands, with notes on their personnel and schemes.</p>
            <button class="btn-primary" @click="openNewScoutSheet"><PlusIcon class="h-5 w-5" />New scouting report</button>
          </div>
          <section v-for="grp in scoutGroups" v-else :key="grp.team" class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <h2 class="font-stencil text-lg font-bold uppercase">{{ grp.team }}</h2>
              <span class="text-xs text-ink-500">{{ grp.reports.length }} report{{ grp.reports.length === 1 ? '' : 's' }}</span>
              <button class="btn-ghost ml-auto py-1 text-xs" @click="openScoutTeam(grp.team)">
                <ChartBarIcon class="h-4 w-4" />Team overview
              </button>
            </div>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div
                v-for="g in grp.reports"
                :key="g.id"
                class="group relative cursor-pointer rounded-2xl border border-ink-700 bg-ink-800 p-4 transition hover:border-ink-600 hover:bg-ink-700"
                @click="openScoutReport(g)">
                <p class="pr-5 font-stencil font-bold leading-tight">vs {{ g.opponent }}</p>
                <p class="mt-1 text-xs text-ink-500">{{ g.played_on }}<template v-if="g.location"> · {{ g.location }}</template></p>
                <p v-if="hasFinal(g)" class="mt-2 font-mono text-sm">
                  <span
                    class="mr-1 font-bold"
                    :class="resultLabel(g) === 'W' ? 'text-green-400' : resultLabel(g) === 'L' ? 'text-rim' : 'text-ink-400'"
                  >{{ resultLabel(g) }}</span>{{ g.our_score }}–{{ g.opp_score }}
                </p>
                <button
                  class="absolute right-2 top-2 rounded p-1 text-red-500 hover:text-red-300"
                  title="Delete report" aria-label="Delete report"
                  @click.stop="onDeleteGame(g)">
                  <TrashIcon class="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>
        </template>
      </template>
    </template>

    <!-- ==================== SEASON MODE ==================== -->
    <template v-else>
      <div class="flex flex-col gap-4 pb-24 lg:flex-row lg:items-start">
        <div class="card min-w-0 overflow-x-auto p-4 lg:w-1/2">
          <h2 class="mb-1 font-stencil font-bold">Season Stats</h2>
          <p class="mb-4 text-xs text-ink-500">
            Aggregated across all recorded games. {{ seasonPlayerId ? 'The shot chart shows the selected player.' : 'Tap a player to chart their shots.' }}
          </p>
          <div class="min-w-[640px]">
            <SeasonStatsTable
              :rows="seasonStats"
              :games="seasonGames"
              :selected-id="seasonPlayerId"
              empty-text="No season data yet. Record some game stats first."
              @select="seasonPlayerId = $event"
            />
          </div>
        </div>
        <div class="scout-shotchart mx-auto flex w-full min-w-0 max-w-lg flex-col lg:mx-0 lg:w-1/2 lg:max-w-none">
          <ShotChart
            v-model:filter="seasonPeriod"
            :game-id="null"
            :player-id="seasonPlayerId"
            :period="1"
            :shots-source="seasonShots"
            :events-source="seasonEvents"
            default-view="zones"
            readonly
          />
        </div>
      </div>
    </template>
  </section>

  <!-- New Game sheet: slides down from top -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-300 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="gameSheet"
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        @click="gameSheet = null"
      />
    </Transition>
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="-translate-y-full"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-to-class="-translate-y-full"
    >
      <div
        v-if="gameSheet"
        class="fixed inset-x-0 top-0 z-50 rounded-b-3xl border-b border-ink-700 bg-ink-900 px-4 pb-8 pt-4 shadow-2xl w-full lg:w-1/3 lg:mx-auto lg:mt-10"
      >
        <div class="mb-4 flex items-center justify-between">
          <h2 class="font-stencil text-lg font-bold">
            {{ gameSheet === 'new-scout' ? 'New Scouting Report' : sheetIsScout ? 'Matchup Details' : gameSheet === 'edit' ? 'Game Details' : 'New Game' }}
          </h2>
          <button class="btn-ghost p-1.5" title="Cancel" aria-label="Cancel" @click="gameSheet = null"><XMarkIcon class="h-5 w-5" /></button>
        </div>
        <div class="flex flex-col gap-3">
          <div v-if="sheetIsScout">
            <label class="label" for="ng-scouted">Team being scouted</label>
            <input
              id="ng-scouted"
              v-model="sheetScoutedTeam"
              class="input"
              placeholder="e.g. Hartselle"
              list="ng-scouted-teams"
              autofocus
              autocomplete="off"
            />
            <datalist id="ng-scouted-teams">
              <option v-for="t in knownScoutTeams" :key="t" :value="t" />
            </datalist>
          </div>
          <div>
            <label class="label" for="ng-opponent">{{ sheetIsScout ? 'Playing against' : 'Opponent' }}</label>
            <input
              id="ng-opponent"
              v-model="sheetOpponent"
              class="input"
              placeholder="e.g. West Morgan"
              :autofocus="!sheetIsScout"
              autocomplete="off"
              @keyup.enter="onSubmitGameSheet"
            />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="min-w-0">
              <label class="label" for="ng-date">{{ sheetIsScout ? 'Date played' : 'Date' }}</label>
              <input id="ng-date" v-model="sheetDate" type="date" class="input min-w-0" />
            </div>
            <div class="min-w-0">
              <label class="label" for="ng-location">Location (optional)</label>
              <input id="ng-location" v-model="sheetLocation" class="input" placeholder="Home, Away, gym…" autocomplete="off" />
            </div>
          </div>
          <div v-if="sheetIsScout">
            <span class="label">Final score (optional)</span>
            <div class="flex items-center gap-2">
              <input
                v-model.number="sheetTeamScore"
                type="number" min="0" inputmode="numeric" class="input w-20 text-center"
                :aria-label="`${sheetScoutedTeam || 'Scouted team'} score`"
                :placeholder="(sheetScoutedTeam || 'Them').slice(0, 4)"
              />
              <span class="text-ink-500">–</span>
              <input
                v-model.number="sheetOppScore"
                type="number" min="0" inputmode="numeric" class="input w-20 text-center"
                :aria-label="`${sheetOpponent || 'Opponent'} score`"
                :placeholder="(sheetOpponent || 'Opp').slice(0, 4)"
              />
            </div>
          </div>
          <div v-else>
            <label class="label" for="ng-notes">Notes (optional)</label>
            <textarea id="ng-notes" v-model="sheetNotes" rows="2" class="input resize-none" placeholder="Tournament, keys to the game…" />
          </div>
          <button
            class="btn-primary py-3 text-sm font-semibold"
            :disabled="!sheetValid || savingGame"
            @click="onSubmitGameSheet"
          >{{ savingGame ? 'Saving…' : gameSheet === 'edit' ? 'Save details' : gameSheet === 'new-scout' ? 'Start tracking' : 'Start game' }}</button>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Roster slide-out drawer -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-300 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showRosterDrawer"
        class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        @click="showRosterDrawer = false"
      />
    </Transition>
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="-translate-x-full"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-to-class="-translate-x-full"
    >
      <div
        v-if="showRosterDrawer"
        class="fixed bottom-0 left-0 top-0 z-50 w-72 overflow-y-auto border-r border-ink-700 bg-ink-900 p-4 shadow-2xl"
      >
        <div class="mb-4 flex items-center justify-between">
          <h2 class="font-stencil text-lg font-bold">{{ isScout ? `${scoutTeam} Roster` : 'Roster' }}</h2>
          <button class="btn-ghost p-1.5" title="Close" aria-label="Close" @click="showRosterDrawer = false"><XMarkIcon class="h-5 w-5" /></button>
        </div>

        <p v-if="isScout && !activePlayers.length" class="mb-4 text-sm text-ink-500">
          Add {{ scoutTeam }}'s players by number and name. Every report on {{ scoutTeam }} shares this roster.
        </p>
        <ul class="mb-4 space-y-1 text-sm">
          <li v-for="p in activePlayers" :key="p.id">
            <template v-if="editingPlayerId === p.id">
              <div class="flex gap-1">
                <input
                  v-model.number="editPlayerNumber"
                  type="number"
                  placeholder="#"
                  class="input w-12 py-1 text-center text-xs"
                />
                <input
                  v-model="editPlayerName"
                  class="input grow py-1 text-xs"
                  @keyup.enter="saveEditPlayer(p.id)"
                />
                <button class="text-xs text-home" @click="saveEditPlayer(p.id)">
                  <CheckIcon class="h-5 w-5" />
                </button>
                <button class="text-xs text-ink-500" @click="editingPlayerId = null">
                  <XMarkIcon class="h-5 w-5" />
                </button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-ink-800">
                <span class="w-7 shrink-0 text-right font-mono text-ink-500">{{ p.number ?? '—' }}</span>
                <span class="grow">{{ p.name }}</span>
                <button class="text-[10px] text-ink-500 hover:text-chalk" @click="startEditPlayer(p)">
                  <PencilIcon class="h-5 w-5" />
                </button>
                <button
                  class="text-[10px] text-ink-500 hover:text-chalk"
                  title="Retire player" aria-label="Retire player"
                  @click="onRetirePlayer(p)"
                >
                  <ArchiveBoxIcon class="h-5 w-5" />
                </button>
              </div>
            </template>
          </li>
        </ul>

        <details v-if="retiredPlayers.length" class="mb-4 text-sm">
          <summary class="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-500">
            Retired ({{ retiredPlayers.length }})
          </summary>
          <ul class="mt-2 space-y-1">
            <li v-for="p in retiredPlayers" :key="p.id" class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-ink-500">
              <span class="w-7 shrink-0 text-right font-mono">{{ p.number ?? '—' }}</span>
              <span class="grow">{{ p.name }}</span>
              <button
                class="hover:text-chalk"
                title="Reactivate player" aria-label="Reactivate player"
                @click="onReactivatePlayer(p)"
              ><ArrowUturnUpIcon class="h-5 w-5" /></button>
            </li>
          </ul>
        </details>

        <div class="border-t border-ink-700 pt-4">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Add player</p>
          <div class="flex gap-2">
            <input v-model.number="newPlayerNumber" type="number" placeholder="#" class="input w-14 text-center" />
            <input v-model="newPlayerName" placeholder="Name" class="input grow" @keyup.enter="onAddPlayer" />
          </div>
          <button class="btn-ghost mt-2 w-full py-1.5 text-xs" @click="onAddPlayer"><UserPlusIcon class="h-4 w-4" />Add player</button>
        </div>
      </div>
    </Transition>
  </Teleport>

  <ScoutNotesDrawer
    v-if="notesGame"
    :game="notesGame"
    :open="showScoutNotes"
    @close="showScoutNotes = false"
    @saved="onNotesSaved"
  />
</template>
