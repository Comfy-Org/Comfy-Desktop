import { describe, expect, it } from 'vitest'

import { restartLoadAbandoned, type RestartLoadTarget } from './restartLoad'

function target(installationId: string | null, destroyed = false): RestartLoadTarget {
  return { window: { isDestroyed: () => destroyed }, installationId }
}

describe('restartLoadAbandoned', () => {
  it('loads when the window still holds the restarting install and the relaunch is its own', () => {
    expect(restartLoadAbandoned(target('inst-A'), 'inst-A', { token: 3 }, 3)).toBe(false)
  })

  it('loads when no relaunch state was recorded and the window still holds the install', () => {
    expect(restartLoadAbandoned(target('inst-A'), 'inst-A', undefined, undefined)).toBe(false)
  })

  it('abandons after Return to Dashboard detached the install and dropped its relaunch', () => {
    expect(restartLoadAbandoned(target(null), 'inst-A', undefined, 3)).toBe(true)
  })

  it('abandons when the window now holds a different install', () => {
    expect(restartLoadAbandoned(target('inst-B'), 'inst-A', undefined, 3)).toBe(true)
  })

  it('abandons when a newer relaunch replaced this one', () => {
    expect(restartLoadAbandoned(target('inst-A'), 'inst-A', { token: 4 }, 3)).toBe(true)
  })

  it('abandons when the window was destroyed', () => {
    expect(restartLoadAbandoned(target('inst-A', true), 'inst-A', { token: 3 }, 3)).toBe(true)
  })
})
