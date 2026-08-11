import { ref } from 'vue'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { ShotEvent } from '@/types'

const shots = ref<ShotEvent[]>([])
const error = ref<string | null>(null)

export function useShotChart() {
  async function fetchShots(gameId: string) {
    if (!isSupabaseConfigured) return
    const { data, error: e } = await supabase
      .from('shot_events')
      .select('*')
      .eq('game_id', gameId)
      .order('created_at', { ascending: true })
    if (e) error.value = e.message
    else shots.value = (data ?? []) as ShotEvent[]
  }

  async function recordShot(
    gameId: string,
    playerId: string,
    x: number,
    y: number,
    made: boolean,
    period = 1,
  ): Promise<ShotEvent | null> {
    const { data, error: err } = await supabase
      .from('shot_events')
      .insert({ game_id: gameId, player_id: playerId, x, y, made, period })
      .select()
      .single()
    if (err) { error.value = err.message; return null }
    shots.value = [...shots.value, data as ShotEvent]
    return data as ShotEvent
  }

  async function deleteShot(id: string): Promise<boolean> {
    const { error: err } = await supabase.from('shot_events').delete().eq('id', id)
    if (err) { error.value = err.message; return false }
    shots.value = shots.value.filter((s) => s.id !== id)
    return true
  }

  return { shots, error, fetchShots, recordShot, deleteShot }
}
