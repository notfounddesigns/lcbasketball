import { computed, ref, watch } from 'vue'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/composables/useAuth'
import type { Profile, Role, Team } from '@/types'

// Who's signed in (role) and which team the app is showing. Module-level so
// every view and composable shares one copy.
const profile = ref<Profile | null>(null)
const teams = ref<Team[]>([])
// False until the roles migration has run: the app then behaves as before
// (one shared program, every signed-in coach can edit).
const migrated = ref(true)

const TEAM_KEY = 'lcbb-team'
function readStoredTeam(): string | null {
  try {
    return localStorage.getItem(TEAM_KEY)
  } catch {
    return null
  }
}
const currentTeamId = ref<string | null>(readStoredTeam())
watch(currentTeamId, (id) => {
  try {
    if (id) localStorage.setItem(TEAM_KEY, id)
    else localStorage.removeItem(TEAM_KEY)
  } catch {
    // Private mode: the choice just won't survive a reload.
  }
})

const { user } = useAuth()
// No profile: before the migration (or signed out in local dev) everyone can
// edit as before; a signed-in account without a profile gets nothing.
const role = computed<Role>(() => profile.value?.role ?? (migrated.value && user.value ? 'player' : 'admin'))
const isAdmin = computed(() => role.value === 'admin')
// Coaches and admins create and change things; players only look.
const canEdit = computed(() => role.value === 'admin' || role.value === 'coach')
const currentTeam = computed(() => teams.value.find((t) => t.id === currentTeamId.value) ?? null)

let loadedFor: string | null = null
let loading: Promise<void> | null = null

async function load(userId: string) {
  const { data: prof, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) {
    // "relation public.profiles does not exist" etc.: the migration hasn't run.
    migrated.value = !/does not exist|schema cache/i.test(error.message)
    profile.value = null
    teams.value = []
    return
  }
  migrated.value = true
  profile.value = (prof as Profile | null) ?? null
  await refreshTeams()
}

async function refreshTeams() {
  const { data } = await supabase.from('teams').select('*').order('name')
  teams.value = (data ?? []) as Team[]
  // Keep the chosen team if it's still visible, else fall back to the first.
  if (!teams.value.some((t) => t.id === currentTeamId.value)) {
    currentTeamId.value = teams.value[0]?.id ?? null
  }
}

/**
 * Load the signed-in user's profile and teams once per sign-in. Every data
 * fetch awaits this so it can scope its query to the current team.
 */
function ensureAccess(): Promise<void> {
  const id = user.value?.id ?? null
  if (!isSupabaseConfigured || !id) return Promise.resolve()
  if (loadedFor === id && loading) return loading
  loadedFor = id
  loading = load(id)
  return loading
}

function resetAccess() {
  loadedFor = null
  loading = null
  profile.value = null
  teams.value = []
}

/**
 * The team a query should be limited to. `skip` means there's nothing to show
 * (signed in under the new model but not on any team yet); `teamId` null with
 * skip false means the roles migration hasn't run, so don't filter.
 */
async function teamScope(): Promise<{ teamId: string | null; skip: boolean }> {
  await ensureAccess()
  if (!migrated.value || !user.value) return { teamId: null, skip: false }
  return { teamId: currentTeamId.value, skip: !currentTeamId.value }
}

/** Columns to add to a new team-owned row (plays, games, practice plans). */
function teamColumns(): { team_id?: string } {
  return migrated.value && user.value && currentTeamId.value ? { team_id: currentTeamId.value } : {}
}

export function useAccess() {
  return {
    profile,
    teams,
    migrated,
    role,
    isAdmin,
    canEdit,
    currentTeamId,
    currentTeam,
    ensureAccess,
    refreshTeams,
    resetAccess,
    teamScope,
    teamColumns,
  }
}
