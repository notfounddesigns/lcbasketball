<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import { useAccess } from '@/composables/useAccess'
import { useTeams } from '@/composables/useTeams'
import { useConfirm } from '@/composables/useConfirm'
import { useToast } from '@/composables/useToast'
import type { Player, Profile, Role, Team } from '@/types'
import { CheckIcon, EnvelopeIcon, PencilIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/vue/24/outline'

const router = useRouter()
const { user, signOut } = useAuth()
const { profile, role, isAdmin, canEdit, migrated, teams, currentTeamId, ensureAccess } = useAccess()
const {
  profiles, coachLinks, playerLinks, allPlayers, error,
  loadManagement, createTeam, renameTeam, deleteTeam,
  addCoach, removeCoach, createPlayer, addPlayerToTeam, removePlayerFromTeam,
  invite, setRole,
} = useTeams()
const { confirm } = useConfirm()
const { toast } = useToast()

const busy = ref(false)

onMounted(async () => {
  await ensureAccess()
  if (migrated.value && canEdit.value) await loadManagement()
})

const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', coach: 'Coach', player: 'Player' }
const roleTone = (r: Role) =>
  r === 'admin' ? 'bg-rim/20 text-rim' : r === 'coach' ? 'bg-home/20 text-home' : 'bg-ink-600 text-ink-300'

function personName(p: Profile | undefined) {
  return p ? p.display_name || p.email : 'Unknown'
}
const profileById = computed(() => new Map(profiles.value.map((p) => [p.id, p])))
const playerById = computed(() => new Map(allPlayers.value.map((p) => [p.id, p])))

// ---------- teams ----------
const openTeamId = ref<string | null>(null)
watch(teams, (list) => {
  if (!openTeamId.value && list.length === 1) openTeamId.value = list[0].id
})

const newTeamName = ref('')
async function onCreateTeam() {
  if (!newTeamName.value.trim()) return
  const id = await createTeam(newTeamName.value)
  if (!id) return toast(error.value ?? 'Could not create team', 'error')
  toast(`${newTeamName.value.trim()} created`)
  newTeamName.value = ''
  openTeamId.value = id
  if (!currentTeamId.value) currentTeamId.value = id
}

const renaming = reactive<{ id: string | null; name: string }>({ id: null, name: '' })
async function saveRename(t: Team) {
  if (!renaming.name.trim()) return
  if (await renameTeam(t.id, renaming.name)) renaming.id = null
  else toast(error.value ?? 'Could not rename', 'error')
}

async function onDeleteTeam(t: Team) {
  const ok = await confirm({
    title: 'Delete team',
    message: `Delete ${t.name}? Its coach and roster assignments are removed. Teams with plays, games or practice plans can't be deleted.`,
    confirmText: 'Delete',
    tone: 'danger',
  })
  if (!ok) return
  if (await deleteTeam(t.id)) toast(`${t.name} deleted`)
  else toast(error.value ?? 'Could not delete team', 'error')
}

const coachesOf = (teamId: string) =>
  coachLinks.value.filter((l) => l.team_id === teamId).map((l) => profileById.value.get(l.user_id)).filter(Boolean) as Profile[]
const coachCandidates = (teamId: string) => {
  const on = new Set(coachLinks.value.filter((l) => l.team_id === teamId).map((l) => l.user_id))
  return profiles.value.filter((p) => (p.role === 'coach' || p.role === 'admin') && !on.has(p.id))
}
const rosterOf = (teamId: string) =>
  playerLinks.value
    .filter((l) => l.team_id === teamId)
    .map((l) => playerById.value.get(l.player_id))
    .filter(Boolean)
    .sort((a, b) => (a!.number ?? 999) - (b!.number ?? 999)) as Player[]
const playerCandidates = (teamId: string) => {
  const on = new Set(playerLinks.value.filter((l) => l.team_id === teamId).map((l) => l.player_id))
  return allPlayers.value.filter((p) => !on.has(p.id) && p.active !== false)
}
const teamsOfPlayer = (playerId: string) =>
  playerLinks.value.filter((l) => l.player_id === playerId).map((l) => teams.value.find((t) => t.id === l.team_id)?.name).filter(Boolean)

async function onAddCoach(teamId: string, e: Event) {
  const select = e.target as HTMLSelectElement
  if (select.value && !(await addCoach(teamId, select.value))) toast(error.value ?? 'Could not add coach', 'error')
  select.value = ''
}
async function onRemoveCoach(teamId: string, p: Profile) {
  if (!(await confirm({ title: 'Remove coach', message: `Remove ${personName(p)} from this team?`, confirmText: 'Remove' }))) return
  if (!(await removeCoach(teamId, p.id))) toast(error.value ?? 'Could not remove coach', 'error')
}
async function onAddExistingPlayer(teamId: string, e: Event) {
  const select = e.target as HTMLSelectElement
  if (select.value && !(await addPlayerToTeam(teamId, select.value))) toast(error.value ?? 'Could not add player', 'error')
  select.value = ''
}
async function onRemovePlayer(teamId: string, p: Player) {
  if (!(await confirm({ title: 'Remove from roster', message: `Take ${p.name} off this team? Their stats stay.`, confirmText: 'Remove' }))) return
  if (!(await removePlayerFromTeam(teamId, p.id))) toast(error.value ?? 'Could not remove player', 'error')
}

const newPlayer = reactive({ name: '', number: null as number | null })
async function onCreatePlayer(teamId: string) {
  if (!newPlayer.name.trim()) return
  if (await createPlayer(newPlayer.name, newPlayer.number, [teamId])) {
    toast(`${newPlayer.name.trim()} added`)
    newPlayer.name = ''
    newPlayer.number = null
  } else toast(error.value ?? 'Could not add player', 'error')
}

// Player logins: invite by email, linked to the roster entry.
const invitingPlayer = reactive<{ id: string | null; email: string }>({ id: null, email: '' })
async function onInvitePlayer(p: Player) {
  if (!invitingPlayer.email.trim()) return
  busy.value = true
  const ok = await invite({ email: invitingPlayer.email, role: 'player', displayName: p.name, playerId: p.id })
  busy.value = false
  if (!ok) return toast(error.value ?? 'Could not send invite', 'error')
  toast(`Invite sent to ${invitingPlayer.email.trim()}`)
  invitingPlayer.id = null
  invitingPlayer.email = ''
}

// ---------- people (admin) ----------
const newPerson = reactive({ email: '', name: '', role: 'coach' as Role })
async function onInvitePerson() {
  if (!newPerson.email.trim()) return
  busy.value = true
  const ok = await invite({ email: newPerson.email, role: newPerson.role, displayName: newPerson.name })
  busy.value = false
  if (!ok) return toast(error.value ?? 'Could not send invite', 'error')
  toast(`Invite sent to ${newPerson.email.trim()}`)
  newPerson.email = ''
  newPerson.name = ''
}
async function onChangeRole(p: Profile, e: Event) {
  const next = (e.target as HTMLSelectElement).value as Role
  if (next === p.role) return
  if (p.id === user.value?.id && next !== 'admin') {
    const ok = await confirm({ title: 'Change your own role', message: "You'll lose admin access. Continue?", confirmText: 'Change', tone: 'danger' })
    if (!ok) return ((e.target as HTMLSelectElement).value = p.role)
  }
  if (await setRole(p.id, next)) toast(`${personName(p)} is now ${ROLE_LABEL[next].toLowerCase()}`)
  else toast(error.value ?? 'Could not change role', 'error')
}

// ---------- sign out ----------
async function handleSignOut() {
  const ok = await confirm({
    title: 'Sign out?',
    message: "You'll need your email and password to get back in.",
    confirmText: 'Sign out',
  })
  if (!ok) return
  busy.value = true
  await signOut()
  busy.value = false
  await router.replace({ name: 'login' })
}
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-5 overflow-y-auto pb-24 pt-2" style="height: calc(100dvh - 80px)">
    <h1 class="font-stencil text-2xl font-bold uppercase tracking-wide text-chalk">Account</h1>

    <!-- Who's signed in -->
    <section class="card flex flex-wrap items-center gap-3 p-4">
      <div class="min-w-0 grow">
        <p class="truncate font-semibold">{{ profile?.display_name || user?.email }}</p>
        <p v-if="profile?.display_name" class="truncate text-sm text-ink-500">{{ user?.email }}</p>
      </div>
      <span v-if="migrated" class="rounded-full px-2.5 py-1 text-xs font-semibold" :class="roleTone(role)">{{ ROLE_LABEL[role] }}</span>
      <button class="btn-danger py-1.5 text-sm" :disabled="busy" @click="handleSignOut">Sign out</button>
    </section>

    <p v-if="!migrated" class="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
      Teams and roles aren't set up yet — run the newest migration at the end of
      <code class="font-mono">supabase/schema.sql</code> in the Supabase SQL Editor.
    </p>

    <template v-else>
      <!-- Current team -->
      <section>
        <h2 class="label">Showing team</h2>
        <div v-if="teams.length" class="flex flex-wrap gap-2">
          <button
            v-for="t in teams"
            :key="t.id"
            class="rounded-full border px-3 py-1.5 text-sm font-semibold transition"
            :class="currentTeamId === t.id ? 'border-rim bg-rim text-white' : 'border-ink-600 text-ink-400 hover:text-chalk'"
            :aria-pressed="currentTeamId === t.id"
            @click="currentTeamId = t.id"
          >{{ t.name }}</button>
        </div>
        <p v-else class="text-sm text-ink-500">
          {{ canEdit ? "You're not on a team yet — create one below." : "You're not on a team yet. Ask your coach to add you." }}
        </p>
      </section>

      <!-- Teams: coaches and admins -->
      <section v-if="canEdit" class="flex flex-col gap-3">
        <h2 class="font-stencil text-lg font-bold">Teams</h2>

        <article v-for="t in teams" :key="t.id" class="card overflow-hidden">
          <header class="flex items-center gap-2 p-3">
            <template v-if="renaming.id === t.id">
              <input v-model="renaming.name" class="input py-1.5" aria-label="Team name" @keyup.enter="saveRename(t)" />
              <button class="text-home" title="Save" aria-label="Save" @click="saveRename(t)"><CheckIcon class="h-5 w-5" /></button>
              <button class="text-ink-500" title="Cancel" aria-label="Cancel" @click="renaming.id = null"><XMarkIcon class="h-5 w-5" /></button>
            </template>
            <template v-else>
              <button class="grow text-left font-semibold" :aria-expanded="openTeamId === t.id" @click="openTeamId = openTeamId === t.id ? null : t.id">
                {{ t.name }}
                <span class="ml-2 text-xs font-normal text-ink-500">
                  {{ coachesOf(t.id).length }} coach{{ coachesOf(t.id).length === 1 ? '' : 'es' }} ·
                  {{ rosterOf(t.id).length }} player{{ rosterOf(t.id).length === 1 ? '' : 's' }}
                </span>
              </button>
              <button class="text-ink-500 hover:text-chalk" title="Rename team" aria-label="Rename team" @click="renaming.id = t.id; renaming.name = t.name"><PencilIcon class="h-4 w-4" /></button>
              <button class="text-red-500 hover:text-red-300" title="Delete team" aria-label="Delete team" @click="onDeleteTeam(t)"><TrashIcon class="h-4 w-4" /></button>
            </template>
          </header>

          <div v-if="openTeamId === t.id" class="grid gap-4 border-t border-ink-700/60 p-3 md:grid-cols-2">
            <!-- Coaches -->
            <div>
              <h3 class="label">Coaches</h3>
              <ul class="mb-2 space-y-1 text-sm">
                <li v-for="c in coachesOf(t.id)" :key="c.id" class="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-ink-800">
                  <span class="grow truncate">{{ personName(c) }}</span>
                  <button class="text-ink-500 hover:text-red-400" title="Remove coach" :aria-label="`Remove ${personName(c)}`" @click="onRemoveCoach(t.id, c)"><XMarkIcon class="h-4 w-4" /></button>
                </li>
                <li v-if="!coachesOf(t.id).length" class="px-2 text-ink-500">No coaches yet.</li>
              </ul>
              <select v-if="coachCandidates(t.id).length" class="input py-1.5 text-sm" aria-label="Add a coach" @change="onAddCoach(t.id, $event)">
                <option value="">+ Add a coach…</option>
                <option v-for="p in coachCandidates(t.id)" :key="p.id" :value="p.id">{{ personName(p) }}</option>
              </select>
              <p v-else-if="isAdmin" class="text-xs text-ink-500">Invite more coaches under People.</p>
            </div>

            <!-- Roster -->
            <div>
              <h3 class="label">Roster</h3>
              <ul class="mb-2 space-y-1 text-sm">
                <li v-for="p in rosterOf(t.id)" :key="p.id" class="rounded-lg px-2 py-1 hover:bg-ink-800">
                  <div class="flex items-center gap-2">
                    <span class="w-7 shrink-0 text-right font-mono text-ink-500">{{ p.number ?? '—' }}</span>
                    <span class="grow truncate">
                      {{ p.name }}
                      <span v-if="teamsOfPlayer(p.id).length > 1" class="text-xs text-ink-500">· {{ teamsOfPlayer(p.id).join(', ') }}</span>
                    </span>
                    <span v-if="p.user_id" class="text-[11px] text-home" title="Has a login">login ✓</span>
                    <button
                      v-else
                      class="text-ink-500 hover:text-chalk"
                      title="Invite this player to sign in" :aria-label="`Invite ${p.name} to sign in`"
                      @click="invitingPlayer.id = invitingPlayer.id === p.id ? null : p.id; invitingPlayer.email = ''"
                    ><EnvelopeIcon class="h-4 w-4" /></button>
                    <button class="text-ink-500 hover:text-red-400" title="Remove from team" :aria-label="`Remove ${p.name}`" @click="onRemovePlayer(t.id, p)"><XMarkIcon class="h-4 w-4" /></button>
                  </div>
                  <form v-if="invitingPlayer.id === p.id" class="mt-1.5 flex gap-1.5" @submit.prevent="onInvitePlayer(p)">
                    <input v-model="invitingPlayer.email" type="email" class="input py-1 text-xs" placeholder="player@email.com" :aria-label="`${p.name}'s email`" />
                    <button class="btn-primary shrink-0 px-2 py-1 text-xs" :disabled="busy">Invite</button>
                  </form>
                </li>
                <li v-if="!rosterOf(t.id).length" class="px-2 text-ink-500">No players yet.</li>
              </ul>
              <select v-if="playerCandidates(t.id).length" class="input mb-2 py-1.5 text-sm" aria-label="Add an existing player" @change="onAddExistingPlayer(t.id, $event)">
                <option value="">+ Add an existing player (e.g. from JV)…</option>
                <option v-for="p in playerCandidates(t.id)" :key="p.id" :value="p.id">#{{ p.number ?? '—' }} {{ p.name }}</option>
              </select>
              <form class="flex gap-1.5" @submit.prevent="onCreatePlayer(t.id)">
                <input v-model.number="newPlayer.number" type="number" min="0" class="input !w-16 shrink-0 py-1.5 text-center text-sm" placeholder="#" aria-label="Number" />
                <input v-model="newPlayer.name" class="input py-1.5 text-sm" placeholder="New player name" aria-label="New player name" />
                <button class="btn-ghost shrink-0 px-2 py-1.5" title="Add player" aria-label="Add player"><PlusIcon class="h-4 w-4" /></button>
              </form>
            </div>
          </div>
        </article>

        <form class="flex gap-2" @submit.prevent="onCreateTeam">
          <input v-model="newTeamName" class="input" placeholder="New team, e.g. Girls Varsity" aria-label="New team name" />
          <button class="btn-primary shrink-0" :disabled="!newTeamName.trim()"><PlusIcon class="h-5 w-5" />Team</button>
        </form>
      </section>

      <!-- People: admins only -->
      <section v-if="isAdmin" class="flex flex-col gap-3">
        <h2 class="font-stencil text-lg font-bold">People</h2>
        <ul class="card divide-y divide-ink-700/60">
          <li v-for="p in profiles" :key="p.id" class="flex items-center gap-3 px-3 py-2 text-sm">
            <div class="min-w-0 grow">
              <p class="truncate">{{ p.display_name || p.email }}</p>
              <p v-if="p.display_name" class="truncate text-xs text-ink-500">{{ p.email }}</p>
            </div>
            <select class="input !w-28 shrink-0 py-1 text-xs" :value="p.role" :aria-label="`Role for ${p.email}`" @change="onChangeRole(p, $event)">
              <option value="admin">Admin</option>
              <option value="coach">Coach</option>
              <option value="player">Player</option>
            </select>
          </li>
        </ul>
        <form class="card grid gap-2 p-3 sm:grid-cols-[1fr_1fr_7rem_auto]" @submit.prevent="onInvitePerson">
          <input v-model="newPerson.email" type="email" class="input min-w-0 py-1.5 text-sm" placeholder="Email" aria-label="Email" />
          <input v-model="newPerson.name" class="input min-w-0 py-1.5 text-sm" placeholder="Name (optional)" aria-label="Name" />
          <select v-model="newPerson.role" class="input py-1.5 text-sm" aria-label="Role">
            <option value="coach">Coach</option>
            <option value="admin">Admin</option>
            <option value="player">Player</option>
          </select>
          <button class="btn-primary py-1.5 text-sm" :disabled="busy || !newPerson.email.trim()"><EnvelopeIcon class="h-4 w-4" />Invite</button>
        </form>
        <p class="text-xs text-ink-500">
          Invites arrive by email; the link opens a page to choose a password. Add new coaches to their teams above.
        </p>
      </section>

      <p v-if="error" class="text-sm text-red-400">{{ error }}</p>
    </template>
  </div>
</template>
