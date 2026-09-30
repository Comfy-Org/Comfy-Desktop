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

vi.mock('systeminformation', () => ({
  default: {
    system: () =>
      mockSystemError ? Promise.reject(mockSystemError) : Promise.resolve({ uuid: mockSystemUuid })
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
      ['sequential OEM, uppercase', '03000200-0400-0500-0006-000700080009'.toUpperCase()],
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
  })
})
