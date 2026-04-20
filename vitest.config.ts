import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'tests/e2e/**', 'tests/quarantine/**'],
    // Fail fast for long-running locally-run iterations; CI overrides via `-- --reporter verbose`
    bail: 0,
    testTimeout: 15_000,
    hookTimeout: 30_000,
    // Per-file isolation — each test file gets its own worker so a leaked
    // DB handle or mocked module doesn't cross-contaminate.
    isolate: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/**', 'app/**'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', 'tests/**'],
    },
  },
})
