import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // Vendor code every page needs goes in its own long-lived chunks (T8.7). It keeps each chunk under the
        // 500 kB warning and stays cached across deploys, since vendor code rarely changes. The admin pages stay
        // lazy chunks of their own (CLAUDE.md).
        codeSplitting: {
          groups: [
            { name: 'vendor-supabase', test: /node_modules[\\/]@supabase[\\/]/, priority: 20 },
            {
              name: 'vendor-react',
              test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|@tanstack)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
})
