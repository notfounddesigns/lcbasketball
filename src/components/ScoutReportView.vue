<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Game, Player, StatEvent } from '@/types'
import { buildBoxScore, formatPct, periodLabel, teamTotals } from '@/lib/stats-utils'
import ShotChart from '@/components/ShotChart.vue'
import { ArrowLeftIcon, ChartBarIcon, DocumentTextIcon, PencilIcon, UserGroupIcon } from '@heroicons/vue/24/outline'

// A game at a glance: matchup, box score and shot chart, plus the coach's notes
// for a scouting report. Tracking more stats happens back in the tracker.
// `readonly` (players) hides everything that edits; it's also how players see
// our own games.
const props = defineProps<{ game: Game; roster: Player[]; events: StatEvent[]; readonly?: boolean }>()
defineEmits<{ back: []; track: []; 'edit-details': []; 'edit-notes': []; team: [] }>()

const period = ref<number | 'all'>('all')
const selectedPlayerId = ref<string | null>(null)
watch(() => props.game.id, () => {
  period.value = 'all'
  selectedPlayerId.value = null
})

const shownEvents = computed(() =>
  period.value === 'all' ? props.events : props.events.filter((e) => (e.period ?? 1) === period.value),
)
// Everyone with a stat this game, plus the rest of the scouted roster.
const rows = computed(() => {
  const withStats = new Set(props.events.map((e) => e.player_id))
  return buildBoxScore(props.roster.filter((p) => p.active !== false || withStats.has(p.id)), shownEvents.value)
})
const totals = computed(() => teamTotals(rows.value))

const hasScore = computed(() => props.game.our_score != null && props.game.opp_score != null)
const result = computed(() => {
  if (!hasScore.value) return null
  const d = props.game.our_score! - props.game.opp_score!
  return d > 0 ? 'W' : d < 0 ? 'L' : 'T'
})

const NOTES: { key: 'scout_key_players' | 'scout_offense' | 'scout_defense' | 'notes'; label: string }[] = [
  { key: 'scout_key_players', label: 'Key players' },
  { key: 'scout_offense', label: 'Offense' },
  { key: 'scout_defense', label: 'Defense' },
  { key: 'notes', label: 'Other notes' },
]
const hasNotes = computed(() => NOTES.some((n) => props.game[n.key]))
</script>

