import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAccess } from '@/composables/useAccess'
import type { Player, Profile, Role } from '@/types'

// Team and account management for the Account screen. Row-level security does
// the real enforcement (see the roles migration in supabase/schema.sql); this
// only offers what the signed-in role is allowed to do.
const profiles = ref<Profile[]>([])
const coachLinks = ref<{ team_id: string; user_id: string }[]>([])
const playerLinks = ref<{ team_id: string; player_id: string }[]>([])
const allPlayers = ref<Player[]>([]) // our players (not scouted) visible to this user
const error = ref<string | null>(null)

const { refreshTeams } = useAccess()

function fail(message: string | undefined): false {
  error.value = message ?? 'Something went wrong.'
  return false
}

export function useTeams() {
  async function loadManagement() {
    error.value = null
    const [prof, coaches, links, players] = await Promise.all([
      supabase.from('profiles').select('*').order('email'),
      supabase.from('team_coaches').select('*'),
      supabase.from('team_players').select('*'),
      supabase.from('players').select('*').is('scout_team', null).order('name'),
    ])
    const err = prof.error ?? coaches.error ?? links.error ?? players.error
    if (err) error.value = err.message
    profiles.value = (prof.data ?? []) as Profile[]
    coachLinks.value = coaches.data ?? []
    playerLinks.value = links.data ?? []
    allPlayers.value = (players.data ?? []) as Player[]
    await refreshTeams()
  }

  // ---------- teams ----------
  async function createTeam(name: string): Promise<string | null> {
    const { data, error: err } = await supabase.from('teams').insert({ name: name.trim() }).select('id').single()
    if (err) {
      fail(err.message)
      return null
    }
    await loadManagement()
    return (data as { id: string }).id
  }

  async function renameTeam(id: string, name: string) {
    const { error: err } = await supabase.from('teams').update({ name: name.trim() }).eq('id', id)
    if (err) return fail(err.message)
    await refreshTeams()
    return true
  }

  async function deleteTeam(id: string) {
    const { error: err } = await supabase.from('teams').delete().eq('id', id)
    if (err) {
      return fail(
        /foreign key|violates/i.test(err.message)
          ? "This team still has plays, games or practice plans, so it can't be deleted."
          : err.message,
      )
    }
    await loadManagement()
    return true
  }

  // ---------- coaches ----------
  async function addCoach(teamId: string, userId: string) {
    const { error: err } = await supabase.from('team_coaches').insert({ team_id: teamId, user_id: userId })
    if (err) return fail(err.message)
    coachLinks.value = [...coachLinks.value, { team_id: teamId, user_id: userId }]
    return true
  }

  async function removeCoach(teamId: string, userId: string) {
    const { error: err } = await supabase.from('team_coaches').delete().match({ team_id: teamId, user_id: userId })
    if (err) return fail(err.message)
    coachLinks.value = coachLinks.value.filter((l) => !(l.team_id === teamId && l.user_id === userId))
    return true
  }

  // ---------- players ----------
  async function createPlayer(name: string, number: number | null, teamIds: string[]) {
    const { data, error: err } = await supabase
      .from('players')
      .insert({ name: name.trim(), number, position: null, active: true })
      .select()
      .single()
    if (err) return fail(err.message)
    const player = data as Player
    if (teamIds.length) {
      const { error: linkErr } = await supabase
        .from('team_players')
        .insert(teamIds.map((team_id) => ({ team_id, player_id: player.id })))
      if (linkErr) return fail(linkErr.message)
    }
    await loadManagement()
    return true
  }

  async function addPlayerToTeam(teamId: string, playerId: string) {
    const { error: err } = await supabase.from('team_players').insert({ team_id: teamId, player_id: playerId })
    if (err) return fail(err.message)
    playerLinks.value = [...playerLinks.value, { team_id: teamId, player_id: playerId }]
    return true
  }

  async function removePlayerFromTeam(teamId: string, playerId: string) {
    const { error: err } = await supabase.from('team_players').delete().match({ team_id: teamId, player_id: playerId })
    if (err) return fail(err.message)
    playerLinks.value = playerLinks.value.filter((l) => !(l.team_id === teamId && l.player_id === playerId))
    return true
  }

  // ---------- people ----------
  /** Email an invite (Edge Function `invite-user`); the link lands on Set Password. */
  async function invite(opts: { email: string; role: Role; displayName?: string; playerId?: string }) {
    error.value = null
    const { data, error: err } = await supabase.functions.invoke('invite-user', {
      body: {
        email: opts.email.trim(),
        role: opts.role,
        display_name: opts.displayName?.trim() || null,
        player_id: opts.playerId ?? null,
        redirect_to: location.origin + location.pathname,
      },
    })
    if (err) {
      // The function's own message (bad email, not allowed…) is in the body.
      let message = err.message
      try {
        const body = await (err as { context?: Response }).context?.json()
        if (body?.error) message = body.error
      } catch {
        // Not JSON (e.g. the function isn't deployed): keep the generic message.
      }
      if (/not found|failed to send|fetch/i.test(message)) {
        message = 'The invite service isn\'t set up yet — deploy the invite-user Edge Function (see README).'
      }
      return fail(message)
    }
    if (data?.error) return fail(data.error)
    await loadManagement()
    return true
  }

  async function setRole(userId: string, role: Role) {
    const { error: err } = await supabase.from('profiles').update({ role }).eq('id', userId)
    if (err) return fail(err.message)
    profiles.value = profiles.value.map((p) => (p.id === userId ? { ...p, role } : p))
    return true
  }

  return {
    profiles,
    coachLinks,
    playerLinks,
    allPlayers,
    error,
    loadManagement,
    createTeam,
    renameTeam,
    deleteTeam,
    addCoach,
    removeCoach,
    createPlayer,
    addPlayerToTeam,
    removePlayerFromTeam,
    invite,
    setRole,
  }
}
