import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'

// The real deviceId module runs against a temp config dir; only the hardware
// lookup and the modules boot hands the id to are stubbed.
let testUserData = ''

vi.mock('./paths', () => ({
  configDir: () => testUserData
}))

vi.mock('electron', () => ({
  app: { getPath: () => testUserData, isPackaged: false, on: () => {} }
}))

const UUID = 'aabbccdd-eeff-0011-2233-445566778899'
let lookupHangs = false
let lookupDelayMs = 0

vi.mock('systeminformation', () => ({
  default: {
    uuid: async () => {
      if (lookupHangs) return new Promise<never>(() => {})
      if (lookupDelayMs > 0) await new Promise((r) => setTimeout(r, lookupDelayMs))
      return { os: '', hardware: UUID, macs: [] }
    },
    system: async () => ({ uuid: UUID })
  }
}))

const h = vi.hoisted(() => ({
  telemetry: {
    holdUntilBound: vi.fn(),
    bindAnonymousId: vi.fn(),
    registerPersonProperties: vi.fn(),
    captureFirstLaunch: vi.fn()
  },
  initExperiments: vi.fn((_opts: unknown) => Promise.resolve()),
  initCloudFreeRuns: vi.fn((_opts: { distinctId: Promise<string | null> }) => Promise.resolve()),
  initCoreBetaGrants: vi.fn((_opts: { distinctId: Promise<string | null> }) => Promise.resolve()),
  initStaffFlagTargeting: vi.fn(),
  getInitialAnonymousDistinctId: vi.fn((_existing: boolean) => 'anon-d'),
  recoverPendingIdentityRotation: vi.fn((id: string) => id)
}))

vi.mock('./telemetry', () => h.telemetry)
vi.mock('./experiments', () => ({ initExperiments: h.initExperiments }))
vi.mock('./cloudFreeRuns', () => ({ initCloudFreeRuns: h.initCloudFreeRuns }))
vi.mock('./coreBetaGrants', () => ({ initCoreBetaGrants: h.initCoreBetaGrants }))
vi.mock('./staffFlagTargeting', () => ({ initStaffFlagTargeting: h.initStaffFlagTargeting }))
vi.mock('./websiteAnonymousIdentity', () => ({
  getInitialAnonymousDistinctId: h.getInitialAnonymousDistinctId
}))
vi.mock('./pendingIdentityMerge', () => ({
  recoverPendingIdentityRotation: h.recoverPendingIdentityRotation
}))

import type * as BootIdentityModule from './bootIdentity'

const CUTOFF_MS = 15_000
const originalPlatform = process.platform

function machineId(): string {
  return createHash('sha256').update(`${UUID}:comfy-installation-id-v1`).digest('hex')
}

function file(name: string): string {
  return path.join(testUserData, name)
}

const OPTIONS = { appVersion: '9.9.9', locale: 'en', trackedSettings: () => ({ theme: 'dark' }) }

