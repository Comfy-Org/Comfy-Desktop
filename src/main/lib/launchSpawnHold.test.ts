import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  armLaunchSpawnHold,
  isLaunchSpawnHeld,
  releaseLaunchSpawnHold,
  waitLaunchSpawnHold,
} from './e2eOverrides'

/** Resolves true if `p` settles within `ms`, false otherwise. */
function settlesWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    p.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), ms)),
  ])
}

const savedE2E = process.env['E2E']

beforeEach(() => {
  process.env['E2E'] = '1'
})

afterEach(() => {
  // Disarm + release anything a failed assertion left behind.
  releaseLaunchSpawnHold()
  if (savedE2E === undefined) delete process.env['E2E']
  else process.env['E2E'] = savedE2E
  expect(isLaunchSpawnHeld()).toBe(false)
})

describe('waitLaunchSpawnHold', () => {
  it('is a no-op when not armed', async () => {
    const abort = new AbortController()
    await expect(settlesWithin(waitLaunchSpawnHold(abort.signal), 50)).resolves.toBe(true)
    expect(isLaunchSpawnHeld()).toBe(false)
  })

  it('is a no-op outside E2E even when armed', async () => {
    process.env['E2E'] = '0'
    armLaunchSpawnHold()
    const abort = new AbortController()
    await expect(settlesWithin(waitLaunchSpawnHold(abort.signal), 50)).resolves.toBe(true)
    expect(isLaunchSpawnHeld()).toBe(false)
    releaseLaunchSpawnHold() // disarm for the next test
  })

  it('parks an armed launch until explicitly released', async () => {
    armLaunchSpawnHold()
    const abort = new AbortController()
    const held = waitLaunchSpawnHold(abort.signal)
    await expect(settlesWithin(held, 50)).resolves.toBe(false)
    expect(isLaunchSpawnHeld()).toBe(true)

    releaseLaunchSpawnHold()
    await held // deterministic: the release guarantees resolution
    expect(isLaunchSpawnHeld()).toBe(false)
  })

  it('releases a parked launch when its abort signal fires (the restart path)', async () => {
    armLaunchSpawnHold()
    const abort = new AbortController()
    const held = waitLaunchSpawnHold(abort.signal)
    await expect(settlesWithin(held, 50)).resolves.toBe(false)

    abort.abort()
    await held // deterministic: the abort guarantees resolution
    expect(isLaunchSpawnHeld()).toBe(false)
  })

  it('resolves immediately when the signal is already aborted at entry', async () => {
    armLaunchSpawnHold()
    const abort = new AbortController()
    abort.abort()
    await expect(settlesWithin(waitLaunchSpawnHold(abort.signal), 50)).resolves.toBe(true)
    expect(isLaunchSpawnHeld()).toBe(false)
  })

  it('is one-shot: only the first launch after arming parks', async () => {
    armLaunchSpawnHold()
    const first = new AbortController()
    const held = waitLaunchSpawnHold(first.signal)
    await expect(settlesWithin(held, 50)).resolves.toBe(false)

    // A second launch entering while the first is parked must NOT park.
    const second = new AbortController()
    await expect(settlesWithin(waitLaunchSpawnHold(second.signal), 50)).resolves.toBe(true)

    releaseLaunchSpawnHold()
    await held // deterministic: the release guarantees resolution
  })

  it('re-arming while a launch is parked throws instead of orphaning the waiter', async () => {
    armLaunchSpawnHold()
    const abort = new AbortController()
    const held = waitLaunchSpawnHold(abort.signal)
    await expect(settlesWithin(held, 50)).resolves.toBe(false)

    expect(() => armLaunchSpawnHold()).toThrow(/already parked/)

    releaseLaunchSpawnHold()
    await held // deterministic: the release guarantees resolution
  })

  it('release before any launch consumes the hold just disarms it', async () => {
    armLaunchSpawnHold()
    releaseLaunchSpawnHold()
    const abort = new AbortController()
    await expect(settlesWithin(waitLaunchSpawnHold(abort.signal), 50)).resolves.toBe(true)
  })
})
