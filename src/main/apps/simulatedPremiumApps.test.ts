import { describe, expect, it } from 'vitest'

import { isSimulatedPremiumApp } from './simulatedPremiumApps'

describe('the simulated premium apps', () => {
  it.each(['product-swap', 'product-ads'])(
    'mark %s as premium, since it runs partner nodes even on this computer',
    (id) => {
      expect(isSimulatedPremiumApp(id)).toBe(true)
    }
  )

  it.each([
    'genjutsu',
    'remove-background',
    'sdr-to-hdr',
    'extend-picture',
    'an-app-nobody-listed'
  ])('leave %s free, since it runs locally by default', (id) => {
    expect(isSimulatedPremiumApp(id)).toBe(false)
  })
})
