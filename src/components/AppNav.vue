<script setup lang="ts">
import { useRoute } from 'vue-router'
import { BookOpenIcon, ChartBarIcon, ClipboardIcon, ClipboardDocumentListIcon, UserCircleIcon } from '@heroicons/vue/24/outline'
import { BookOpenIcon as BookOpenSolid, ChartBarIcon as ChartBarSolid, ClipboardIcon as ClipboardSolid, ClipboardDocumentListIcon as ClipboardDocumentListSolid, UserCircleIcon as UserCircleSolid } from '@heroicons/vue/24/solid'
import { isSupabaseConfigured } from '@/lib/supabase'
import { useAccess } from '@/composables/useAccess'

// The Account tab carries the current team's name: it's where you switch.
const { currentTeam } = useAccess()

const route = useRoute()

const tabs = [
  { to: '/whiteboard', label: 'Draw', outline: ClipboardIcon, solid: ClipboardSolid },
  { to: '/practice', label: 'Practice', outline: ClipboardDocumentListIcon, solid: ClipboardDocumentListSolid },
  { to: '/plays', label: 'Plays', outline: BookOpenIcon, solid: BookOpenSolid },
  { to: '/stats', label: 'Stats', outline: ChartBarIcon, solid: ChartBarSolid },
  { to: '/account', label: 'Account', outline: UserCircleIcon, solid: UserCircleSolid }
]
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-30 border-t border-ink-700/60 bg-ink-900/95 backdrop-blur-xl"
    style="padding-bottom: env(safe-area-inset-bottom, 0px)"
  >
    <div
      v-if="!isSupabaseConfigured"
      class="border-b border-rim/20 bg-rim/10 px-4 py-1 text-center text-xs text-rim"
      title="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local"
    >
      Supabase not configured
    </div>

    <div class="mx-auto flex max-w-6xl">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-ink-500 transition-colors"
        active-class="!text-rim"
      >
        <component
          :is="route.path.startsWith(tab.to) ? tab.solid : tab.outline"
          class="h-6 w-6"
        />
        <span class="max-w-[6.5rem] truncate text-[10px] font-semibold uppercase tracking-wider">
          {{ tab.to === '/account' && currentTeam ? currentTeam.name : tab.label }}
        </span>
      </RouterLink>
    </div>
  </nav>
</template>
