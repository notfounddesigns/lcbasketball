<script setup lang="ts">
import { computed } from 'vue'
import type { SeasonRow } from '@/lib/stats-utils'
import { formatPct, teamTotals } from '@/lib/stats-utils'

// Totals and per-game averages across several games: our season, or every
// report on a scouted team. Tapping a row selects that player (e.g. to filter
// the shot chart beside it).
const props = defineProps<{ rows: SeasonRow[]; games: number; selectedId?: string | null; emptyText?: string }>()
defineEmits<{ select: [playerId: string | null] }>()

const display = computed(() =>
  props.rows.map((r) => ({
    ...r,
    ppgText: r.gp ? r.ppg.toFixed(1) : '—',
    rpgText: r.gp ? r.rpg.toFixed(1) : '—',
    apgText: r.gp ? r.apg.toFixed(1) : '—',
    fgPct: formatPct(r.fgm, r.fga),
    tpPct: formatPct(r.tpm, r.tpa),
    ftPct: formatPct(r.ftm, r.fta),
  })),
)
const totals = computed(() => teamTotals(props.rows))
const perGame = (n: number) => (props.games ? (n / props.games).toFixed(1) : '—')
</script>

<template>
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
      <tr v-if="display.length === 0">
        <td colspan="15" class="py-6 text-center font-sans text-ink-500">
          {{ emptyText ?? 'No stats yet.' }}
        </td>
      </tr>
      <tr
        v-for="r in display"
        :key="r.player_id"
        class="cursor-pointer border-b border-ink-800 transition"
        :class="selectedId === r.player_id ? 'bg-ink-700' : 'hover:bg-ink-800/40'"
        @click="$emit('select', selectedId === r.player_id ? null : r.player_id)"
      >
        <td class="py-1.5 text-left">
          <span class="font-mono text-xs text-ink-500">#{{ r.number ?? '—' }}</span>
          <span class="ml-1">{{ r.name }}</span>
        </td>
        <td class="text-ink-500">{{ r.gp }}</td>
        <td class="font-bold text-chalk">{{ r.pts }}</td>
        <td class="font-semibold text-rim">{{ r.ppgText }}</td>
        <td>{{ r.fgPct }}</td><td>{{ r.tpPct }}</td><td>{{ r.ftPct }}</td>
        <td>{{ r.reb }}</td>
        <td class="text-ink-500">{{ r.rpgText }}</td>
        <td>{{ r.ast }}</td>
        <td class="text-ink-500">{{ r.apgText }}</td>
        <td>{{ r.stl }}</td><td>{{ r.blk }}</td><td>{{ r.tov }}</td><td>{{ r.pf }}</td>
      </tr>
    </tbody>
    <tfoot v-if="display.length" class="font-semibold text-chalk">
      <tr class="border-t border-ink-600">
        <td class="py-1.5 text-left">Team</td>
        <td class="text-ink-500">{{ games }}</td>
        <td>{{ totals.pts }}</td>
        <td class="text-rim">{{ perGame(totals.pts) }}</td>
        <td>{{ formatPct(totals.fgm, totals.fga) }}</td>
        <td>{{ formatPct(totals.tpm, totals.tpa) }}</td>
        <td>{{ formatPct(totals.ftm, totals.fta) }}</td>
        <td>{{ totals.reb }}</td>
        <td class="text-ink-500">{{ perGame(totals.reb) }}</td>
        <td>{{ totals.ast }}</td>
        <td class="text-ink-500">{{ perGame(totals.ast) }}</td>
        <td>{{ totals.stl }}</td><td>{{ totals.blk }}</td><td>{{ totals.tov }}</td><td>{{ totals.pf }}</td>
      </tr>
    </tfoot>
  </table>
</template>
