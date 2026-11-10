import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Four workers finish the suite as fast as eight (about 75 s) while each file runs 2x faster: the jsdom admin files
      // are CPU-bound, and with more workers than the machine can serve they time out under load (H12).
      maxWorkers: 4,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      // index.css is read as source text by theme.test.ts (`?raw`). Vitest otherwise stubs CSS as empty.
      css: { include: [/src\/index\.css/] },
      include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/_shared/**/*.test.ts'],
      // Dummy values so modules importing lib/supabase.ts load. Tests must mock network calls.
      env: {
        VITE_SUPABASE_URL: 'http://localhost:54321',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
        // Unset: a developer's .env default venue must not leak into the VenueProvider tests.
        VITE_DEFAULT_VENUE: '',
      },
    },
  }),
)
