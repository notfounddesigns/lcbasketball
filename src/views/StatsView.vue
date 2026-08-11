<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Game, Player, StatEvent, StatType } from '@/types'
import { useStats } from '@/composables/useStats'
import { useShotChart } from '@/composables/useShotChart'
import { useConfirm } from '@/composables/useConfirm'
import { buildBoxScore, boxScoreToCsv, downloadCsv } from '@/lib/stats-utils'
import ShotChart from '@/components/ShotChart.vue'
import StatFlash from '@/components/StatFlash.vue'
import TrashIcon from '@heroicons/vue/24/outline/TrashIcon'
import { ArrowLeftIcon, ArrowUturnLeftIcon, CheckIcon, FolderArrowDownIcon, PencilIcon, UserGroupIcon, XMarkIcon } from '@heroicons/vue/24/outline'

const {
  players, games, events, allEvents, subEvents, error,
  fetchPlayers, fetchGames, fetchEvents, fetchAllEvents,
  fetchSubEvents, recordSub,
  addPlayer, updatePlayer, deletePlayer,
  createGame, deleteGame,
  recordStat, undoLastFor,
} = useStats()
const { shots, deleteShot } = useShotChart()
const { confirm } = useConfirm()

// Shooting stats are recorded alongside a shot_event on the shot chart, so
// undoing one must also remove its paired shot marker.
const SHOOTING_STATS = new Set<StatType>([
  'fg_made', 'fg_miss', 'three_made', 'three_miss', 'ft_made', 'ft_miss',
])

// ---- Mode: "game" | "season" ----
const mode = ref<'game' | 'season'>('game')

const activeGame = ref<Game | null>(null)

// ---- Period tracking ----
const activePeriod = ref(1)
const PERIODS = [
  { label: 'Q1', value: 1 },
  { label: 'Q2', value: 2 },
  { label: 'Q3', value: 3 },
  { label: 'Q4', value: 4 },
  { label: 'OT', value: 5 },
]

onMounted(async () => {
  await Promise.all([fetchPlayers(), fetchGames(), fetchAllEvents()])
})

// ----- roster drawer -----
const showRosterDrawer = ref(false)

// ----- roster management -----
const newPlayerName = ref('')
const newPlayerNumber = ref<number | null>(null)
async function onAddPlayer() {
  if (!newPlayerName.value.trim()) return
  await addPlayer({
    name: newPlayerName.value.trim(),
    number: newPlayerNumber.value,
    position: null,
    active: true,
  })
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
  await updatePlayer(id, {
    name: editPlayerName.value.trim(),
    number: editPlayerNumber.value,
  })
  editingPlayerId.value = null
}

async function onDeletePlayer(id: string) {
  const ok = await confirm({
    title: 'Remove player',
    message: 'Remove this player? Their recorded stats will remain.',
    confirmText: 'Remove',
    tone: 'danger',
  })
  if (!ok) return
  await deletePlayer(id)
}

// ----- new game sheet -----
const showNewGameSheet = ref(false)
const newOpponent = ref('')
const newDate = ref(new Date().toLocaleDateString('en-CA'))

async function onCreateGame() {
  if (!newOpponent.value.trim()) return
  const g = await createGame({
    opponent: newOpponent.value.trim(),
    played_on: newDate.value,
    location: null,
    notes: null,
  })
  if (g) {
    newOpponent.value = ''
    showNewGameSheet.value = false
    selectedPlayerId.value = null
    await openGame(g)
  }
}