describe('startBootIdentity', () => {
  let mod: typeof BootIdentityModule

  beforeEach(async () => {
    testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-identity-'))
    lookupHangs = false
    lookupDelayMs = 0
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.resetModules()
    mod = await import('./bootIdentity')
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    fs.rmSync(testUserData, { recursive: true, force: true })
  })

  it('returns before the id resolves, with every consumer already waiting on it', async () => {
    lookupHangs = true
    let bound = false
    void mod.startBootIdentity(OPTIONS).then(() => {
      bound = true
    })

    expect(h.telemetry.holdUntilBound).toHaveBeenCalledTimes(1)
    expect(h.initExperiments).toHaveBeenCalledTimes(1)
    expect(h.initCloudFreeRuns).toHaveBeenCalledTimes(1)
    expect(h.initCoreBetaGrants).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(CUTOFF_MS - 1)
    expect(bound).toBe(false)
    expect(h.telemetry.bindAnonymousId).not.toHaveBeenCalled()
  })

  it('binds the stored staff classification before either ops flag is initialised', () => {
    lookupHangs = true
    void mod.startBootIdentity(OPTIONS)
    const staff = h.initStaffFlagTargeting.mock.invocationCallOrder[0]!
    expect(staff).toBeLessThan(h.initCloudFreeRuns.mock.invocationCallOrder[0]!)
    expect(staff).toBeLessThan(h.initCoreBetaGrants.mock.invocationCallOrder[0]!)
  })

  it('persists nothing while the lookup is pending, and quitting then leaves no trace', async () => {
    lookupHangs = true
    void mod.startBootIdentity(OPTIONS)
    await vi.advanceTimersByTimeAsync(CUTOFF_MS - 1)
    expect(fs.existsSync(file('device-id.txt'))).toBe(false)
    expect(fs.existsSync(file('first-launch-completed'))).toBe(false)
    expect(h.telemetry.captureFirstLaunch).not.toHaveBeenCalled()
  })

  it('binds the resolved id and fires first_launch once it resolves', async () => {
    lookupDelayMs = 3000
    const bound = mod.startBootIdentity(OPTIONS)
    await vi.advanceTimersByTimeAsync(3000)
    await bound

    expect(h.telemetry.bindAnonymousId).toHaveBeenCalledWith('anon-d', machineId(), {
      app_version: '9.9.9',
      platform: 'win32',
      arch: process.arch,
      id_class: 'machine_derived'
    })
    expect(h.telemetry.registerPersonProperties).toHaveBeenCalledWith({ theme: 'dark' })
    expect(h.telemetry.captureFirstLaunch).toHaveBeenCalledWith({
      id_class: 'machine_derived',
      id_lookup_ms: 3000,
      id_lookup_timed_out: false,
      boot_to_id_ms: expect.any(Number),
      locale: 'en'
    })
    expect(fs.readFileSync(file('device-id.txt'), 'utf-8')).toBe(machineId())
    expect(fs.existsSync(file('first-launch-completed'))).toBe(true)
  })

  it('mints and persists a random id once, at the cutoff, when the lookup never answers', async () => {
    lookupHangs = true
    const bound = mod.startBootIdentity(OPTIONS)
    await vi.advanceTimersByTimeAsync(CUTOFF_MS)
    await bound

    const id = fs.readFileSync(file('device-id.txt'), 'utf-8')
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(h.telemetry.bindAnonymousId).toHaveBeenCalledWith(
      'anon-d',
      id,
      expect.objectContaining({ id_class: 'random_fallback' })
    )
    expect(h.telemetry.captureFirstLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ id_lookup_ms: null, id_lookup_timed_out: true })
    )
  })

  it('does not fire first_launch on a later launch', async () => {
    fs.writeFileSync(file('first-launch-completed'), 'x')
    fs.writeFileSync(file('device-id.txt'), machineId())
    await mod.startBootIdentity(OPTIONS)
    expect(h.telemetry.captureFirstLaunch).not.toHaveBeenCalled()
  })

  it.each([
    ['a fresh install', false, []],
    ['an install with a stored id', true, ['device-id.txt']],
    ['an install past its first launch', true, ['first-launch-completed']]
  ])('reads %s as existing=%s before anything is written', async (_label, existing, files) => {
    for (const name of files) fs.writeFileSync(file(name), machineId())
    await mod.startBootIdentity(OPTIONS)
    expect(h.getInitialAnonymousDistinctId).toHaveBeenCalledWith(existing)
  })

  it('hands the ops flags the id when it resolves within 2 s', async () => {
    lookupDelayMs = 1500
    void mod.startBootIdentity(OPTIONS)
    const cloud = h.initCloudFreeRuns.mock.calls[0]![0].distinctId
    const grants = h.initCoreBetaGrants.mock.calls[0]![0].distinctId
    await vi.advanceTimersByTimeAsync(1500)
    expect(await cloud).toBe(machineId())
    expect(await grants).toBe(machineId())
  })

  it('hands the ops flags null, never a provisional id, when the id takes longer than 2 s', async () => {
    lookupDelayMs = 3000
    void mod.startBootIdentity(OPTIONS)
    const cloud = h.initCloudFreeRuns.mock.calls[0]![0].distinctId
    await vi.advanceTimersByTimeAsync(2000)
    expect(await cloud).toBeNull()
    expect(fs.existsSync(file('device-id.txt'))).toBe(false)
  })

  it('hands experiments the resolved id and its class', async () => {
    lookupDelayMs = 4000
    void mod.startBootIdentity(OPTIONS)
    const identity = h.initExperiments.mock.calls[0]![0] as Promise<unknown>
    await vi.advanceTimersByTimeAsync(4000)
    expect(await identity).toEqual({
      distinctId: machineId(),
      personProperties: {
        platform: 'win32',
        arch: process.arch,
        app_version: '9.9.9',
        id_class: 'machine_derived'
      }
    })
  })

  it('completes the legacy-id migration once the id resolves', async () => {
    fs.writeFileSync(file('device-id.txt'), 'f47ac10b-58cc-4372-a567-0e02b2c3d479')
    await mod.startBootIdentity(OPTIONS)
    expect(fs.existsSync(file('identity-migration-completed'))).toBe(true)
    expect(fs.readFileSync(file('device-id.txt'), 'utf-8')).toBe(machineId())
  })
})
