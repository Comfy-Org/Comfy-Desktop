import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type * as ModelsModule from '../../lib/models'
import type { ResolvedExtraPath } from '../../lib/models'
import { lookupEnMessage } from '../../lib/localeTestHelper'

// `buildExtraModelPathsView` groups the flat per-type dirs from
// `resolveExtraModelPaths` (tested in models.test.ts) by section, and stamps
// on-disk existence. Mock the resolver + comfy-dir lookup so the test controls
// the shape, and use real temp dirs for the `fs.existsSync` checks.
const holder = vi.hoisted(() => ({ comfyDir: '', resolved: [] as ResolvedExtraPath[] }))

// models.ts reads `dataDir()` at module load (for YAML_PATH); the real one calls
// electron `app.getPath`, which crashes outside Electron. Stub it to a temp dir.
vi.mock('../../lib/paths', () => ({
  dataDir: () => os.tmpdir(),
}))

// Real English strings so label/tooltip assertions catch missing locale keys
// (see lookupEnMessage). Dynamic import: vi.mock factories are hoisted, so
// they can't reference top-level static imports.
vi.mock('../../lib/i18n', async () => {
  const { lookupEnMessage } = await import('../../lib/localeTestHelper')
  return { t: (key: string) => lookupEnMessage(key) }
})

vi.mock('../../lib/models', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelsModule>()
  return {
    ...actual,
    resolveComfyDir: () => holder.comfyDir,
    resolveExtraModelPaths: () => holder.resolved,
  }
})

const { buildExtraModelPathsView, buildLaunchSettingsFields } = await import('./launchSettingsFields')

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'empv-'))
  holder.comfyDir = tmp
  holder.resolved = []
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('buildExtraModelPathsView — grouping', () => {
  it('returns an empty view when the install has no path', () => {
    expect(buildExtraModelPathsView({} as never)).toEqual({
      yamlPath: '',
      exists: false,
      sections: [],
    })
  })

  it('groups per-type dirs by section and flags on-disk existence', () => {
    fs.writeFileSync(path.join(tmp, 'extra_model_paths.yaml'), 'x')
    const base = path.join(tmp, 'base')
    const ckpt = path.join(base, 'checkpoints')
    fs.mkdirSync(ckpt, { recursive: true }) // exists
    const missing = path.join(base, 't2i_adapter') // not created

    holder.resolved = [
      { section: 'ext', basePath: base, type: 'checkpoints', rawType: 'checkpoints', dir: ckpt, isDefault: false },
      { section: 'ext', basePath: base, type: 'controlnet', rawType: 'controlnet', dir: missing, isDefault: false },
    ]

    const view = buildExtraModelPathsView({ installPath: tmp } as never)

    expect(view.exists).toBe(true)
    expect(view.sections).toHaveLength(1)
    const s = view.sections[0]!
    expect(s.name).toBe('ext')
    expect(s.basePath).toBe(base)
    expect(s.basePathExists).toBe(true)
    expect(s.dirs).toEqual([
      { type: 'checkpoints', rawType: 'checkpoints', dir: ckpt, dirExists: true },
      { type: 'controlnet', rawType: 'controlnet', dir: missing, dirExists: false },
    ])
  })

  it('keeps sections separate and preserves declaration order', () => {
    fs.writeFileSync(path.join(tmp, 'extra_model_paths.yaml'), 'x')
    holder.resolved = [
      { section: 'first', basePath: null, type: 'loras', rawType: 'loras', dir: path.join(tmp, 'a'), isDefault: true },
      { section: 'second', basePath: path.join(tmp, 'b'), type: 'vae', rawType: 'vae', dir: path.join(tmp, 'b', 'vae'), isDefault: false },
      { section: 'first', basePath: null, type: 'vae', rawType: 'vae', dir: path.join(tmp, 'c'), isDefault: true },
    ]

    const view = buildExtraModelPathsView({ installPath: tmp } as never)

    expect(view.sections.map((s) => s.name)).toEqual(['first', 'second'])
    expect(view.sections[0]!.isDefault).toBe(true)
    expect(view.sections[0]!.basePath).toBeNull()
    expect(view.sections[0]!.basePathExists).toBe(false)
    expect(view.sections[0]!.dirs).toHaveLength(2) // both 'first' entries grouped
    expect(view.sections[1]!.dirs).toHaveLength(1)
  })
})

describe('buildLaunchSettingsFields - managerSecurityLevel (per-install)', () => {
  const OPTS = { defaultLaunchArgs: '' }

  function managerField(installation: Record<string, unknown>) {
    const field = buildLaunchSettingsFields(installation as never, OPTS).find(
      (f) => f.id === 'managerSecurityLevel'
    )
    expect(field, 'managerSecurityLevel field missing from launch settings').toBeTruthy()
    return field as Record<string, unknown> & {
      options?: { value: string; label: string; description?: string }[]
    }
  }

  it('is an editable select defaulting to normal when the install never chose', () => {
    const field = managerField({})
    expect(field.editable).toBe(true)
    expect(field.editType).toBe('select')
    expect(field.value).toBe('normal')
    expect(field.requiresRestart).toBe(true)
  })

  it('offers exactly the four Manager levels in order with real locale labels', () => {
    const field = managerField({})
    expect(field.options?.map((o) => o.value)).toEqual(['strong', 'normal', 'normal-', 'weak'])
    expect(field.options?.map((o) => o.label)).toEqual([
      'Strict',
      'Standard (recommended)',
      'Relaxed',
      'Permissive',
    ])
    expect(field.label).toBe('Manager Security Level')
    // Guard against a raw key leaking into the UI if the locale entry is removed.
    expect(field.tooltip).toBe(lookupEnMessage('tooltips.managerSecurityLevel'))
    expect(String(field.tooltip)).not.toContain('tooltips.')
  })

  it('gives every option a real description explaining its --listen behavior', () => {
    const field = managerField({})
    for (const opt of field.options ?? []) {
      expect(opt.description, `option ${opt.value} has no description`).toBeTruthy()
      expect(opt.description).toBe(lookupEnMessage(`common.managerSecurityLevel_${opt.value}_desc`))
      // Guard against a raw key leaking into the UI if the locale entry is removed.
      expect(opt.description).not.toContain('common.')
      expect(opt.description).toContain('--listen')
    }
  })

  it('reads each install\'s own persisted level (per-install isolation)', () => {
    expect(managerField({ managerSecurityLevel: 'weak' }).value).toBe('weak')
    expect(managerField({ managerSecurityLevel: 'strong' }).value).toBe('strong')
  })

  it('degrades a hand-edited bogus record value to the default', () => {
    expect(managerField({ managerSecurityLevel: 'bogus' }).value).toBe('normal')
  })

  it('sits directly below Startup Arguments', () => {
    const ids = buildLaunchSettingsFields({} as never, OPTS).map((f) => f.id)
    expect(ids.indexOf('managerSecurityLevel')).toBe(ids.indexOf('launchArgs') + 1)
  })
})