async function openGame(g: Game) {
  activeGame.value = g
  activePeriod.value = 1
  selectedPlayerId.value = null
  await Promise.all([fetchEvents(g.id), fetchSubEvents(g.id)])
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

// ----- non-shooting stat buttons (shooting handled by shot chart) -----
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
  await recordStat(activeGame.value.id, selectedPlayerId.value, stat, activePeriod.value)
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

const boxScore = computed(() => buildBoxScore(players.value, events.value))

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
  let id = ++flashSeq
  if (stat === 'fg_made' || stat === 'three_made' || stat === 'ft_made') {
    flashes.value = [
      ...flashes.value,
      { id, playerId, col: meta.col, text: `${positive ? '+' : '-'}1`, positive, color }
    ]
    if (stat === 'three_made') {
      id = ++flashSeq
      flashes.value = [
        ...flashes.value,
        { id, playerId, col: 'fg', text: `${positive ? '+' : '-'}1`, positive, color }
      ]
    }
    id = ++flashSeq
    flashes.value = [
      ...flashes.value,
      { id, playerId, col: 'pts', text: `${positive ? '+' : '-'}${meta.amount}`, positive, color }
    ] 
  }
  else if (stat === 'fg_miss' || stat === 'three_miss' || stat === 'ft_miss') {
    flashes.value = [
      ...flashes.value,
      { id, playerId, col: meta.col, text: `${positive ? '+' : '-'}1`, positive, color }
    ]
    if (stat === 'three_miss') {
      id = ++flashSeq
      flashes.value = [
        ...flashes.value,
        { id, playerId, col: 'fg', text: `${positive ? '+' : '-'}1`, positive, color }
      ]
    }
  } else {
    flashes.value = [
      ...flashes.value,
      { id, playerId, col: meta.col, text: `${positive ? '+' : '-'}${meta.amount}`, positive, color }
    ]
  }
  // Drop the flash once its animation (0.85s) has finished.
  setTimeout(() => {
    flashes.value = flashes.value.filter((f) => f.id !== id)
  }, 900)
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
  const label = `${activeGame.value.opponent} ${activeGame.value.played_on}`
  const csv = boxScoreToCsv(boxScore.value, label)
  downloadCsv(`boxscore-${activeGame.value.opponent}-${activeGame.value.played_on}.csv`, csv)
}

// ----- substitution UI -----
const subPickerOpen = ref(false)

async function doSub(playerIdOut: string) {
  if (!activeGame.value || !selectedPlayerId.value) return
  await recordSub(activeGame.value.id, selectedPlayerId.value, playerIdOut, activePeriod.value)
  subPickerOpen.value = false
}

// ----- season stats -----
const seasonBoxScore = computed(() => buildBoxScore(players.value, allEvents.value))

interface SeasonRow {
  player_id: string
  name: string
  number: number | null
  gp: number
  pts: number
  ppg: string
  fgm: number
  fga: number
  fgPct: string
  tpm: number
  tpa: number
  tpPct: string
  ftm: number
  fta: number
  ftPct: string
  reb: number
  rpg: string
  ast: number
  apg: string
  stl: number
  blk: number
  tov: number
  pf: number
}

const seasonStats = computed<SeasonRow[]>(() => {
  return seasonBoxScore.value.map((r) => {
    const playerGameIds = new Set(
      allEvents.value
        .filter((e) => e.player_id === r.player_id)
        .map((e) => e.game_id),
    )
    const actualGp = playerGameIds.size
    const ppg = actualGp > 0 ? (r.pts / actualGp).toFixed(1) : '—'
    const rpg = actualGp > 0 ? (r.reb / actualGp).toFixed(1) : '—'
    const apg = actualGp > 0 ? (r.ast / actualGp).toFixed(1) : '—'
    const fgPct = r.fga > 0 ? Math.round((r.fgm / r.fga) * 100) + '%' : '—'
    const tpPct = r.tpa > 0 ? Math.round((r.tpm / r.tpa) * 100) + '%' : '—'
    const ftPct = r.fta > 0 ? Math.round((r.ftm / r.fta) * 100) + '%' : '—'

    return {
      player_id: r.player_id, name: r.name, number: r.number,
      gp: actualGp, pts: r.pts, ppg,
      fgm: r.fgm, fga: r.fga, fgPct,
      tpm: r.tpm, tpa: r.tpa, tpPct,
      ftm: r.ftm, fta: r.fta, ftPct,
      reb: r.reb, rpg, ast: r.ast, apg,
      stl: r.stl, blk: r.blk, tov: r.tov, pf: r.pf,
    }
  })
})
</script>

