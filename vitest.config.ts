import { defineConfig } from 'vitest/config'

// Storybook's Run tests button loads this file for its project. `pnpm test` loads only the unit config.
export default defineConfig({
  test: {
    projects: ['./vitest.unit.config.ts', './vitest.storybook.config.ts'],
    // Vitest reads `sequence.hooks` only from the root config, so repeat the unit project's value.
    sequence: { hooks: 'list' }
  }
})
