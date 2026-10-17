<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Game, Player, StatEvent, StatType } from '@/types'
import { useStats } from '@/composables/useStats'
import { useShotChart } from '@/composables/useShotChart'
import { useConfirm } from '@/composables/useConfirm'
import { useToast } from '@/composables/useToast'
import { buildBoxScore, buildSeasonStats, boxScoreToCsv, downloadCsv, formatPct, periodLabel, seasonStatsToCsv, teamTotals } from '@/lib/stats-utils'
import ShotChart from '@/components/ShotChart.vue'
import PlaysView from '@/views/PlaysView.vue'
import StatFlash from '@/components/StatFlash.vue'
import TrashIcon from '@heroicons/vue/24/outline/TrashIcon'
import { ArchiveBoxIcon, ArrowLeftIcon, ArrowsRightLeftIcon, ArrowUturnUpIcon, ArrowUturnLeftIcon, CheckIcon, FolderArrowDownIcon, PencilIcon, PlusIcon, UserGroupIcon, UserPlusIcon, XMarkIcon } from '@heroicons/vue/24/outline'

const {
  players, games, events, allEvents, subEvents, error,
  fetchPlayers, fetchGames, fetchEvents, fetchAllEvents,
  fetchSubEvents, recordSub, deleteSub,
  addPlayer, updatePlayer,
  createGame, updateGame, deleteGame,
  recordStat, undoLastFor,
} = useStats()
const { shots, deleteShot } = useShotChart()
const { confirm } = useConfirm()
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
    return m === 'season' || m === 'scouting' ? m : 'game'
  },
  set: (m) => {
    router.replace({ query: m === 'game' ? {} : { mode: m } })
  },
})

const activeGame = ref<Game | null>(null)
// The game tracker (and its header controls) only shows on the Game tab; a
// game left open stays open underneath Season/Scouting.
const inGame = computed(() => mode.value === 'game' && !!activeGame.value)

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
  if (game && !activeGame.value) await openGame(game)
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

const activePlayers = computed(() => players.value.filter((p) => p.active !== false))
const retiredPlayers = computed(() => players.value.filter((p) => p.active === false))

// Box scores list the current roster plus any retired player who has stats in
// the events being summarised, so history never loses a name.
function rosterFor(evts: StatEvent[]): Player[] {
  const withStats = new Set(evts.map((e) => e.player_id))
  return players.value.filter((p) => p.active !== false || withStats.has(p.id))
}

// ----- game sheet: create a game, or edit the open one's details -----
const gameSheet = ref<'new' | 'edit' | null>(null)
const sheetOpponent = ref('')
const sheetDate = ref('')
const sheetLocation = ref('')
const sheetNotes = ref('')
const savingGame = ref(false)

function openNewGameSheet() {
  sheetOpponent.value = ''
  sheetDate.value = new Date().toLocaleDateString('en-CA')
  sheetLocation.value = ''
  sheetNotes.value = ''
  gameSheet.value = 'new'
}

function openEditGameSheet() {
  const g = activeGame.value
  if (!g) return
  sheetOpponent.value = g.opponent
  sheetDate.value = g.played_on
  sheetLocation.value = g.location ?? ''
  sheetNotes.value = g.notes ?? ''
  gameSheet.value = 'edit'
}

