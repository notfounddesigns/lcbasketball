import { createRouter, createWebHashHistory } from 'vue-router'
import PlaysView from '@/views/PlaysView.vue'
import StatsView from '@/views/StatsView.vue'
import PlayEditorView from '@/views/PlayEditorView.vue'
import PrintPlayView from '@/views/PrintPlayView.vue'
import PracticePlanView from '@/views/PracticePlanView.vue'
import PrintPracticePlanView from '@/views/PrintPracticePlanView.vue'
import WhiteboardView from '@/views/WhiteboardView.vue'
import AccountView from '@/views/AccountView.vue'
import LoginView from '@/views/LoginView.vue'
import { initAuth, useAuth } from '@/composables/useAuth'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/plays' },
    { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
    { path: '/plays', name: 'plays', component: PlaysView },
    { path: '/plays/new', name: 'play-new', component: PlayEditorView },
    { path: '/plays/:id/print', name: 'play-print', component: PrintPlayView },
    { path: '/plays/:id', name: 'play-edit', component: PlayEditorView },
    { path: '/stats', name: 'stats', component: StatsView },
    { path: '/practice', name: 'practice', component: PracticePlanView },
    { path: '/practice-plans/:id/print', name: 'practice-plan-print', component: PrintPracticePlanView },
    { path: '/whiteboard', name: 'whiteboard', component: WhiteboardView },
    { path: '/account', name: 'account', component: AccountView },
  ],
})

const { isAuthenticated } = useAuth()

// Every route but /login needs a session. This is a UX gate only — the data is
// actually protected by the `authenticated` RLS policies in supabase/schema.sql,
// so a forged client-side session still reads nothing.
router.beforeEach(async (to) => {
  if (import.meta.env.DEV) { return true }
  // Awaited on every navigation, but initAuth caches its promise, so only the
  // first one pays for restoring the persisted session.
  await initAuth()

  if (to.meta.public) {
    // Nothing to do on the login screen once you're already signed in.
    return isAuthenticated.value ? { path: '/' } : true
  }

  if (!isAuthenticated.value) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  return true
})
