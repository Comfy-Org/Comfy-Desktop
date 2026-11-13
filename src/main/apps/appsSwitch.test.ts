import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as AppsSwitch from './appsSwitch'

const electron = vi.hoisted(() => ({ app: { isPackaged: true } }))
vi.mock('electron', () => electron)

const getOpsFlagResult = vi.fn()
vi.mock('../lib/telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

let testConfigDir = ''
vi.mock('../lib/paths', () => ({
  configDir: () => testConfigDir
}))

async function load(packaged: boolean): Promise<typeof AppsSwitch> {
  electron.app.isPackaged = packaged
  vi.resetModules()
  return import('./appsSwitch')
}

const answer = (value: unknown) => ({ kind: 'value', value, payload: undefined })
const unreachable = { kind: 'unreachable' }
const settle = () => new Promise((resolve) => setImmediate(resolve))

function storedAnswer(): unknown {
  const file = path.join(testConfigDir, 'ops-flags.json')
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { value?: unknown }>)[
    'desktop_apps_enabled'
  ]?.value
}

beforeEach(() => {
  getOpsFlagResult.mockReset()
  testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apps-switch-'))
})

afterEach(() => {
  fs.rmSync(testConfigDir, { recursive: true, force: true })
})

describe('appsSwitch', () => {
  it('reads the desktop_apps_enabled flag for this installation', async () => {
    const s = await load(true)
    getOpsFlagResult.mockResolvedValue(answer(true))
    await s.initAppsSwitch({ distinctId: 'install-1' })

    expect(s.APPS_SWITCH_FLAG_KEY).toBe('desktop_apps_enabled')
    expect(getOpsFlagResult).toHaveBeenCalledWith(
      'desktop_apps_enabled',
      'install-1',
      expect.any(Number),
      expect.any(Function)
    )
  })

  it.each([
    [true, true],
    ['on', true],
    [false, false],
    ['off', false]
  ])('turns Apps %s → %s', async (value, on) => {
    const s = await load(true)
    getOpsFlagResult.mockResolvedValue(answer(value))
    await s.initAppsSwitch({ distinctId: 'anon' })

    expect(await s.getAppsEnabledAsync()).toBe(on)
    expect(s.isAppsEnabled()).toBe(on)
  })

  it('keeps Apps off in a released build when PostHog has no answer', async () => {
    const s = await load(true)
    getOpsFlagResult.mockResolvedValue(unreachable)
    await s.initAppsSwitch({ distinctId: 'anon' })

    expect(await s.getAppsEnabledAsync()).toBe(false)
    expect(s.isAppsEnabled()).toBe(false)
  })

  it('keeps Apps off in a released build for an answer it does not know', async () => {
    const s = await load(true)
    getOpsFlagResult.mockResolvedValue(answer('maybe'))
    await s.initAppsSwitch({ distinctId: 'anon' })

    expect(await s.getAppsEnabledAsync()).toBe(false)
  })

  it('shows Apps in a dev build when PostHog has no answer', async () => {
    const s = await load(false)
    getOpsFlagResult.mockResolvedValue(unreachable)
    await s.initAppsSwitch({ distinctId: 'anon' })

    expect(await s.getAppsEnabledAsync()).toBe(true)
    expect(s.isAppsEnabled()).toBe(true)
  })

  it('is off before start-up in a released build that never had an answer', async () => {
    const s = await load(true)

    expect(s.isAppsEnabled()).toBe(false)
  })

  it('keeps a stored on through a start with no network', async () => {
    const first = await load(true)
    getOpsFlagResult.mockResolvedValue(answer(true))
    await first.initAppsSwitch({ distinctId: 'anon' })
    await settle()
    expect(storedAnswer()).toBe(true)

    const offline = await load(true)
    expect(offline.isAppsEnabled()).toBe(true)
    getOpsFlagResult.mockResolvedValue(unreachable)
    await offline.initAppsSwitch({ distinctId: 'anon' })
    await settle()

    expect(await offline.getAppsEnabledAsync()).toBe(true)
    expect(offline.isAppsEnabled()).toBe(true)
  })

  it('tells listeners only when a remote answer changes the switch', async () => {
    const first = await load(true)
    getOpsFlagResult.mockResolvedValue(answer(true))
    await first.initAppsSwitch({ distinctId: 'anon' })
    await settle()

    const same = await load(true)
    const heardSame = vi.fn()
    same.onAppsEnabledChanged(heardSame)
    await same.initAppsSwitch({ distinctId: 'anon' })
    await settle()
    expect(heardSame).not.toHaveBeenCalled()

    const changed = await load(true)
    const heardChange = vi.fn()
    changed.onAppsEnabledChanged(heardChange)
    getOpsFlagResult.mockResolvedValue(answer(false))
    await changed.initAppsSwitch({ distinctId: 'anon' })
    await settle()
    expect(heardChange.mock.calls).toEqual([[false]])
  })

  it('turns Apps off when PostHog switches it off after a stored on', async () => {
    const first = await load(true)
    getOpsFlagResult.mockResolvedValue(answer(true))
    await first.initAppsSwitch({ distinctId: 'anon' })
    await settle()

    const next = await load(true)
    getOpsFlagResult.mockResolvedValue(answer(false))
    await next.initAppsSwitch({ distinctId: 'anon' })
    await settle()

    expect(next.isAppsEnabled()).toBe(false)
    expect(storedAnswer()).toBe(false)
  })
})
