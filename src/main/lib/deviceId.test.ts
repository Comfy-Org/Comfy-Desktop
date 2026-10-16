import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'

// Mock paths.ts directly: configDir() reads XDG_CONFIG_HOME on Linux, bypassing
// the electron.app.getPath mock and breaking CI.
let testUserData = ''

vi.mock('./paths', () => ({
  configDir: () => testUserData
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testUserData,
    isPackaged: false,
    on: () => {}
  }
}))

let mockSystemUuid: string | undefined = 'aabbccdd-eeff-0011-2233-445566778899'
let mockSystemError: Error | null = null
// Held past the budget until `answerLateLookup()` (if ever).
let mockLookupHangs = false
let answerLateLookup: () => void = () => {}
const lookupCalls = { system: 0, uuid: 0 }

function mockLookup<T>(value: () => T): Promise<T> {
  if (mockLookupHangs) {
    return new Promise((resolve, reject) => {
      answerLateLookup = () => (mockSystemError ? reject(mockSystemError) : resolve(value()))
    })
  }
  return mockSystemError ? Promise.reject(mockSystemError) : Promise.resolve(value())
}

vi.mock('systeminformation', () => ({
  default: {
    system: () => {
      lookupCalls.system++
      return mockLookup(() => ({ uuid: mockSystemUuid }))
    },
    uuid: () => {
      lookupCalls.uuid++
      return mockLookup(() => ({ hardware: mockSystemUuid ?? '', os: 'os-guid', macs: [] }))
    }
  }
}))

const SALT = 'comfy-installation-id-v1'

const ETC_MACHINE_ID = '/etc/machine-id'
const DBUS_MACHINE_ID = '/var/lib/dbus/machine-id'
// Contents served for the Linux machine-id locations; absent key = no file.
let mockMachineIdFiles: Record<string, string> = {}
const originalPlatform = process.platform

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

function expectedIdFor(machineId: string): string {
  return createHash('sha256').update(`${machineId}:${SALT}`).digest('hex')
}

import type * as DeviceIdModule from './deviceId'

