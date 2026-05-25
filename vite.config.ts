import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/jfk-first-90-days/',
  build: {
    chunkSizeWarningLimit: 1400,
  },
  plugins: [react()],
})