<template>
  <div class="flex flex-col gap-4 pb-24">
    <!-- Matchup header -->
    <div class="flex flex-wrap items-center gap-3">
      <button class="inline-flex items-center gap-1 py-1.5" @click="$emit('back')">
        <ArrowLeftIcon class="h-5 w-5" />
        <span class="font-stencil text-sm font-bold uppercase">{{ game.is_scouting ? 'Reports' : 'Games' }}</span>
      </button>
      <div class="min-w-0">
        <h2 class="font-stencil text-xl font-bold uppercase leading-tight">{{ game.is_scouting ? game.scouted_team : `vs ${game.opponent}` }}</h2>
        <p class="text-xs text-ink-500">
          <template v-if="game.is_scouting">vs {{ game.opponent }} · </template>{{ game.played_on }}<template v-if="game.location"> · {{ game.location }}</template>
        </p>
      </div>
      <span v-if="hasScore" class="rounded-lg border border-ink-700 bg-ink-800 px-2 py-1 font-mono text-sm">
        <span class="font-bold" :class="result === 'W' ? 'text-green-400' : result === 'L' ? 'text-rim' : 'text-ink-400'">{{ result }}</span>
        {{ game.our_score }}–{{ game.opp_score }}
      </span>
      <div v-if="!readonly" class="ml-auto flex items-center gap-2">
        <button v-if="game.is_scouting" class="btn-ghost py-1.5 text-sm" :title="`Every report on ${game.scouted_team}`" @click="$emit('team')">
          <UserGroupIcon class="h-4 w-4" /><span class="hidden sm:inline">Team overview</span>
        </button>
        <button class="btn-ghost py-1.5 text-sm" title="Edit matchup details" @click="$emit('edit-details')">
          <PencilIcon class="h-4 w-4" /><span class="hidden sm:inline">Details</span>
        </button>
        <button v-if="game.is_scouting" class="btn-ghost py-1.5 text-sm" title="Edit scouting notes" @click="$emit('edit-notes')">
          <DocumentTextIcon class="h-4 w-4" /><span class="hidden sm:inline">Notes</span>
        </button>
        <button class="btn-primary py-1.5 text-sm" title="Open the stat tracker" @click="$emit('track')">
          <ChartBarIcon class="h-4 w-4" />Track stats
        </button>
      </div>
    </div>

    <!-- Notes -->
    <div v-if="game.is_scouting && hasNotes" class="grid gap-3 sm:grid-cols-2">
      <section v-for="n in NOTES" :key="n.key" class="card p-3" :class="game[n.key] ? '' : 'opacity-50'">
        <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-rim">{{ n.label }}</h3>
        <p class="whitespace-pre-wrap text-sm leading-relaxed">{{ game[n.key] || '—' }}</p>
      </section>
    </div>
    <button
      v-else-if="game.is_scouting && !readonly"
      class="card border border-dashed border-ink-700 p-4 text-left text-sm text-ink-500 hover:text-chalk"
      @click="$emit('edit-notes')"
    >No notes yet — add key players, offensive and defensive schemes…</button>

    <!-- Shot chart + box score -->
    <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div class="scout-shotchart mx-auto flex w-full min-w-0 max-w-lg flex-col lg:mx-0 lg:w-1/2 lg:max-w-none">
        <ShotChart v-model:filter="period" :game-id="game.id" :player-id="selectedPlayerId" :period="1" readonly />
      </div>
      <div class="card min-w-0 overflow-x-auto p-3 lg:w-1/2">
        <h3 class="mb-2 font-stencil font-bold">
          Box Score<span v-if="period !== 'all'" class="ml-2 font-sans text-xs font-normal text-ink-500">{{ periodLabel(period) }} only</span>
          <span v-if="selectedPlayerId" class="ml-2 font-sans text-xs font-normal text-ink-500">· shot chart shows the selected player</span>
        </h3>
        <table class="w-full min-w-[560px] text-right font-mono text-sm">
          <thead class="text-ink-500">
            <tr class="border-b border-ink-700">
              <th class="py-1 text-left">Player</th>
              <th>PTS</th><th>FG</th><th>3P</th><th>FT</th>
              <th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TOV</th><th>PF</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in rows"
              :key="r.player_id"
              class="cursor-pointer border-b border-ink-800 transition"
              :class="selectedPlayerId === r.player_id ? 'bg-ink-700' : 'hover:bg-ink-800/70'"
              @click="selectedPlayerId = selectedPlayerId === r.player_id ? null : r.player_id"
            >
              <td class="py-2 text-left">
                <span class="font-mono text-xs text-ink-500">#{{ r.number ?? '—' }}</span>
                <span class="ml-1">{{ r.name }}</span>
              </td>
              <td class="font-bold text-chalk">{{ r.pts }}</td>
              <td>{{ r.fgm }}/{{ r.fga }}</td>
              <td>{{ r.tpm }}/{{ r.tpa }}</td>
              <td>{{ r.ftm }}/{{ r.fta }}</td>
              <td>{{ r.reb }}</td><td>{{ r.ast }}</td><td>{{ r.stl }}</td>
              <td>{{ r.blk }}</td><td>{{ r.tov }}</td><td>{{ r.pf }}</td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="11" class="py-6 text-center font-sans text-ink-500">No stats tracked yet.</td>
            </tr>
          </tbody>
          <tfoot v-if="rows.length" class="font-semibold text-chalk">
            <tr class="border-t border-ink-600">
              <td class="py-2 text-left">Team</td>
              <td>{{ totals.pts }}</td>
              <td>{{ totals.fgm }}/{{ totals.fga }}</td>
              <td>{{ totals.tpm }}/{{ totals.tpa }}</td>
              <td>{{ totals.ftm }}/{{ totals.fta }}</td>
              <td>{{ totals.reb }}</td><td>{{ totals.ast }}</td><td>{{ totals.stl }}</td>
              <td>{{ totals.blk }}</td><td>{{ totals.tov }}</td><td>{{ totals.pf }}</td>
            </tr>
            <tr class="text-xs font-normal text-ink-500">
              <td class="text-left">Shooting</td>
              <td></td>
              <td>{{ formatPct(totals.fgm, totals.fga) }}</td>
              <td>{{ formatPct(totals.tpm, totals.tpa) }}</td>
              <td>{{ formatPct(totals.ftm, totals.fta) }}</td>
              <td colspan="6"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </div>
</template>
