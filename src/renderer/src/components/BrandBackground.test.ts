import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// happy-dom can't compute layout, so parse the .vue `<style>` directly.
//
// Regression: the install wizard's Configure step turns on `scrollContent`
// (overflow-y: auto) and the Template step turns it off. With the base rule at
// `overflow: hidden` the frame stayed a scroll container, so a Configure step
// scrolled to its Continue button left the Template step shifted up with no way
// to scroll back (the absolutely positioned light beams give the frame a scroll
// range taller than the screen). `overflow: clip` makes the frame a
// non-scrolling box, so the leftover offset is dropped and nothing (wheel,
// focus, scrollIntoView) can scroll it.

// Resolved against cwd (not import.meta.url, which happy-dom can mangle).
const vueSource = readFileSync(
  path.resolve('src/renderer/src/components/BrandBackground.vue'),
  'utf8'
)

function extractRule(selector: string): string {
  // Anchor on a line start so we match the base rule, not a descendant override.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = vueSource.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`CSS rule for "${selector}" not found in BrandBackground.vue`)
  return match[1]
}

describe('BrandBackground — frame scrolling', () => {
  it('clips the frame instead of hiding overflow, so a non-scrolling step cannot keep a stale scroll offset', () => {
    const body = extractRule('.brand-inner-frame')
    expect(body).toMatch(/(?:^|\n)\s*overflow:\s*clip;/)
    expect(body).not.toMatch(/overflow(?:-y)?:\s*hidden/)
  })

  it('still lets steps that opt in scroll vertically', () => {
    expect(extractRule('.brand-inner-frame--scroll-content')).toMatch(/overflow-y:\s*auto/)
  })
})