async function onSubmitGameSheet() {
  if (!sheetOpponent.value.trim() || !sheetDate.value || savingGame.value) return
  const details = {
    opponent: sheetOpponent.value.trim(),
    played_on: sheetDate.value,
    location: sheetLocation.value.trim() || null,
    notes: sheetNotes.value.trim() || null,
  }
  savingGame.value = true
  try {
    if (gameSheet.value === 'edit' && activeGame.value) {
      const updated = await updateGame(activeGame.value.id, details)
      if (!updated) {
        toast('Could not save game details', 'error')
        return
      }
      activeGame.value = updated
      gameSheet.value = null
      toast('Game details saved')
      return
    }
    const g = await createGame(details)
    if (g) {
      toast(`Game vs ${g.opponent} created`)
      gameSheet.value = null
      selectedPlayerId.value = null
      await openGame(g)
    }
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
  subPickerOpen.value = false
  await Promise.all([fetchEvents(g.id), fetchSubEvents(g.id)])
  if (activeGame.value?.id !== g.id) return // switched again while loading
  // Resume where the game left off: the saved quarter, else the latest one
  // that has stats.
  const latest = Math.max(1, ...events.value.map((e) => e.period ?? 1))
  const resume = live?.gameId === g.id ? live.period : latest
  maxPeriod.value = Math.max(5, latest, resume)
  activePeriod.value = resume
}

async function onDeleteGame(g: Game) {
  const ok = await confirm({
    title: 'Delete game',
    message: `Delete game vs ${g.opponent}? All stat events will be removed.`,
    confirmText: 'Delete',
    tone: 'danger',
  })
  if (!ok) return
  await deleteGame(g.id)
  if (activeGame.value?.id === g.id) activeGame.value = null
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
const selectedPlayer = computed(() => players.value.find((p) => p.id === selectedPlayerId.value) ?? null)

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

// The box score can show the whole game or one quarter; `period` is stored on
// every stat event. The roster stays the whole game's so rows don't jump.
const boxPeriod = ref<number | 'all'>('all')
const boxPeriods = computed(() => {
  const latest = Math.max(4, ...events.value.map((e) => e.period ?? 1))
  return Array.from({ length: latest }, (_, i) => i + 1)
})
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

function exportSeasonCsv() {
  const csv = seasonStatsToCsv(buildSeasonStats(rosterFor(allEvents.value), allEvents.value))
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

// ----- on-floor lineup (derived from the sub log) -----
// There's no stored starting five, so infer it: walking the subs in order,
// a player's last sub decides whether they're on or off. A player who never
// appears in a sub but has stats this game must have played without being
// subbed, so count them as on the floor.
const onCourtIds = computed(() => {
  const state = new Map<string, boolean>()
  for (const sub of subEvents.value) {
    state.set(sub.player_id_in, true)
    state.set(sub.player_id_out, false)
  }
  for (const e of events.value) {
    if (!state.has(e.player_id)) state.set(e.player_id, true)
  }
  return new Set([...state].filter(([, on]) => on).map(([id]) => id))
})

const onCourtPlayers = computed(() => players.value.filter((p) => onCourtIds.value.has(p.id)))

// ----- substitution UI -----
const subPickerOpen = ref(false)

async function doSub(playerIdOut: string) {
  if (!activeGame.value || !selectedPlayerId.value) return
  await recordSub(activeGame.value.id, selectedPlayerId.value, playerIdOut, activePeriod.value)
  subPickerOpen.value = false
}

// A sub brings a bench player on for someone on the floor — so the selected
// player must be on the bench, and only on-floor players can go out.
const selectedOnCourt = computed(() => !!selectedPlayerId.value && onCourtIds.value.has(selectedPlayerId.value))

async function undoLastSub() {
  const last = subEvents.value[subEvents.value.length - 1]
  if (!last) return
  if (await deleteSub(last.id)) toast('Substitution undone')
}

function playerName(id: string) {
  return players.value.find((p) => p.id === id)?.name ?? 'Unknown'
}

// ----- season stats -----
const seasonBoxScore = computed(() => buildBoxScore(rosterFor(allEvents.value), allEvents.value))

// Same numbers as the season CSV (buildSeasonStats), formatted for display.
const seasonStats = computed(() =>
  buildSeasonStats(rosterFor(allEvents.value), allEvents.value).map((r) => ({
    ...r,
    ppg: r.gp ? r.ppg.toFixed(1) : '—',
    rpg: r.gp ? r.rpg.toFixed(1) : '—',
    apg: r.gp ? r.apg.toFixed(1) : '—',
    fgPct: formatPct(r.fgm, r.fga),
    tpPct: formatPct(r.tpm, r.tpa),
    ftPct: formatPct(r.ftm, r.fta),
  })),
)
const seasonTotals = computed(() => teamTotals(seasonBoxScore.value))
const seasonGames = computed(() => new Set(allEvents.value.map((e) => e.game_id)).size)
</script>

<template>
  <section class="flex flex-col gap-4">
    <!-- Sticky page header -->
    <div
      class="sticky top-0 z-10 -mx-4 flex items-center gap-3 bg-ink-900/95 px-4 pt-6 pb-1 backdrop-blur-xl">
      <h1 v-if="!inGame" class="font-stencil text-xl font-bold capitalize leading-tight">Stats</h1>
      <button
        v-if="inGame"
        class="inline-flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-xs" @click="activeGame = null">
        <ArrowLeftIcon class="h-5 w-5 text-chalk" />
        <span class="text-chalk text-[clamp(0.875rem,2vw,1.15rem)] font-stencil uppercase font-bold">Games</span>
      </button>
      <span class="grow"></span>
      <button
        v-if="inGame && selectedPlayer && selectedHasEvents"
        class="inline-flex items-center justify-center gap-1 rounded-md px-3 bg-away py-1 text-xs hover:bg-away/90"
        title="Undo last stat"
        @click="onUndo(selectedPlayerId!)">
        <ArrowUturnLeftIcon class="h-5 w-5" />Undo
      </button>
      <button
        v-if="inGame"
        class="inline-flex items-center justify-center gap-1 rounded-md px-3 bg-ink-500 py-1 text-xs hover:bg-ink-500/90"
        title="Export CSV"
        @click="exportCsv">
        <FolderArrowDownIcon class="h-5 w-5" />Export
      </button>
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
          class="rounded-md px-3 py-1 text-xs font-semibold transition"
          :class="mode === 'scouting' ? 'bg-rim text-white' : 'text-ink-500 hover:text-chalk'"
          @click="mode = 'scouting'"
        >Scouting</button>
      </div>

      <button
        v-if="mode === 'season'"
        class="inline-flex items-center justify-center gap-1 rounded-md px-3 bg-ink-500 py-1.5 text-xs hover:bg-ink-500/90 disabled:opacity-40"
        title="Export season CSV"
        :disabled="!allEvents.length"
        @click="exportSeasonCsv">
        <FolderArrowDownIcon class="h-5 w-5" />Export
      </button>

      <template v-if="mode === 'game'">
        <button
          v-if="!activeGame"
          class="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs bg-rim hover:bg-rim/80 sm:px-3"
          title="New game" aria-label="New game"
          @click="openNewGameSheet"
        ><PlusIcon class="h-5 w-5" /><span class="hidden sm:inline">New Game</span></button>
      </template>
    </div>
    
    <hr class="h-[2px] bg-ink-700/60 border-0 rounded-lg" />

    <p v-if="error" class="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
      {{ error }}
    </p>

    <!-- ==================== GAME MODE ==================== -->
    <template v-if="mode === 'game'">

      <!-- No active game: game cards grid -->
      <template v-if="!activeGame">
        <div v-if="!games.length" class="flex h-48 items-center justify-center rounded-2xl border border-dashed border-ink-700 text-sm text-ink-500">
          No games yet — tap <strong class="mx-1 text-chalk">New Game</strong> to start tracking.
        </div>
        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div
            v-for="g in games"
            :key="g.id"
            class="group relative cursor-pointer rounded-2xl border border-ink-700 bg-ink-800 p-4 transition hover:border-ink-600 hover:bg-ink-700"
            @click="openGame(g)">
            <p class="font-stencil font-bold leading-tight">vs {{ g.opponent }}</p>
            <p class="mt-1 text-xs text-ink-500">{{ g.played_on }}<template v-if="g.location"> · {{ g.location }}</template></p>
            <p v-if="hasFinal(g)" class="mt-2 font-mono text-sm">
              <span
                class="mr-1 font-bold"
                :class="resultLabel(g) === 'W' ? 'text-green-400' : resultLabel(g) === 'L' ? 'text-rim' : 'text-ink-400'"
              >{{ resultLabel(g) }}</span>{{ g.our_score }}–{{ g.opp_score }}
            </p>
            <button
              class="absolute right-2 top-2 rounded p-1 text-[10px] text-red-500 hover:text-red-300 group-hover:block"
              @click.stop="onDeleteGame(g)">
              <TrashIcon class="h-4 w-4" />
            </button>
          </div>
        </div>
      </template>

      <!-- Active game -->
      <template v-else>
        <!-- Game header bar: back | name | period selector -->
        <div class="flex flex-wrap gap-2">
          <button
            class="inline-flex items-center justify-center gap-1 rounded-lg border text-gray-300 border-ink-700 bg-ink-800 px-[0.5rem] py-1 text-xs hover:text-chalk"
            @click="showRosterDrawer = true">
            <UserGroupIcon class="h-5 w-5" />Roster
          </button>
          <button
            class="group text-left text-[clamp(0.875rem,2vw,1.75rem)] font-stencil uppercase leading-4 font-bold"
            title="Edit game details"
            @click="openEditGameSheet"
          >
            vs {{ activeGame.opponent }}<PencilIcon class="ml-1 inline h-3.5 w-3.5 align-baseline text-ink-500 group-hover:text-chalk" /><br />
            <span class="text-sm normal-case text-ink-500">{{ activeGame.played_on }}<template v-if="activeGame.location"> · {{ activeGame.location }}</template></span>
          </button>
          <button
            v-if="!editingScore"
            class="inline-flex items-center gap-1 self-center rounded-lg border border-ink-700 bg-ink-800 px-2 py-1 font-mono text-xs hover:text-chalk"
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
          <form
            v-else
            class="flex items-center gap-1 self-center"
            @submit.prevent="saveScore"
          >
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
              :class="activePeriod === p.value
                ? 'bg-rim text-white'
                : 'bg-ink-700 text-ink-500 hover:text-chalk'"
              @click="activePeriod = p.value"
            >{{ p.label }}</button>
            <button
              class="rounded px-2 py-1 text-xs font-bold text-ink-500 hover:text-chalk"
              title="Add another overtime" aria-label="Add another overtime"
              @click="addOvertime"
            >+OT</button>
          </div>
        </div>

        <!-- Sub picker (shown above main content when open) -->
        <div v-if="subPickerOpen && selectedPlayer" class="rounded-xl border border-yellow-500/30 bg-ink-800 p-3">
          <p v-if="selectedOnCourt" class="mb-2 text-xs text-ink-500">
            <span class="font-semibold text-yellow-400">{{ selectedPlayer.name }}</span> is already on the floor —
            select the bench player coming in, then tap sub.
          </p>
          <p v-else-if="!onCourtPlayers.length" class="mb-2 text-xs text-ink-500">
            Nobody is on the floor yet — record a stat for the starters first.
          </p>
          <p v-else class="mb-2 text-xs text-ink-500">
            <span class="font-semibold text-yellow-400">{{ selectedPlayer.name }}</span> comes IN for:
          </p>
          <div class="flex flex-wrap gap-1.5">
            <template v-if="!selectedOnCourt">
              <button
                v-for="other in onCourtPlayers"
                :key="other.id"
                class="rounded-lg bg-ink-600 px-3 py-1.5 text-xs text-chalk ring-1 ring-green-500/60 hover:bg-rim hover:text-white"
                @click="doSub(other.id)"
              >#{{ other.number ?? '—' }} {{ other.name }}</button>
            </template>
            <button class="text-ink-500 hover:text-chalk" title="Cancel" aria-label="Cancel" @click="subPickerOpen = false"><XMarkIcon class="h-5 w-5" /></button>
          </div>
        </div>

        <!-- On-floor lineup, inferred from substitutions -->
        <div v-if="onCourtPlayers.length" class="flex flex-wrap items-center gap-1.5 text-xs">
          <span class="text-ink-500">On floor</span>
          <button
            v-for="p in onCourtPlayers"
            :key="p.id"
            class="rounded-full border px-2 py-0.5 transition"
            :class="selectedPlayerId === p.id
              ? 'border-green-400 bg-green-500/20 text-chalk'
              : 'border-green-500/40 text-green-300 hover:bg-green-500/10'"
            @click="selectedPlayerId = selectedPlayerId === p.id ? null : p.id"
          >#{{ p.number ?? '—' }} {{ p.name.split(' ')[0] }}</button>
          <span v-if="onCourtPlayers.length !== 5" class="text-[11px] text-yellow-400/80">
            ({{ onCourtPlayers.length }} — log subs to correct)
          </span>
        </div>

        <!-- Main content: slim stat pane + shot chart + box score -->
        <div class="flex gap-3">

          <!-- Slim stat pane (tablet/desktop; phones get the bottom stat pad) -->
          <div class="hidden w-24 shrink-0 flex-col gap-2 md:flex">
            <!-- Player badge -->
            <div class="rounded-xl bg-ink-800 p-2 text-center">
              <template v-if="selectedPlayer">
                <div class="font-mono text-2xl font-black leading-none text-rim">
                  #{{ selectedPlayer.number ?? '—' }}
                </div>
                <div class="mt-0.5 truncate text-[11px] leading-tight text-ink-400">
                  {{ selectedPlayer.name.split(' ')[0] }}
                </div>
                <div class="mt-1.5 flex justify-center">
                  <button
                    class="rounded p-1 transition"
                    :class="subPickerOpen ? 'text-yellow-400' : 'text-ink-500 hover:text-chalk'"
                    title="Substitute" aria-label="Substitute"
                    @click="subPickerOpen = !subPickerOpen"
                  ><ArrowsRightLeftIcon class="h-5 w-5" /></button>
                </div>
              </template>
              <div v-else class="py-2 text-[11px] italic leading-tight text-ink-500">
                Pick a player
              </div>
            </div>

            <!-- Free throws, side by side so the whole column fits a landscape iPad -->
            <div class="grid grid-cols-2 gap-1">
              <button
                v-for="b in FT_STATS"
                :key="b.stat"
                class="flex min-h-[48px] flex-col items-center justify-center rounded-lg text-sm font-bold leading-tight transition"
                :class="[b.tone, selectedPlayerId ? 'hover:brightness-125 active:scale-95' : 'cursor-default opacity-30']"
                :disabled="!selectedPlayerId"
                :aria-label="b.label"
                @click="tap(b.stat)"
              >FT<span class="text-[10px] font-semibold uppercase">{{ b.label.split(' ')[1] }}</span></button>
            </div>
            <div class="my-0.5 border-t border-ink-700" />

            <!-- Non-shooting action buttons -->
            <button
              v-for="b in ACTION_STATS"
              :key="b.stat"
              class="min-h-[44px] rounded-lg text-sm font-bold transition"
              :class="[b.tone, selectedPlayerId ? 'hover:brightness-125 active:scale-95' : 'cursor-default opacity-30']"
              :disabled="!selectedPlayerId"
              @click="tap(b.stat)"
            >{{ b.label }}</button>
          </div>

          <!-- Shot chart + box score -->
          <div class="min-w-0 flex-1 py-2 flex flex-col lg:flex-row px-2 lg:px-0 gap-4 overflow-y-auto overflow-x-hidden lg:overflow-y-hidden boxscore-shotchart-container">
            
            <!-- Box score + sub log share one column (beside the court on wide screens) -->
            <div class="boxscore flex min-w-0 flex-col gap-3 lg:w-1/2">
            <!-- Box score (clickable rows to select player) -->
            <div class="card min-h-0 shrink p-2 w-full min-w-[600px] max-w-[95dvw] overflow-auto lg:overflow-x-hidden lg:overflow-y-auto lg:min-w-[0px] lg:max-w-full">
              <div class="mb-3 flex flex-wrap items-center gap-2">
                <h2 class="font-stencil font-bold">Box Score</h2>
                <div class="ml-auto flex gap-0.5 rounded-lg bg-ink-900/60 p-0.5" role="group" aria-label="Box score period">
                  <button
                    v-for="p in ['all', ...boxPeriods] as const"
                    :key="p"
                    class="rounded-md px-2 py-0.5 text-[11px] font-semibold transition"
                    :class="boxPeriod === p ? 'bg-ink-600 text-chalk' : 'text-ink-500 hover:text-chalk'"
                    :aria-pressed="boxPeriod === p"
                    @click="boxPeriod = p"
                  >{{ p === 'all' ? 'Game' : periodLabel(p) }}</button>
                </div>
              </div>
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
                        :class="onCourtIds.has(r.player_id) ? 'bg-green-400' : 'bg-transparent'"
                        :title="onCourtIds.has(r.player_id) ? 'On the floor' : undefined"
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

            <!-- Sub log -->
            <div v-if="subEvents.length > 0" class="shrink-0 rounded-xl bg-ink-800 p-3">
              <div class="mb-1 flex items-center">
                <p class="text-xs font-semibold text-ink-500">Substitutions</p>
                <button
                  class="ml-auto inline-flex items-center gap-1 text-xs text-ink-500 hover:text-chalk"
                  title="Undo last substitution"
                  @click="undoLastSub"
                ><ArrowUturnLeftIcon class="h-4 w-4" />Undo</button>
              </div>
              <ul class="space-y-0.5 text-xs text-ink-500">
                <li v-for="sub in subEvents" :key="sub.id">
                  {{ periodLabel(sub.period) }}: {{ playerName(sub.player_id_in) }}
                  IN for {{ playerName(sub.player_id_out) }}
                </li>
              </ul>
            </div>
            </div>

            <ShotChart
              :game-id="activeGame.id"
              :player-id="selectedPlayerId"
              :period="activePeriod"/>
          </div>
        </div>

        <!-- Room so the fixed stat pad never covers the last of the content -->
        <div class="h-56 md:hidden" aria-hidden="true" />

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
            <span v-else class="text-sm italic text-ink-500">Tap a player in the box score or on-floor list</span>
            <button
              v-if="selectedPlayer"
              class="ml-auto rounded-lg p-2 transition"
              :class="subPickerOpen ? 'bg-yellow-500/20 text-yellow-400' : 'bg-ink-800 text-ink-400'"
              title="Substitute" aria-label="Substitute"
              @click="subPickerOpen = !subPickerOpen"
            ><ArrowsRightLeftIcon class="h-5 w-5" /></button>
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
    <PlaysView v-else-if="mode === 'scouting'" scouting />

    <!-- ==================== SEASON MODE ==================== -->
    <template v-else>
      <div class="card overflow-x-auto p-4">
        <h2 class="mb-1 font-stencil font-bold">Season Stats</h2>
        <p class="mb-4 text-xs text-ink-500">Aggregated across all recorded games.</p>

        <table class="w-full text-right font-mono text-sm">
          <thead class="text-ink-500">
            <tr class="border-b border-ink-700">
              <th class="py-1 text-left">Player</th>
              <th title="Games Played">GP</th>
              <th>PTS</th>
              <th title="Points per game">PPG</th>
              <th>FG%</th><th>3P%</th><th>FT%</th>
              <th>REB</th>
              <th title="Rebounds per game">RPG</th>
              <th>AST</th>
              <th title="Assists per game">APG</th>
              <th>STL</th><th>BLK</th><th>TOV</th><th>PF</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="seasonStats.length === 0">
              <td colspan="15" class="py-6 text-center text-ink-500">
                No season data yet. Record some game stats first.
              </td>
            </tr>
            <tr
              v-for="r in seasonStats"
              :key="r.player_id"
              class="border-b border-ink-800 hover:bg-ink-800/40"
            >
              <td class="py-1.5 text-left">
                <span class="font-mono text-xs text-ink-500">#{{ r.number ?? '—' }}</span>
                <span class="ml-1">{{ r.name }}</span>
              </td>
              <td class="text-ink-500">{{ r.gp }}</td>
              <td class="font-bold text-chalk">{{ r.pts }}</td>
              <td class="font-semibold text-rim">{{ r.ppg }}</td>
              <td>{{ r.fgPct }}</td><td>{{ r.tpPct }}</td><td>{{ r.ftPct }}</td>
              <td>{{ r.reb }}</td>
              <td class="text-ink-500">{{ r.rpg }}</td>
              <td>{{ r.ast }}</td>
              <td class="text-ink-500">{{ r.apg }}</td>
              <td>{{ r.stl }}</td><td>{{ r.blk }}</td><td>{{ r.tov }}</td><td>{{ r.pf }}</td>
            </tr>
          </tbody>
          <tfoot v-if="seasonStats.length" class="font-semibold text-chalk">
            <tr class="border-t border-ink-600">
              <td class="py-1.5 text-left">Team</td>
              <td class="text-ink-500">{{ seasonGames }}</td>
              <td>{{ seasonTotals.pts }}</td>
              <td class="text-rim">{{ seasonGames ? (seasonTotals.pts / seasonGames).toFixed(1) : '—' }}</td>
              <td>{{ formatPct(seasonTotals.fgm, seasonTotals.fga) }}</td>
              <td>{{ formatPct(seasonTotals.tpm, seasonTotals.tpa) }}</td>
              <td>{{ formatPct(seasonTotals.ftm, seasonTotals.fta) }}</td>
              <td>{{ seasonTotals.reb }}</td>
              <td class="text-ink-500">{{ seasonGames ? (seasonTotals.reb / seasonGames).toFixed(1) : '—' }}</td>
              <td>{{ seasonTotals.ast }}</td>
              <td class="text-ink-500">{{ seasonGames ? (seasonTotals.ast / seasonGames).toFixed(1) : '—' }}</td>
              <td>{{ seasonTotals.stl }}</td><td>{{ seasonTotals.blk }}</td><td>{{ seasonTotals.tov }}</td><td>{{ seasonTotals.pf }}</td>
            </tr>
          </tfoot>
        </table>
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
          <h2 class="font-stencil text-lg font-bold">{{ gameSheet === 'edit' ? 'Game Details' : 'New Game' }}</h2>
          <button class="btn-ghost p-1.5" title="Cancel" aria-label="Cancel" @click="gameSheet = null"><XMarkIcon class="h-5 w-5" /></button>
        </div>
        <div class="flex flex-col gap-3">
          <div>
            <label class="label" for="ng-opponent">Opponent</label>
            <input
              id="ng-opponent"
              v-model="sheetOpponent"
              class="input"
              placeholder="e.g. West Morgan"
              autofocus
              autocomplete="off"
              @keyup.enter="onSubmitGameSheet"
            />
          </div>
          <div class="flex gap-3">
            <div class="grow">
              <label class="label" for="ng-date">Date</label>
              <input id="ng-date" v-model="sheetDate" type="date" class="input" />
            </div>
            <div class="grow">
              <label class="label" for="ng-location">Location (optional)</label>
              <input id="ng-location" v-model="sheetLocation" class="input" placeholder="Home, Away, gym…" autocomplete="off" />
            </div>
          </div>
          <div>
            <label class="label" for="ng-notes">Notes (optional)</label>
            <textarea id="ng-notes" v-model="sheetNotes" rows="2" class="input resize-none" placeholder="Tournament, keys to the game…" />
          </div>
          <button
            class="btn-primary py-3 text-sm font-semibold"
            :disabled="!sheetOpponent.trim() || !sheetDate || savingGame"
            @click="onSubmitGameSheet"
          >{{ savingGame ? 'Saving…' : gameSheet === 'edit' ? 'Save details' : 'Start game' }}</button>
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
          <h2 class="font-stencil text-lg font-bold">Roster</h2>
          <button class="btn-ghost p-1.5" title="Close" aria-label="Close" @click="showRosterDrawer = false"><XMarkIcon class="h-5 w-5" /></button>
        </div>

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
</template>
