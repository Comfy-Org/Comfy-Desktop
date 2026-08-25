import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { include: ['scripts/starter-templates.spec.mjs'], testTimeout: 60_000, hookTimeout: 60_000 }
})