<template>
  <section class="flex flex-col gap-4">
    <!-- Sticky page header -->
    <div
      class="sticky top-0 z-10 -mx-4 flex items-center gap-3 bg-ink-900/95 px-4 pt-6 pb-1 backdrop-blur-xl">
      <h1 v-if="!activeGame" class="font-stencil text-xl font-bold capitalize leading-tight">Stats</h1>
      <button
        v-if="activeGame"
        class="inline-flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-xs" @click="activeGame = null">
        <ArrowLeftIcon class="h-5 w-5 text-chalk" />
        <span class="text-chalk text-[clamp(0.875rem,2vw,1.15rem)] font-stencil uppercase font-bold">Games</span>
      </button>
      <span class="grow"></span>
      <button
        v-if="activeGame && selectedPlayer && shots.filter((s) => s.player_id === selectedPlayerId).length > 0"
        class="inline-flex items-center justify-center gap-1 rounded-md px-3 bg-away py-1 text-xs hover:bg-away/90"
        title="Undo last stat"
        @click="onUndo(selectedPlayerId!)">
        <ArrowUturnLeftIcon class="h-5 w-5" />Undo
      </button>
      <button
        v-if="activeGame"
        class="inline-flex items-center justify-center gap-1 rounded-md px-3 bg-ink-500 py-1 text-xs hover:bg-ink-500/90"
        title="Export CSV"
        @click="exportCsv">
        <FolderArrowDownIcon class="h-5 w-5" />Export
      </button>
      <!-- Mode tabs -->
      <div v-if="!activeGame" class="flex gap-1 ml-auto rounded-lg bg-ink-800 p-0.5">
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
      </div>

      <template v-if="mode === 'game'">
        <button
          v-if="!activeGame"
          class="rounded-md px-3 py-2 text-xs bg-rim hover:bg-rim/80"
          @click="showNewGameSheet = true"
        >New Game</button>
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
            <p class="mt-1 text-xs text-ink-500">{{ g.played_on }}</p>
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
          <span class="text-[clamp(0.875rem,2vw,1.75rem)] font-stencil uppercase leading-4 font-bold">
            vs {{ activeGame.opponent }}<br />
            <span class="text-sm text-ink-500">{{ activeGame.played_on }}</span>
          </span>
          <div class="ml-auto flex items-center gap-1">
            <button
              v-for="p in PERIODS"
              :key="p.value"
              class="rounded px-2.5 py-1 text-xs font-bold transition"
              :class="activePeriod === p.value
                ? 'bg-rim text-white'
                : 'bg-ink-700 text-ink-500 hover:text-chalk'"
              @click="activePeriod = p.value"
            >{{ p.label }}</button>
          </div>
        </div>

        <!-- Sub picker (shown above main content when open) -->
        <div v-if="subPickerOpen && selectedPlayer" class="rounded-xl border border-yellow-500/30 bg-ink-800 p-3">
          <p class="mb-2 text-xs text-ink-500">
            <span class="font-semibold text-yellow-400">{{ selectedPlayer.name }}</span> comes IN for:
          </p>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="other in players.filter(op => op.id !== selectedPlayerId)"
              :key="other.id"
              class="rounded-lg bg-ink-700 px-3 py-1.5 text-xs text-chalk hover:bg-rim hover:text-white"
              @click="doSub(other.id)"
            >#{{ other.number ?? '—' }} {{ other.name }}</button>
            <button class="text-xs text-ink-500 hover:text-chalk" @click="subPickerOpen = false">Cancel</button>
          </div>
        </div>

        <!-- Main content: slim stat pane + shot chart + box score -->
        <div class="flex gap-3">

          <!-- Slim stat pane -->
          <div class="flex w-[72px] shrink-0 flex-col gap-1.5">
            <!-- Player badge -->
            <div class="rounded-xl bg-ink-800 p-2 text-center">
              <template v-if="selectedPlayer">
                <div class="font-mono text-2xl font-black leading-none text-rim">
                  #{{ selectedPlayer.number ?? '—' }}
                </div>
                <div class="mt-0.5 truncate text-[9px] leading-tight text-ink-400">
                  {{ selectedPlayer.name.split(' ')[0] }}
                </div>
                <div class="mt-1.5 flex justify-center gap-1">
                  <span class="text-ink-700">·</span>
                  <button
                    class="text-[9px] transition"
                    :class="subPickerOpen ? 'text-yellow-400' : 'text-ink-500 hover:text-chalk'"
                    @click="subPickerOpen = !subPickerOpen"
                  >sub</button>
                </div>
              </template>
              <div v-else class="py-2 text-[9px] italic leading-tight text-ink-500">
                Pick a player
              </div>
            </div>

            <!-- Non-shooting action buttons -->
            <button
              v-for="b in ACTION_STATS"
              :key="b.stat"
              class="rounded-lg py-2.5 text-[11px] font-semibold transition"
              :class="[b.tone, selectedPlayerId ? 'hover:brightness-125 active:scale-95' : 'cursor-default opacity-30']"
              :disabled="!selectedPlayerId"
              @click="tap(b.stat)"
            >{{ b.label }}</button>
          </div>

          <!-- Shot chart + box score -->
          <div class="min-w-0 flex-1 py-2 flex flex-col lg:flex-row px-2 lg:px-0 gap-4 overflow-y-auto overflow-x-hidden lg:overflow-y-hidden boxscore-shotchart-container">
            
            <!-- Box score (clickable rows to select player) -->
            <div class="card p-2 w-full min-w-[600px] max-w-[95dvw] overflow-auto lg:w-1/2 boxscore lg:overflow-x-hidden lg:overflow-y-auto lg:min-w-[0px] lg:max-w-full">
              <h2 class="mb-3 font-stencil font-bold">Box Score</h2>
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
                    v-for="r in boxScore"
                    :key="r.player_id"
                    class="cursor-pointer border-b border-ink-800 transition"
                    :class="selectedPlayerId === r.player_id
                      ? 'bg-ink-700'
                      : 'hover:bg-ink-800/70'"
                    @click="selectedPlayerId = selectedPlayerId === r.player_id ? null : r.player_id"
                  >
                    <td class="py-2 text-left">
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
                    <td class="relative">{{ r.pf }}<StatFlash :items="flashesFor(r.player_id, 'pf')" /></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Sub log -->
            <div v-if="subEvents.length > 0" class="rounded-xl bg-ink-800 p-3">
              <p class="mb-1 text-xs font-semibold text-ink-500">Substitutions</p>
              <ul class="space-y-0.5 text-xs text-ink-500">
                <li v-for="sub in subEvents" :key="sub.id">
                  Q{{ sub.period }}: {{ players.find(p => p.id === sub.player_id_in)?.name ?? 'Unknown' }}
                  IN for {{ players.find(p => p.id === sub.player_id_out)?.name ?? 'Unknown' }}
                </li>
              </ul>
            </div>
            
            <ShotChart
              :game-id="activeGame.id"
              :player-id="selectedPlayerId"
              :period="activePeriod"/>
          </div>
        </div>
      </template>
    </template>

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
        v-if="showNewGameSheet"
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        @click="showNewGameSheet = false"
      />
    </Transition>
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="-translate-y-full"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-to-class="-translate-y-full"
    >
      <div
        v-if="showNewGameSheet"
        class="fixed inset-x-0 top-0 z-50 rounded-b-3xl border-b border-ink-700 bg-ink-900 px-4 pb-8 pt-4 shadow-2xl w-full lg:w-1/3 lg:mx-auto lg:mt-10"
      >
        <div class="mb-4 flex items-center justify-between">
          <h2 class="font-stencil text-lg font-bold">New Game</h2>
          <button class="btn-ghost py-1 text-sm" @click="showNewGameSheet = false">Cancel</button>
        </div>
        <div class="flex flex-col gap-3">
          <div>
            <label class="label" for="ng-opponent">Opponent</label>
            <input
              id="ng-opponent"
              v-model="newOpponent"
              class="input"
              placeholder="e.g. West Morgan"
              autofocus
              autocomplete="off"
              @keyup.enter="onCreateGame"
            />
          </div>
          <div>
            <label class="label" for="ng-date">Date</label>
            <input id="ng-date" v-model="newDate" type="date" class="input" />
          </div>
          <button
            class="btn-primary py-3 text-sm font-semibold"
            :disabled="!newOpponent.trim()"
            @click="onCreateGame"
          >Start game</button>
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
          <button class="btn-ghost py-1 text-sm" @click="showRosterDrawer = false">✕</button>
        </div>

        <ul class="mb-4 space-y-1 text-sm">
          <li v-for="p in players" :key="p.id">
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
                <button class="text-[10px] text-red-400 hover:text-red-300" @click="onDeletePlayer(p.id)">
                  <TrashIcon class="h-5 w-5" />
                </button>
              </div>
            </template>
          </li>
        </ul>

        <div class="border-t border-ink-700 pt-4">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Add player</p>
          <div class="flex gap-2">
            <input v-model.number="newPlayerNumber" type="number" placeholder="#" class="input w-14 text-center" />
            <input v-model="newPlayerName" placeholder="Name" class="input grow" @keyup.enter="onAddPlayer" />
          </div>
          <button class="btn-ghost mt-2 w-full py-1.5 text-xs" @click="onAddPlayer">Add player</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
