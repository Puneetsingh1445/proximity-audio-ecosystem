import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Pin the dev server to a fixed port so the backend CORS list never drifts.
    // If 5173 is already in use, Vite will exit with an error rather than
    // silently picking 5174, 5175, 5176, 5177, … and breaking CORS.
    port: 5173,
    strictPort: true,
  },
})
