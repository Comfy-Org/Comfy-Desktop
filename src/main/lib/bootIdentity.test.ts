import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'

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
  consent: 'granted' as 'granted' | 'undecided' | 'denied',
  shutDown: false,
  denials: 0,
  telemetry: {
    bindAnonymousId: vi.fn(),
    setInstallationId: vi.fn(),
    registerPersonProperties: vi.fn(),
    captureFirstLaunch: vi.fn(),
    getConsentState: vi.fn(() => h.consent),
    hasShutDown: vi.fn(() => h.shutDown),
    getConsentDenials: vi.fn(() => h.denials)
  },
  initExperiments: vi.fn((_opts: unknown) => Promise.resolve()),
  initCloudFreeRuns: vi.fn((_opts: { distinctId: Promise<string> }) => Promise.resolve()),
  initCoreBetaGrants: vi.fn((_opts: { distinctId: Promise<string> }) => Promise.resolve()),
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
    h.consent = 'granted'
    h.shutDown = false
    h.denials = 0
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

    expect(h.telemetry.bindAnonymousId).toHaveBeenCalledWith('anon-d', null)
    expect(h.initExperiments).toHaveBeenCalledTimes(1)
    expect(h.initCloudFreeRuns).toHaveBeenCalledTimes(1)
    expect(h.initCoreBetaGrants).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(CUTOFF_MS - 1)
    expect(bound).toBe(false)
    expect(h.telemetry.setInstallationId).not.toHaveBeenCalled()
  })

  it('binds the anonymous id before anything else can capture', () => {
    lookupHangs = true
    void mod.startBootIdentity(OPTIONS)
    const bind = h.telemetry.bindAnonymousId.mock.invocationCallOrder[0]!
    expect(bind).toBeLessThan(h.initExperiments.mock.invocationCallOrder[0]!)
    expect(bind).toBeLessThan(h.initStaffFlagTargeting.mock.invocationCallOrder[0]!)
  })

  it('binds the stored staff classification before either ops flag is initialised', () => {
    lookupHangs = true
    void mod.startBootIdentity(OPTIONS)
    const staff = h.initStaffFlagTargeting.mock.invocationCallOrder[0]!
    expect(staff).toBeLessThan(h.initCloudFreeRuns.mock.invocationCallOrder[0]!)
    expect(staff).toBeLessThan(h.initCoreBetaGrants.mock.invocationCallOrder[0]!)
  })

  it('persists nothing and fires no first_launch while the lookup is pending', async () => {
    lookupHangs = true
    void mod.startBootIdentity(OPTIONS)
    await vi.advanceTimersByTimeAsync(CUTOFF_MS - 1)
    expect(fs.existsSync(file('device-id.txt'))).toBe(false)
    expect(fs.existsSync(file('first-launch-completed'))).toBe(false)
    expect(h.telemetry.captureFirstLaunch).not.toHaveBeenCalled()
  })

  it('binds the resolved id and fires first_launch once it resolves', async () => {
    lookupDelayMs = 3000
    const launchedAt = Date.now()
    const bound = mod.startBootIdentity(OPTIONS)
    await vi.advanceTimersByTimeAsync(3000)
    await bound

    expect(h.telemetry.setInstallationId).toHaveBeenCalledWith(machineId(), {
      app_version: '9.9.9',
      platform: 'win32',
      arch: process.arch,
      id_class: 'machine_derived'
    })
    expect(h.telemetry.registerPersonProperties).toHaveBeenCalledWith({ theme: 'dark' })
    expect(h.telemetry.captureFirstLaunch).toHaveBeenCalledWith(
      {
        id_class: 'machine_derived',
        id_lookup_ms: 3000,
        id_lookup_timed_out: false,
        boot_to_id_ms: expect.any(Number),
        locale: 'en'
      },
      new Date(launchedAt)
    )
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
    expect(h.telemetry.setInstallationId).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ id_class: 'random_fallback' })
    )
    expect(h.telemetry.captureFirstLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ id_lookup_ms: null, id_lookup_timed_out: true }),
      expect.any(Date)
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

  it.each([
    ['a fresh install', null],
    ['an install with a stored id', 'stored']
  ])('hands both ops flags only the final id, however long it takes, on %s', async (_l, stored) => {
    if (stored) fs.writeFileSync(file('device-id.txt'), machineId())
    lookupDelayMs = 14_000
    void mod.startBootIdentity(OPTIONS)
    const cloud = h.initCloudFreeRuns.mock.calls[0]![0].distinctId
    expect(h.initCoreBetaGrants.mock.calls[0]![0].distinctId).toBe(cloud)
    let early: string | null = null
    void cloud.then((id) => {
      early = id
    })
    await vi.advanceTimersByTimeAsync(13_999)
    expect(early).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(await cloud).toBe(machineId())
  })

  it('leaves the first-launch guard for the next launch when the id resolves after telemetry shut down', async () => {
    lookupDelayMs = 3000
    const bound = mod.startBootIdentity(OPTIONS)
    h.shutDown = true
    await vi.advanceTimersByTimeAsync(3000)
    await bound
    expect(h.telemetry.captureFirstLaunch).not.toHaveBeenCalled()
    expect(h.telemetry.setInstallationId).not.toHaveBeenCalled()
    expect(h.telemetry.registerPersonProperties).not.toHaveBeenCalled()
    expect(fs.existsSync(file('first-launch-completed'))).toBe(false)
    expect(fs.readFileSync(file('device-id.txt'), 'utf-8')).toBe(machineId())
  })

  it('drops first_launch, as a launch-time one would be, when consent is denied during the wait', async () => {
    lookupDelayMs = 3000
    const bound = mod.startBootIdentity(OPTIONS)
    h.denials = 1
    await vi.advanceTimersByTimeAsync(3000)
    await bound
    expect(h.telemetry.captureFirstLaunch).not.toHaveBeenCalled()
    expect(fs.existsSync(file('first-launch-completed'))).toBe(true)
  })

  it('keeps first_launch for a launch whose consent was denied before it started', async () => {
    h.denials = 1
    lookupDelayMs = 3000
    const bound = mod.startBootIdentity(OPTIONS)
    await vi.advanceTimersByTimeAsync(3000)
    await bound
    expect(h.telemetry.captureFirstLaunch).toHaveBeenCalledTimes(1)
  })

  it('removes the legacy alias retry marker once the id resolves', async () => {
    fs.writeFileSync(file('pending-identity-alias.txt'), 'legacy')
    await mod.startBootIdentity(OPTIONS)
    expect(fs.existsSync(file('pending-identity-alias.txt'))).toBe(false)
  })

  it('skips the experiments fetch, without waiting for the id, when consent is not granted', () => {
    h.consent = 'undecided'
    lookupHangs = true
    void mod.startBootIdentity(OPTIONS)
    expect(h.initExperiments).toHaveBeenCalledWith(null)
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
