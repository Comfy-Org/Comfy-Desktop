import { describe, expect, it } from 'vitest'

import { isTemporaryLaunchApp } from './temporaryLaunchApps'

describe('isTemporaryLaunchApp (remove once the catalog hides the apps that are not launching)', () => {
  it('keeps the five launch apps', () => {
    for (const slug of [
      'genjutsu',
      'product-ads',
      'sdr-to-hdr',
      'remove-background',
      'extend-picture'
    ])
      expect(isTemporaryLaunchApp(slug)).toBe(true)
  })

  it('hides every other app', () => {
    for (const slug of ['upscale', 'rotoscope', 'make-song', 'new-app', '', undefined])
      expect(isTemporaryLaunchApp(slug)).toBe(false)
  })
})
