import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

// Kept apart from vite.config.ts so the PWA plugin stays out of test runs.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