describe('deviceId', () => {
  let mod: typeof DeviceIdModule

  beforeEach(async () => {
    testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'deviceid-test-'))
    mockSystemUuid = 'aabbccdd-eeff-0011-2233-445566778899'
    mockSystemError = null
    mockLookupHangs = false
    answerLateLookup = () => {}
    lookupCalls.system = 0
    lookupCalls.uuid = 0
    mockMachineIdFiles = {}
    setPlatform('linux')
    const realReadFileSync = fs.readFileSync
    vi.spyOn(fs, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, options) => {
      if (file === ETC_MACHINE_ID || file === DBUS_MACHINE_ID) {
        const contents = mockMachineIdFiles[file]
        if (contents === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return contents
      }
      return realReadFileSync(file, options)
    }) as typeof fs.readFileSync)
    vi.resetModules()
    mod = await import('./deviceId')
    mod._resetForTest()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    setPlatform(originalPlatform)
    try {
      fs.rmSync(testUserData, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  describe('initDeviceId — fresh install (no existing file)', () => {
    it('detects existing app state before initialization creates the device file', () => {
      expect(mod.hasPersistedDeviceId()).toBe(false)

      fs.writeFileSync(path.join(testUserData, 'device-id.txt'), 'legacy-install-state')

      expect(mod.hasPersistedDeviceId()).toBe(true)
    })

    it('derives installation_id from machine_id and writes device-id.txt', async () => {
      const { legacyId } = await mod.initDeviceId()
      expect(legacyId).toBeNull()
      expect(mod.getIdClass()).toBe('machine_derived')

      const expected = expectedIdFor('aabbccdd-eeff-0011-2233-445566778899')
      expect(mod.getDeviceId()).toBe(expected)

      const onDisk = fs.readFileSync(path.join(testUserData, 'device-id.txt'), 'utf-8').trim()
      expect(onDisk).toBe(expected)
    })
  })

  describe('initDeviceId — existing file matches', () => {
    it('is idempotent: re-init returns the same id and no legacyId', async () => {
      const expected = expectedIdFor('aabbccdd-eeff-0011-2233-445566778899')
      fs.writeFileSync(path.join(testUserData, 'device-id.txt'), expected)

      const { legacyId } = await mod.initDeviceId()
      expect(legacyId).toBeNull()
      expect(mod.getDeviceId()).toBe(expected)
      expect(mod.getIdClass()).toBe('machine_derived')
    })
  })

  describe('initDeviceId — legacy random UUID present', () => {
    it('returns the legacy id for one-shot migration and overwrites with the new id', async () => {
      const legacyUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
      fs.writeFileSync(path.join(testUserData, 'device-id.txt'), legacyUuid)

      const { legacyId } = await mod.initDeviceId()
      expect(legacyId).toBe(legacyUuid)

      const expected = expectedIdFor('aabbccdd-eeff-0011-2233-445566778899')
      expect(mod.getDeviceId()).toBe(expected)
      const onDisk = fs.readFileSync(path.join(testUserData, 'device-id.txt'), 'utf-8').trim()
      expect(onDisk).toBe(expected)
    })

    it('does NOT re-fire the migration if the guard file is present', async () => {
      const legacyUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
      fs.writeFileSync(path.join(testUserData, 'device-id.txt'), legacyUuid)
      // Prior boot already completed the local identity-file migration.
      fs.writeFileSync(
        path.join(testUserData, 'identity-migration-completed'),
        new Date().toISOString()
      )

      const { legacyId } = await mod.initDeviceId()
      expect(legacyId).toBeNull()

      // The id still gets corrected (the guard only suppresses re-reporting).
      const expected = expectedIdFor('aabbccdd-eeff-0011-2233-445566778899')

      expect(mod.getDeviceId()).toBe(expected)
    })
  })

  describe('initDeviceId — existing file is a different hash', () => {
    it('updates silently with no legacyId (treats as salt rotation or cross-machine copy)', async () => {
      const otherHash = 'a'.repeat(64)
      fs.writeFileSync(path.join(testUserData, 'device-id.txt'), otherHash)

      const { legacyId } = await mod.initDeviceId()
      expect(legacyId).toBeNull()

      const expected = expectedIdFor('aabbccdd-eeff-0011-2233-445566778899')
      expect(mod.getDeviceId()).toBe(expected)
    })
  })

  describe('initDeviceId — machine_id derivation fails', () => {
    it('falls back to a random UUID with idClass=random_fallback', async () => {
      mockSystemUuid = undefined
      const { legacyId } = await mod.initDeviceId()
      expect(legacyId).toBeNull()
      expect(mod.getIdClass()).toBe('random_fallback')
      expect(mod.getDeviceId()).toMatch(/^[0-9a-f]{64}$/i)
    })
  })

  describe('initDeviceId — placeholder firmware UUID', () => {
    const PLACEHOLDERS = [
      ['all zeros', '00000000-0000-0000-0000-000000000000'],
      ['all F', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
      ['all F, uppercase', 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'],
      ['one repeated digit', '11111111-1111-1111-1111-111111111111'],
      ['F then zeros', 'ffffffff-ffff-0000-0000-000000000000'],
      ['sequential OEM', '03000200-0400-0500-0006-000700080009'],
      ['sequential OEM, byte-swapped', '00020003-0004-0005-0006-000700080009'],
      ['counting, uppercase', '12345678-1234-5678-90AB-CDDEEFAABBCC'],
      ['counting', '12345678-1234-5678-90ab-cddeefaabbcc'],
      ['hex run', '01234567-89ab-cdef-0123-456789abcdef']
    ]

    function deviceIdFile(): string {
      return path.join(testUserData, 'device-id.txt')
    }

    beforeEach(() => {
      setPlatform('win32')
    })

    it.each(PLACEHOLDERS)('treats %s as no machine id', async (_label, uuid) => {
      mockSystemUuid = uuid
      const { legacyId } = await mod.initDeviceId()
      expect(legacyId).toBeNull()
      expect(mod.getIdClass()).toBe('placeholder_fallback')
      const id = mod.getDeviceId()
      expect(id).toMatch(/^[0-9a-f]{64}$/)
      expect(id).not.toBe(expectedIdFor(uuid))
      expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(id)
    })

    it.each(PLACEHOLDERS)('moves an install off the shared %s id', async (_label, uuid) => {
      const shared = expectedIdFor(uuid)
      fs.writeFileSync(deviceIdFile(), shared)
      mockSystemUuid = uuid

      const { legacyId } = await mod.initDeviceId()
      expect(legacyId).toBeNull()
      const id = mod.getDeviceId()
      expect(id).toMatch(/^[0-9a-f]{64}$/)
      expect(id).not.toBe(shared)
      expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(id)
    })

    it('gives two machines with the same placeholder different ids', async () => {
      const uuid = '03000200-0400-0500-0006-000700080009'
      mockSystemUuid = uuid
      await mod.initDeviceId()
      const first = mod.getDeviceId()

      fs.rmSync(deviceIdFile())
      vi.resetModules()
      mod = await import('./deviceId')
      await mod.initDeviceId()
      expect(mod.getDeviceId()).not.toBe(first)
    })

    it('mints once, then keeps the id across launches', async () => {
      const uuid = '03000200-0400-0500-0006-000700080009'
      fs.writeFileSync(deviceIdFile(), expectedIdFor(uuid))
      mockSystemUuid = uuid
      await mod.initDeviceId()
      const minted = mod.getDeviceId()
      expect(minted).not.toBe(expectedIdFor(uuid))

      for (let boot = 0; boot < 3; boot++) {
        vi.resetModules()
        mod = await import('./deviceId')
        await mod.initDeviceId()
        expect(mod.getDeviceId()).toBe(minted)
        expect(mod.getIdClass()).toBe('placeholder_fallback')
      }
      expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(minted)
    })

    it.each([
      ['returns no UUID', () => (mockSystemUuid = undefined)],
      ['throws', () => (mockSystemError = new Error('WMI failed'))]
    ])('moves off a shared id when the lookup %s', async (_label, breakLookup) => {
      const shared = expectedIdFor('03000200-0400-0500-0006-000700080009')
      fs.writeFileSync(deviceIdFile(), shared)
      breakLookup()

      await mod.initDeviceId()
      expect(mod.getIdClass()).toBe('random_fallback')
      const minted = mod.getDeviceId()
      expect(minted).not.toBe(shared)

      vi.resetModules()
      mod = await import('./deviceId')
      await mod.initDeviceId()
      expect(mod.getDeviceId()).toBe(minted)
    })

    it('keeps a persisted unique id', async () => {
      const unique = 'c'.repeat(64)
      fs.writeFileSync(deviceIdFile(), unique)
      mockSystemUuid = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

      await mod.initDeviceId()
      expect(mod.getDeviceId()).toBe(unique)
      expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(unique)
    })

    it('keeps an id derived from a real UUID when a launch reports a placeholder', async () => {
      const machineDerived = expectedIdFor('aabbccdd-eeff-0011-2233-445566778899')
      fs.writeFileSync(deviceIdFile(), machineDerived)
      mockSystemUuid = '03000200-0400-0500-0006-000700080009'

      await mod.initDeviceId()
      expect(mod.getDeviceId()).toBe(machineDerived)
    })

    it('still migrates a legacy UUID', async () => {
      const legacyUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
      fs.writeFileSync(deviceIdFile(), legacyUuid)
      mockSystemUuid = '03000200-0400-0500-0006-000700080009'

      const { legacyId } = await mod.initDeviceId()
      expect(legacyId).toBe(legacyUuid)
      expect(mod.getDeviceId()).toMatch(/^[0-9a-f]{64}$/)
    })

    it('uses /etc/machine-id on Linux instead', async () => {
      setPlatform('linux')
      const machineId = '0123456789abcdef0123456789abcdef'
      mockMachineIdFiles = { [ETC_MACHINE_ID]: machineId }
      fs.writeFileSync(deviceIdFile(), expectedIdFor('03000200-0400-0500-0006-000700080009'))
      mockSystemUuid = '03000200-0400-0500-0006-000700080009'

      await mod.initDeviceId()
      expect(mod.getIdClass()).toBe('machine_derived')
      expect(mod.getDeviceId()).toBe(expectedIdFor(machineId))
    })

    it.each([
      'aabbccdd-eeff-0011-2233-445566778899',
      '4c4c4544-0042-3510-8052-b4c04f4e4332',
      'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    ])('leaves a real UUID (%s) machine-derived', async (uuid) => {
      mockSystemUuid = uuid
      await mod.initDeviceId()
      expect(mod.getIdClass()).toBe('machine_derived')
      expect(mod.getDeviceId()).toBe(expectedIdFor(uuid))
    })
  })

  describe('initDeviceId — no machine id, persisted id present', () => {
    function deviceIdFile(): string {
      return path.join(testUserData, 'device-id.txt')
    }

    it('keeps the persisted id across launches instead of rotating it', async () => {
      mockSystemUuid = ''
      await mod.initDeviceId()
      const first = mod.getDeviceId()
      expect(first).toMatch(/^[0-9a-f]{64}$/)
      expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(first)

      for (let boot = 0; boot < 3; boot++) {
        vi.resetModules()
        mod = await import('./deviceId')
        const { legacyId } = await mod.initDeviceId()
        expect(legacyId).toBeNull()
        expect(mod.getDeviceId()).toBe(first)
        expect(mod.getIdClass()).toBe('random_fallback')
      }
      expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(first)
    })

    it('keeps a machine-derived id when the hardware lookup fails on a later launch', async () => {
      const machineDerived = expectedIdFor('aabbccdd-eeff-0011-2233-445566778899')
      fs.writeFileSync(deviceIdFile(), machineDerived)
      setPlatform('win32')
      mockSystemUuid = undefined

      await mod.initDeviceId()
      expect(mod.getDeviceId()).toBe(machineDerived)
      expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(machineDerived)
    })

    it('replaces unrecognised content with a new random id', async () => {
      fs.writeFileSync(deviceIdFile(), 'not-an-installation-id')
      mockSystemUuid = ''

      await mod.initDeviceId()
      const id = mod.getDeviceId()
      expect(id).toMatch(/^[0-9a-f]{64}$/)
      expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(id)
    })

    it('still migrates a legacy UUID, then keeps the replacement', async () => {
      const legacyUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
      fs.writeFileSync(deviceIdFile(), legacyUuid)
      mockSystemUuid = ''

      const { legacyId } = await mod.initDeviceId()
      expect(legacyId).toBe(legacyUuid)
      const replacement = mod.getDeviceId()
      expect(replacement).toMatch(/^[0-9a-f]{64}$/)

      vi.resetModules()
      mod = await import('./deviceId')
      await mod.initDeviceId()
      expect(mod.getDeviceId()).toBe(replacement)
    })
  })

  describe('initDeviceId — Linux machine-id fallback', () => {
    const machineId = '0123456789abcdef0123456789abcdef'

    it('hashes /etc/machine-id when the SMBIOS UUID is unreadable', async () => {
      mockSystemUuid = ''
      mockMachineIdFiles = { [ETC_MACHINE_ID]: `${machineId}\n` }

      await mod.initDeviceId()
      expect(mod.getIdClass()).toBe('machine_derived')
      expect(mod.getDeviceId()).toBe(expectedIdFor(machineId))
      expect(mod.getDeviceId()).not.toContain(machineId)
    })

    it('is stable across launches', async () => {
      mockSystemUuid = ''
      mockMachineIdFiles = { [ETC_MACHINE_ID]: machineId }
      await mod.initDeviceId()
      const first = mod.getDeviceId()

      vi.resetModules()
      mod = await import('./deviceId')
      await mod.initDeviceId()
      expect(mod.getDeviceId()).toBe(first)
    })

    it('replaces a previously rotated random id with the machine-id hash', async () => {
      fs.writeFileSync(path.join(testUserData, 'device-id.txt'), 'b'.repeat(64))
      mockSystemUuid = ''
      mockMachineIdFiles = { [ETC_MACHINE_ID]: machineId }

      const { legacyId } = await mod.initDeviceId()
      expect(legacyId).toBeNull()
      expect(mod.getDeviceId()).toBe(expectedIdFor(machineId))
    })

    it('prefers the SMBIOS UUID when it is readable', async () => {
      mockMachineIdFiles = { [ETC_MACHINE_ID]: machineId }

      await mod.initDeviceId()
      expect(mod.getDeviceId()).toBe(expectedIdFor('aabbccdd-eeff-0011-2233-445566778899'))
    })

    it('falls back to the D-Bus machine-id when /etc/machine-id is absent', async () => {
      mockSystemUuid = ''
      mockMachineIdFiles = { [DBUS_MACHINE_ID]: machineId }

      await mod.initDeviceId()
      expect(mod.getDeviceId()).toBe(expectedIdFor(machineId))
    })

    it('prefers /etc/machine-id over the D-Bus copy', async () => {
      mockSystemUuid = ''
      mockMachineIdFiles = { [ETC_MACHINE_ID]: machineId, [DBUS_MACHINE_ID]: 'f'.repeat(32) }

      await mod.initDeviceId()
      expect(mod.getDeviceId()).toBe(expectedIdFor(machineId))
    })

    it('does not switch sources when the hardware lookup fails for one launch', async () => {
      const smbiosDerived = expectedIdFor('aabbccdd-eeff-0011-2233-445566778899')
      fs.writeFileSync(path.join(testUserData, 'device-id.txt'), smbiosDerived)
      mockSystemError = new Error('dmidecode failed')
      mockMachineIdFiles = { [ETC_MACHINE_ID]: machineId }

      await mod.initDeviceId()
      expect(mod.getDeviceId()).toBe(smbiosDerived)
    })

    it.each([
      ['empty', ''],
      ['uninitialized', 'uninitialized'],
      ['all zeros', '0'.repeat(32)]
    ])('ignores an %s machine-id', async (_label, contents) => {
      mockSystemUuid = ''
      mockMachineIdFiles = { [ETC_MACHINE_ID]: contents }

      await mod.initDeviceId()
      expect(mod.getIdClass()).toBe('random_fallback')
    })

    it.each<NodeJS.Platform>(['win32', 'darwin'])('is not consulted on %s', async (platform) => {
      setPlatform(platform)
      mockSystemUuid = undefined
      mockMachineIdFiles = { [ETC_MACHINE_ID]: machineId }

      await mod.initDeviceId()
      expect(mod.getIdClass()).toBe('random_fallback')
      expect(mod.getDeviceId()).not.toBe(expectedIdFor(machineId))
    })
  })

  describe('initDeviceId — concurrent calls', () => {
    it('returns the same promise for concurrent callers', async () => {
      const a = mod.initDeviceId()
      const b = mod.initDeviceId()
      expect(a).toBe(b)
      const [resA, resB] = await Promise.all([a, b])
      expect(resA).toEqual(resB)
    })
  })

  describe('markIdentityMigrationCompleted', () => {
    it('writes the guard file', async () => {
      await mod.initDeviceId()
      mod.markIdentityMigrationCompleted()
      expect(fs.existsSync(path.join(testUserData, 'identity-migration-completed'))).toBe(true)
    })
  })

  describe('getDeviceId — degraded path (called before initDeviceId)', () => {
    it('reads on-disk id and flags it as random_fallback', () => {
      const seeded = 'seeded-id-value'
      fs.writeFileSync(path.join(testUserData, 'device-id.txt'), seeded)
      const id = mod.getDeviceId()
      expect(id).toBe(seeded)
      expect(mod.getIdClass()).toBe('random_fallback')
    })

    it('produces a random UUID when no file exists and flags it as random_fallback', () => {
      const id = mod.getDeviceId()
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      expect(mod.getIdClass()).toBe('random_fallback')
    })

    it('does not persist the random UUID, so the next launch derives the real id', async () => {
      mod.getDeviceId()
      expect(fs.existsSync(path.join(testUserData, 'device-id.txt'))).toBe(false)

      vi.resetModules()
      mod = await import('./deviceId')
      const { legacyId } = await mod.initDeviceId()
      expect(legacyId).toBeNull()
      expect(mod.getDeviceId()).toBe(expectedIdFor('aabbccdd-eeff-0011-2233-445566778899'))
    })
  })

  it('swallows a rejected early lookup that nothing awaits', async () => {
    mockSystemError = new Error('powershell failed')
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      mod.startMachineIdLookup()
      await new Promise((resolve) => setTimeout(resolve, 10))
    } finally {
      process.off('unhandledRejection', unhandled)
    }
    expect(unhandled).not.toHaveBeenCalled()
  })

  describe('Windows hardware lookup', () => {
    const uuid = 'aabbccdd-eeff-0011-2233-445566778899'

    beforeEach(() => setPlatform('win32'))

    it('makes a single si.uuid() call, never si.system()', async () => {
      mod.startMachineIdLookup()
      mod.startMachineIdLookup()
      await mod.initDeviceId()
      expect(lookupCalls).toEqual({ system: 0, uuid: 1 })
      expect(mod.getIdClass()).toBe('machine_derived')
      // That si.uuid().hardware equals si.system().uuid on win32 is pinned by
      // deviceId.dependency.test.ts; this pins the mapping from it to the id.
      expect(mod.getDeviceId()).toBe(expectedIdFor(uuid))
    })

    it.each<NodeJS.Platform>(['linux', 'darwin'])('keeps si.system() on %s', async (platform) => {
      setPlatform(platform)
      await mod.initDeviceId()
      expect(lookupCalls).toEqual({ system: 1, uuid: 0 })
    })
  })

  describe('initDeviceId — lookup misses its budget', () => {
    const deviceIdFile = (): string => path.join(testUserData, 'device-id.txt')

    async function initTimingOut(): Promise<{ legacyId: string | null }> {
      vi.useFakeTimers()
      mockLookupHangs = true
      const pending = mod.initDeviceId()
      await vi.advanceTimersByTimeAsync(2000)
      const result = await pending
      vi.useRealTimers()
      return result
    }

    async function nextLaunch(): Promise<void> {
      mockLookupHangs = false
      vi.resetModules()
      mod = await import('./deviceId')
    }

    it('uses a provisional id it does not persist, and the next launch derives the real one', async () => {
      setPlatform('win32')
      const { legacyId } = await initTimingOut()
      expect(legacyId).toBeNull()
      expect(mod.getIdClass()).toBe('provisional')
      const provisional = mod.getDeviceId()
      expect(provisional).toMatch(/^[0-9a-f]{64}$/)
      expect(fs.existsSync(deviceIdFile())).toBe(false)

      await nextLaunch()
      await mod.initDeviceId()
      const real = expectedIdFor('aabbccdd-eeff-0011-2233-445566778899')
      expect(mod.getDeviceId()).toBe(real)
      expect(mod.getDeviceId()).not.toBe(provisional)
      expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(real)
    })

    it('keeps reusing a stored id', async () => {
      setPlatform('win32')
      const machineDerived = expectedIdFor('aabbccdd-eeff-0011-2233-445566778899')
      fs.writeFileSync(deviceIdFile(), machineDerived)
      await initTimingOut()
      expect(mod.getDeviceId()).toBe(machineDerived)
      expect(mod.getIdClass()).toBe('random_fallback')
      expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(machineDerived)
    })

    it('leaves a legacy UUID for a later launch to migrate while the lookup has not answered', async () => {
      const legacyUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
      fs.writeFileSync(deviceIdFile(), legacyUuid)
      fs.writeFileSync(path.join(testUserData, 'pending-identity-alias.txt'), legacyUuid)
      const { legacyId } = await initTimingOut()
      expect(legacyId).toBeNull()
      expect(mod.getIdClass()).toBe('provisional')
      expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(legacyUuid)

      // Boot deletes the marker on every launch.
      fs.rmSync(path.join(testUserData, 'pending-identity-alias.txt'))
      await nextLaunch()
      expect((await mod.initDeviceId()).legacyId).toBe(legacyUuid)
      expect(mod.getDeviceId()).toBe(expectedIdFor('aabbccdd-eeff-0011-2233-445566778899'))
    })

    it('saves the real id when the lookup answers late, so the next timed-out launch keeps it', async () => {
      setPlatform('win32')
      await initTimingOut()
      expect(mod.getIdClass()).toBe('provisional')
      answerLateLookup()
      const real = expectedIdFor('aabbccdd-eeff-0011-2233-445566778899')
      await vi.waitFor(() => expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(real))
      expect(mod.getDeviceId()).not.toBe(real)
      expect(lookupCalls).toEqual({ system: 0, uuid: 1 })

      await nextLaunch()
      await initTimingOut()
      expect(mod.getDeviceId()).toBe(real)
    })

    it.each([
      ['a placeholder', '03000200-0400-0500-0006-000700080009'],
      ['no', '']
    ])(
      'saves this launch id as the stable fallback when the late answer has %s UUID',
      async (_label, uuid) => {
        setPlatform('win32')
        mockSystemUuid = uuid
        await initTimingOut()
        const provisional = mod.getDeviceId()
        answerLateLookup()
        await vi.waitFor(() => expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(provisional))

        await nextLaunch()
        await initTimingOut()
        expect(mod.getDeviceId()).toBe(provisional)
        expect(mod.getIdClass()).toBe('random_fallback')
      }
    )

    it('saves the machine-id hash when a late Linux answer has no UUID', async () => {
      mockSystemUuid = ''
      mockMachineIdFiles = { [ETC_MACHINE_ID]: '0123456789abcdef0123456789abcdef' }
      await initTimingOut()
      answerLateLookup()
      const real = expectedIdFor('0123456789abcdef0123456789abcdef')
      await vi.waitFor(() => expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(real))
    })

    it('saves this launch id as the stable fallback when the lookup rejects late', async () => {
      setPlatform('win32')
      await initTimingOut()
      const provisional = mod.getDeviceId()
      const unhandled = vi.fn()
      process.on('unhandledRejection', unhandled)
      try {
        mockSystemError = new Error('late failure')
        answerLateLookup()
        await vi.waitFor(() => expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(provisional))
      } finally {
        process.off('unhandledRejection', unhandled)
      }
      expect(unhandled).not.toHaveBeenCalled()
    })

    it('saves nothing in a session that ends before the lookup answers or is ruled hung', async () => {
      setPlatform('win32')
      await initTimingOut()
      const first = mod.getDeviceId()
      await nextLaunch()
      await initTimingOut()
      expect(mod.getIdClass()).toBe('provisional')
      expect(mod.getDeviceId()).not.toBe(first)
      expect(fs.existsSync(deviceIdFile())).toBe(false)
    })

    describe('a lookup that hangs', () => {
      const real = expectedIdFor('aabbccdd-eeff-0011-2233-445566778899')

      async function initHanging(): Promise<void> {
        setPlatform('win32')
        vi.useFakeTimers()
        mockLookupHangs = true
        const pending = mod.initDeviceId()
        await vi.advanceTimersByTimeAsync(2000)
        await pending
      }

      it('saves this launch id 60 s in, and the next timed-out launch keeps it', async () => {
        await initHanging()
        const provisional = mod.getDeviceId()
        await vi.advanceTimersByTimeAsync(59_999)
        expect(fs.existsSync(deviceIdFile())).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(provisional)
        vi.useRealTimers()

        await nextLaunch()
        await initTimingOut()
        expect(mod.getDeviceId()).toBe(provisional)
        expect(mod.getIdClass()).toBe('random_fallback')
      })

      it('lets a real answer after the hung save overwrite it', async () => {
        await initHanging()
        await vi.advanceTimersByTimeAsync(60_000)
        answerLateLookup()
        await vi.advanceTimersByTimeAsync(0)
        expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(real)
      })

      it('does not save the fallback over an answer that came first', async () => {
        await initHanging()
        await vi.advanceTimersByTimeAsync(30_000)
        answerLateLookup()
        await vi.advanceTimersByTimeAsync(0)
        expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(real)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(fs.readFileSync(deviceIdFile(), 'utf-8')).toBe(real)
      })
    })

    it('counts the budget from initDeviceId(), not from the early start', async () => {
      vi.useFakeTimers()
      mockLookupHangs = true
      mod.startMachineIdLookup()
      await vi.advanceTimersByTimeAsync(5000)
      const pending = mod.initDeviceId()
      let settled = false
      void pending.then(() => (settled = true))
      await vi.advanceTimersByTimeAsync(1999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBe(true)
    })
  })
})
