import { describe, expect, it } from 'vitest'
import { readRolloutFlags } from './rolloutFlags'

describe('readRolloutFlags', () => {
  it('reads the flags main put in the URL query', () => {
    expect(readRolloutFlags('?installationId=&newDashboard=true&breadcrumb=true')).toEqual({
      newDashboard: true,
      breadcrumb: true
    })
  })

  it('treats a missing or malformed flag as off', () => {
    expect(readRolloutFlags('?newDashboard=1')).toEqual({ newDashboard: false, breadcrumb: false })
    expect(readRolloutFlags('')).toEqual({ newDashboard: false, breadcrumb: false })
  })
})
