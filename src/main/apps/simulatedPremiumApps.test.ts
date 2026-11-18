import { describe, expect, it } from 'vitest'

import { isSimulatedPremiumApp } from './simulatedPremiumApps'

describe('the simulated premium apps', () => {
  it.each(['genjutsu', 'product-swap', 'product-ads', 'remove-background'])(
    'mark %s as premium, since it runs partner nodes',
    (id) => {
      expect(isSimulatedPremiumApp(id)).toBe(true)
    }
  )

  it.each(['sdr-to-hdr', 'extend-picture', 'an-app-nobody-listed'])('leave %s free', (id) => {
    expect(isSimulatedPremiumApp(id)).toBe(false)
  })
})
