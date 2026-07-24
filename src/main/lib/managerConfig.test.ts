import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { _internals, ensureManagerConfig } from './managerConfig'

describe('ensureManagerConfig', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-config-'))
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  function readModern(): string {
    return fs.readFileSync(_internals.modernConfigPath(tmpRoot), 'utf-8')
  }

  describe('fresh install', () => {
    it('writes the mirror block plus the default security level when mirrors are on', async () => {
      await ensureManagerConfig(tmpRoot, { useChineseMirrors: true })
      const written = readModern()
      expect(written).toContain('[default]')
      expect(written).toContain(`channel_url = ${_internals.MANAGER_MIRROR_CHANNEL_URL}`)
      expect(written).toContain('bypass_ssl = true')
      expect(written).toContain('network_mode = public')
      expect(written).toContain('security_level = normal')
    })

    it('writes the chosen security level alongside the mirror block', async () => {
      await ensureManagerConfig(tmpRoot, { useChineseMirrors: true, securityLevel: 'weak' })
      expect(readModern()).toContain('security_level = weak')
    })

    it('writes security level only (no mirror keys) when mirrors are off', async () => {
      await ensureManagerConfig(tmpRoot, { useChineseMirrors: false, securityLevel: 'strong' })
      const written = readModern()
      expect(written).toContain('security_level = strong')
      expect(written).not.toContain('channel_url')
      expect(written).not.toContain('bypass_ssl')
    })

    it('writes nothing when neither a mirror nor a security level is requested', async () => {
      await ensureManagerConfig(tmpRoot, { useChineseMirrors: false })
      expect(fs.existsSync(_internals.modernConfigPath(tmpRoot))).toBe(false)
    })

    it('creates intermediate directories', async () => {
      const target = _internals.modernConfigPath(tmpRoot)
      expect(fs.existsSync(path.dirname(target))).toBe(false)
      await ensureManagerConfig(tmpRoot, { useChineseMirrors: true })
      expect(fs.existsSync(target)).toBe(true)
    })
  })

  describe('existing modern config', () => {
    function seed(content: string): string {
      const target = _internals.modernConfigPath(tmpRoot)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content, 'utf-8')
      return target
    }

    it('updates only security_level and preserves the rest of the file', async () => {
      seed('[default]\nchannel_url = https://my.custom.mirror/\nsecurity_level = normal\n')
      await ensureManagerConfig(tmpRoot, { useChineseMirrors: false, securityLevel: 'weak' })
      const written = readModern()
      expect(written).toContain('channel_url = https://my.custom.mirror/')
      expect(written).toContain('security_level = weak')
      expect(written).not.toContain('security_level = normal')
    })

    it('inserts security_level when the key is absent', async () => {
      seed('[default]\nchannel_url = https://my.custom.mirror/\n')
      await ensureManagerConfig(tmpRoot, { useChineseMirrors: false, securityLevel: 'strong' })
      const written = readModern()
      expect(written).toContain('channel_url = https://my.custom.mirror/')
      expect(written).toContain('security_level = strong')
    })

    it('leaves the file untouched when the user has not chosen a level', async () => {
      const original = '[default]\nchannel_url = https://my.custom.mirror/\n'
      seed(original)
      await ensureManagerConfig(tmpRoot, { useChineseMirrors: true })
      expect(readModern()).toBe(original)
    })

    it('ignores an invalid security level', async () => {
      const original = '[default]\nsecurity_level = normal\n'
      seed(original)
      // @ts-expect-error -- exercising runtime guard against a bad persisted value
      await ensureManagerConfig(tmpRoot, { useChineseMirrors: false, securityLevel: 'bogus' })
      expect(readModern()).toBe(original)
    })
  })

  describe('legacy config present', () => {
    function seedLegacy(content: string): string {
      const legacyTarget = _internals.legacyConfigPath(tmpRoot)
      fs.mkdirSync(path.dirname(legacyTarget), { recursive: true })
      fs.writeFileSync(legacyTarget, content, 'utf-8')
      return legacyTarget
    }

    function readLegacy(): string {
      return fs.readFileSync(_internals.legacyConfigPath(tmpRoot), 'utf-8')
    }

    it('updates the legacy file in place without creating the modern config', async () => {
      seedLegacy('[default]\nchannel_url = legacy\nsecurity_level = normal\n')

      await ensureManagerConfig(tmpRoot, { useChineseMirrors: true, securityLevel: 'weak' })

      expect(fs.existsSync(_internals.modernConfigPath(tmpRoot))).toBe(false)
      const written = readLegacy()
      expect(written).toContain('channel_url = legacy')
      expect(written).toContain('security_level = weak')
    })

    it('never seeds mirror keys into a legacy config', async () => {
      const original = '[default]\nchannel_url = legacy\n'
      seedLegacy(original)

      await ensureManagerConfig(tmpRoot, { useChineseMirrors: true })

      expect(fs.existsSync(_internals.modernConfigPath(tmpRoot))).toBe(false)
      expect(readLegacy()).toBe(original)
    })

    it('reconciles the modern config when both files exist (Manager reads the modern one)', async () => {
      const legacyOriginal = '[default]\nsecurity_level = weak\n'
      seedLegacy(legacyOriginal)
      const modernTarget = _internals.modernConfigPath(tmpRoot)
      fs.mkdirSync(path.dirname(modernTarget), { recursive: true })
      fs.writeFileSync(modernTarget, '[default]\nsecurity_level = normal\n', 'utf-8')

      await ensureManagerConfig(tmpRoot, { useChineseMirrors: false, securityLevel: 'strong' })

      expect(readModern()).toContain('security_level = strong')
      expect(readLegacy()).toBe(legacyOriginal)
    })
  })

  describe('path helpers', () => {
    it('targets the modern __manager path', () => {
      expect(_internals.modernConfigPath('/some/install')).toBe(
        path.join('/some/install', 'ComfyUI', 'user', '__manager', 'config.ini')
      )
    })

    it('targets the legacy ComfyUI-Manager path', () => {
      expect(_internals.legacyConfigPath('/some/install')).toBe(
        path.join('/some/install', 'ComfyUI', 'user', 'default', 'ComfyUI-Manager', 'config.ini')
      )
    })
  })

  describe('withSecurityLevel', () => {
    it('replaces an existing key', () => {
      expect(_internals.withSecurityLevel('[default]\nsecurity_level = normal\n', 'weak')).toBe(
        '[default]\nsecurity_level = weak\n'
      )
    })

    it('inserts under [default] when the key is missing', () => {
      expect(_internals.withSecurityLevel('[default]\nchannel_url = x\n', 'strong')).toBe(
        '[default]\nsecurity_level = strong\nchannel_url = x\n'
      )
    })

    it('creates a [default] section when none exists', () => {
      expect(_internals.withSecurityLevel('', 'normal')).toBe('[default]\nsecurity_level = normal\n')
    })

    it('only touches the key inside [default], not a same-named key in another section', () => {
      const content = '[other]\nsecurity_level = normal\n\n[default]\nsecurity_level = weak\n'
      expect(_internals.withSecurityLevel(content, 'strong')).toBe(
        '[other]\nsecurity_level = normal\n\n[default]\nsecurity_level = strong\n'
      )
    })

    it('inserts into [default] when the key exists only in another section', () => {
      const content = '[other]\nsecurity_level = normal\n\n[default]\nchannel_url = x\n'
      expect(_internals.withSecurityLevel(content, 'strong')).toBe(
        '[other]\nsecurity_level = normal\n\n[default]\nsecurity_level = strong\nchannel_url = x\n'
      )
    })

    it('ignores a same-named key in a section after [default]', () => {
      const content = '[default]\nchannel_url = x\n\n[other]\nsecurity_level = normal\n'
      expect(_internals.withSecurityLevel(content, 'weak')).toBe(
        '[default]\nsecurity_level = weak\nchannel_url = x\n\n[other]\nsecurity_level = normal\n'
      )
    })

    it('preserves CRLF line endings when replacing', () => {
      const content = '[default]\r\nsecurity_level = normal\r\nchannel_url = x\r\n'
      expect(_internals.withSecurityLevel(content, 'weak')).toBe(
        '[default]\r\nsecurity_level = weak\r\nchannel_url = x\r\n'
      )
    })

    // configparser lowercases option keys, so Manager reads `Security_Level`
    // as security_level - replace it instead of adding a duplicate.
    it('replaces a mixed-case key (configparser keys are case-insensitive)', () => {
      expect(_internals.withSecurityLevel('[default]\nSecurity_Level = normal\n', 'weak')).toBe(
        '[default]\nsecurity_level = weak\n'
      )
    })

    it('collapses case-variant duplicate keys to one canonical line', () => {
      const content = '[default]\nSecurity_Level = normal\nchannel_url = x\nsecurity_level = strong\n'
      expect(_internals.withSecurityLevel(content, 'weak')).toBe(
        '[default]\nsecurity_level = weak\nchannel_url = x\n'
      )
    })

    // configparser section names are case-sensitive: Manager indexes
    // config['default'], so a hand-written `[Default]` is a section Manager
    // never reads - write a real [default] instead of editing it.
    it('does not treat [Default] as the default section (configparser sections are case-sensitive)', () => {
      const content = '[Default]\nsecurity_level = normal\n'
      expect(_internals.withSecurityLevel(content, 'weak')).toBe(
        '[Default]\nsecurity_level = normal\n[default]\nsecurity_level = weak\n'
      )
    })
  })
})
