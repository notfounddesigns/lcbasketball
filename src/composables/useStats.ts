import { ref } from 'vue'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { Game, Player, StatEvent, StatType, SubEvent } from '@/types'

// Module-level singletons — state is shared across all component instances.
// Intentional for a single-coach app; revisit if multi-user context is ever needed.
const players = ref<Player[]>([])
const games = ref<Game[]>([])
const events = ref<StatEvent[]>([])
const allEvents = ref<StatEvent[]>([])
const subEvents = ref<SubEvent[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

export function useStats() {
  async function fetchPlayers() {
    if (!isSupabaseConfigured) {
      error.value = 'Supabase not configured — see README.'
      return
    }
    const { data, error: err } = await supabase
      .from('players')
      .select('*')
      .order('number', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true })
    if (err) error.value = err.message
    else players.value = (data ?? []) as Player[]
  }

  async function fetchGames() {
    if (!isSupabaseConfigured) {
      error.value = 'Supabase not configured — see README.'
      return
    }
    const { data, error: err } = await supabase
      .from('games')
      .select('*')
      .order('played_on', { ascending: false })
    if (err) error.value = err.message
    else games.value = (data ?? []) as Game[]
  }

  // Each game switch bumps these, so a slow response for the game the coach
  // just left can't overwrite (or be added to) the one they opened.
  let eventsReq = 0
  let subsReq = 0

  async function fetchEvents(gameId: string) {
    const req = ++eventsReq
    events.value = []
    loading.value = true
    const { data, error: err } = await supabase
      .from('stat_events')
      .select('*')
      .eq('game_id', gameId)
      .order('created_at', { ascending: true })
    if (req !== eventsReq) return
    if (err) error.value = err.message
    else events.value = (data ?? []) as StatEvent[]
    loading.value = false
  }

  async function addPlayer(p: Omit<Player, 'id'>): Promise<Player | null> {
    const { data, error: err } = await supabase.from('players').insert(p).select().single()
    if (err) {
      error.value = err.message
      return null
    }
    await fetchPlayers()
    return data as Player
  }

  async function updatePlayer(id: string, patch: Partial<Omit<Player, 'id'>>): Promise<Player | null> {
    const { data, error: err } = await supabase.from('players').update(patch).eq('id', id).select().single()
    if (err) { error.value = err.message; return null }
    await fetchPlayers()
    return data as Player
  }


  async function createGame(g: Omit<Game, 'id' | 'created_at'>): Promise<Game | null> {
    // Never persist a blank opponent — it renders as an empty card in the games list.
    const opponent = g.opponent?.trim()
    if (!opponent) {
      error.value = 'Opponent name is required.'
      return null
    }
    g = { ...g, opponent }
    const { data, error: err } = await supabase.from('games').insert(g).select().single()
    if (err) {
      error.value = err.message
      return null
    }
    games.value = [data as Game, ...games.value]
    return data as Game
  }

  async function updateGame(id: string, patch: Partial<Omit<Game, 'id' | 'created_at'>>): Promise<Game | null> {
    const { data, error: err } = await supabase.from('games').update(patch).eq('id', id).select().single()
    if (err) { error.value = err.message; return null }
    games.value = games.value.map((g) => (g.id === id ? (data as Game) : g))
    return data as Game
  }

  async function deleteGame(id: string): Promise<boolean> {
    const { error: err } = await supabase.from('games').delete().eq('id', id)
    if (err) { error.value = err.message; return false }
    games.value = games.value.filter((g) => g.id !== id)
    allEvents.value = allEvents.value.filter((e) => e.game_id !== id)
    return true
  }

  // Supabase caps a single response (1,000 rows by default), so a season's
  // worth of stat events has to be read page by page or the newest games
  // silently drop out of the season totals.
  async function fetchAllEvents() {
    if (!isSupabaseConfigured) return
    const PAGE = 1000
    const rows: StatEvent[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error: err } = await supabase
        .from('stat_events')
        .select('*')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }) // tie-break so pages never overlap or skip
        .range(from, from + PAGE - 1)
      if (err) {
        error.value = err.message
        return
      }
      rows.push(...((data ?? []) as StatEvent[]))
      if (!data || data.length < PAGE) break
    }
    allEvents.value = rows
  }

  // Append-only: record one stat event (the audit trail). Undo deletes the last.
  async function recordStat(
    gameId: string,
    playerId: string,
    stat: StatType,
    period = 1,
  ): Promise<StatEvent | null> {
    const { data, error: err } = await supabase
      .from('stat_events')
      .insert({ game_id: gameId, player_id: playerId, stat, period })
      .select()
      .single()
    if (err) {
      error.value = err.message
      return null
    }
    events.value = [...events.value, data as StatEvent]
    allEvents.value = [...allEvents.value, data as StatEvent]
    return data as StatEvent
  }

  async function fetchSubEvents(gameId: string) {
    const req = ++subsReq
    subEvents.value = []
    if (!isSupabaseConfigured) return
    const { data, error: err } = await supabase
      .from('sub_events')
      .select('*')
      .eq('game_id', gameId)
      .order('created_at', { ascending: true })
    if (req !== subsReq) return
    if (err) error.value = err.message
    else subEvents.value = (data ?? []) as SubEvent[]
  }

  async function recordSub(
    gameId: string,
    playerIdIn: string,
    playerIdOut: string,
    period = 1,
  ): Promise<boolean> {
    const { data, error: err } = await supabase
      .from('sub_events')
      .insert({ game_id: gameId, player_id_in: playerIdIn, player_id_out: playerIdOut, period })
      .select()
      .single()
    if (err) { error.value = err.message; return false }
    subEvents.value = [...subEvents.value, data as SubEvent]
    return true
  }

  async function deleteSub(id: string): Promise<boolean> {
    const { error: err } = await supabase.from('sub_events').delete().eq('id', id)
    if (err) { error.value = err.message; return false }
    subEvents.value = subEvents.value.filter((s) => s.id !== id)
    return true
  }

  // Returns the deleted event so callers can undo paired records (e.g. the
  // shot_event that a shooting stat was recorded alongside).
  async function undoLastFor(playerId: string): Promise<StatEvent | null> {
    const playerEvents = events.value.filter((e) => e.player_id === playerId)
    const last = playerEvents[playerEvents.length - 1]
    if (!last) return null
    const { error: err } = await supabase.from('stat_events').delete().eq('id', last.id)
    if (err) {
      error.value = err.message
      return null
    }
    events.value = events.value.filter((e) => e.id !== last.id)
    allEvents.value = allEvents.value.filter((e) => e.id !== last.id)
    return last
  }

  // Delete one specific stat event (e.g. the stat paired with a shot marker
  // removed from the shot chart).
  async function deleteStatEvent(id: string): Promise<boolean> {
    const { error: err } = await supabase.from('stat_events').delete().eq('id', id)
    if (err) { error.value = err.message; return false }
    events.value = events.value.filter((e) => e.id !== id)
    allEvents.value = allEvents.value.filter((e) => e.id !== id)
    return true
  }

  return {
    players,
    games,
    events,
    allEvents,
    subEvents,
    loading,
    error,
    fetchPlayers,
    fetchGames,
    fetchEvents,
    fetchAllEvents,
    fetchSubEvents,
    recordSub,
    deleteSub,
    addPlayer,
    updatePlayer,
    createGame,
    updateGame,
    deleteGame,
    recordStat,
    undoLastFor,
    deleteStatEvent,
  }
}
