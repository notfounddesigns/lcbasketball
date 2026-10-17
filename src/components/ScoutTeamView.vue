<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Game, Player, ShotEvent, StatEvent } from '@/types'
import { buildSeasonStats } from '@/lib/stats-utils'
import ShotChart from '@/components/ShotChart.vue'
import SeasonStatsTable from '@/components/SeasonStatsTable.vue'
import { ArrowLeftIcon, ChevronRightIcon } from '@heroicons/vue/24/outline'

// Everything scouted on one team, across all of its reports: record, per-game
// box score, a combined shot chart / heat map, and each report's notes.
const props = defineProps<{
  team: string
  reports: Game[] // newest first
  roster: Player[]
  events: StatEvent[] // every report's stat events
  shots: ShotEvent[] // every report's shots
}>()
defineEmits<{ back: []; 'open-report': [game: Game] }>()

const period = ref<number | 'all'>('all')
const selectedPlayerId = ref<string | null>(null)
watch(() => props.team, () => {
  period.value = 'all'
  selectedPlayerId.value = null
})

const rows = computed(() => {
  const withStats = new Set(props.events.map((e) => e.player_id))
  return buildSeasonStats(props.roster.filter((p) => p.active !== false || withStats.has(p.id)), props.events)
})
const gamesWithStats = computed(() => new Set(props.events.map((e) => e.game_id)).size)

const scored = computed(() => props.reports.filter((g) => g.our_score != null && g.opp_score != null))
const record = computed(() => {
  const w = scored.value.filter((g) => g.our_score! > g.opp_score!).length
  const l = scored.value.filter((g) => g.our_score! < g.opp_score!).length
  const t = scored.value.length - w - l
  return t ? `${w}–${l}–${t}` : `${w}–${l}`
})
const avg = (pick: (g: Game) => number) =>
  scored.value.length ? (scored.value.reduce((n, g) => n + pick(g), 0) / scored.value.length).toFixed(1) : '—'

const NOTE_FIELDS: { key: 'scout_key_players' | 'scout_offense' | 'scout_defense' | 'notes'; label: string }[] = [
  { key: 'scout_key_players', label: 'Key players' },
  { key: 'scout_offense', label: 'Offense' },
  { key: 'scout_defense', label: 'Defense' },
  { key: 'notes', label: 'Other' },
]

function resultLabel(g: Game) {
  if (g.our_score == null || g.opp_score == null) return null
  const d = g.our_score - g.opp_score
  return d > 0 ? 'W' : d < 0 ? 'L' : 'T'
}
</script>

<template>
  <div class="flex flex-col gap-4 pb-24">
    <div class="flex flex-wrap items-center gap-3">
      <button class="inline-flex items-center gap-1 py-1.5" @click="$emit('back')">
        <ArrowLeftIcon class="h-5 w-5" />
        <span class="font-stencil text-sm font-bold uppercase">Reports</span>
      </button>
      <div class="min-w-0">
        <h2 class="font-stencil text-xl font-bold uppercase leading-tight">{{ team }}</h2>
        <p class="text-xs text-ink-500">
          {{ reports.length }} report{{ reports.length === 1 ? '' : 's' }}
          <template v-if="scored.length"> · {{ record }} · {{ avg((g) => g.our_score!) }} PPG, {{ avg((g) => g.opp_score!) }} allowed</template>
        </p>
      </div>
    </div>

    <!-- Combined shot chart + per-game stats -->
    <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div class="scout-shotchart mx-auto flex w-full min-w-0 max-w-lg flex-col lg:mx-0 lg:w-1/2 lg:max-w-none">
        <ShotChart
          v-model:filter="period"
          :game-id="null"
          :player-id="selectedPlayerId"
          :period="1"
          :shots-source="shots"
          :events-source="events"
          default-view="zones"
          readonly
        />
      </div>
      <div class="card min-w-0 overflow-x-auto p-3 lg:w-1/2">
        <h3 class="mb-2 font-stencil font-bold">
          Per-game stats
          <span class="ml-1 font-sans text-xs font-normal text-ink-500">
            {{ selectedPlayerId ? '· shot chart shows the selected player' : '· tap a player to chart their shots' }}
          </span>
        </h3>
        <div class="min-w-[640px]">
          <SeasonStatsTable
            :rows="rows"
            :games="gamesWithStats"
            :selected-id="selectedPlayerId"
            empty-text="No stats tracked on this team yet."
            @select="selectedPlayerId = $event"
          />
        </div>
      </div>
    </div>

    <!-- Every report's notes, newest first -->
    <section class="flex flex-col gap-3">
      <h3 class="font-stencil font-bold">Reports &amp; notes</h3>
      <article v-for="g in reports" :key="g.id" class="card p-3">
        <button class="flex w-full items-center gap-2 text-left" @click="$emit('open-report', g)">
          <span class="font-semibold">vs {{ g.opponent }}</span>
          <span class="text-xs text-ink-500">{{ g.played_on }}<template v-if="g.location"> · {{ g.location }}</template></span>
          <span v-if="resultLabel(g)" class="font-mono text-sm">
            <span class="font-bold" :class="resultLabel(g) === 'W' ? 'text-green-400' : resultLabel(g) === 'L' ? 'text-rim' : 'text-ink-400'">{{ resultLabel(g) }}</span>
            {{ g.our_score }}–{{ g.opp_score }}
          </span>
          <ChevronRightIcon class="ml-auto h-4 w-4 text-ink-500" />
        </button>
        <dl v-if="NOTE_FIELDS.some((f) => g[f.key])" class="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
          <template v-for="f in NOTE_FIELDS" :key="f.key">
            <div v-if="g[f.key]">
              <dt class="text-[11px] font-semibold uppercase tracking-wide text-rim">{{ f.label }}</dt>
              <dd class="whitespace-pre-wrap text-sm leading-relaxed">{{ g[f.key] }}</dd>
            </div>
          </template>
        </dl>
        <p v-else class="mt-1 text-xs text-ink-500">No notes.</p>
      </article>
    </section>
  </div>
</template>
