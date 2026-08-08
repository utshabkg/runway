import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // The engine is pure. There is nothing to mount, so there is no DOM env.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
