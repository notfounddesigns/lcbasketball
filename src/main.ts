import { createApp } from 'vue'
import App from '@/App.vue'
import { router } from '@/router'
import type { RouteLocationRaw } from 'vue-router'
import { supabase } from '@/lib/supabase'
import '@/style.css'
/* import the fontawesome core */
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'

/* import icons and add them to the Library */
import { faEraser, faPen, faPenRuler, faUserPlus, faCommentDots, faRotateLeft, faTrashCan, faDownload, faXmark } from '@fortawesome/free-solid-svg-icons'

library.add(faEraser, faPen, faPenRuler, faUserPlus, faCommentDots, faRotateLeft, faTrashCan, faDownload, faXmark)

// iOS Safari has ignored `user-scalable=no` since iOS 10, so the viewport meta
// alone will not stop a pinch. These WebKit-only gesture events are the
// remaining lever: refusing them holds the page at 1:1 on iPad, which is what a
// courtside tool wants when every touch is meant to be a drawing action.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false })
}

// Invite and password-reset emails land on `/#access_token=…&type=invite`.
// That hash would be read as a route by the hash router, so let supabase-js
// pick up the session from it first, then send the user to set a password.
// The router already exists by now (and has cached the token hash as its
// location), so the redirect has to go through it rather than history.
async function consumeAuthRedirect(): Promise<RouteLocationRaw | null> {
  const params = new URLSearchParams(location.hash.replace(/^#\/?/, ''))
  const error = params.get('error_description')
  if (error) return { name: 'login', query: { auth_error: error } }
  if (!params.get('access_token')) return null
  await supabase.auth.getSession() // resolves once the URL session is stored
  const type = params.get('type')
  return type === 'invite' || type === 'recovery' ? { name: 'set-password' } : '/'
}

consumeAuthRedirect()
  .then((target) => (target ? router.replace(target) : undefined))
  .finally(() => {
    createApp(App).use(router).component('font-awesome-icon', FontAwesomeIcon).mount('#app')
  })
