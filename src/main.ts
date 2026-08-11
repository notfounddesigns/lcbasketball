import { createApp } from 'vue'
import App from '@/App.vue'
import { router } from '@/router'
import '@/style.css'

// iOS Safari has ignored `user-scalable=no` since iOS 10, so the viewport meta
// alone will not stop a pinch. These WebKit-only gesture events are the
// remaining lever: refusing them holds the page at 1:1 on iPad, which is what a
// courtside tool wants when every touch is meant to be a drawing action.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false })
}

createApp(App).use(router).mount('#app')
