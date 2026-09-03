// @vitest-environment node
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InstallationRecord } from './installations'

let tmpRoot = ''
let userDataPath = ''

async function loadInstallations() {
  return await import('./installations')
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-desktop-2-installations-'))
  userDataPath = path.join(tmpRoot, 'user-data')
  fs.mkdirSync(userDataPath, { recursive: true })

  vi.resetModules()
  vi.restoreAllMocks()
  vi.doMock('electron', () => ({
    app: {
      getPath: () => userDataPath
    }
  }))
  // Force win32 so the XDG branches in paths.ts don't kick in on a Linux runner.
  vi.stubGlobal('process', {
    ...process,
    platform: 'win32'
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

const localCategoryFor = (sourceId: string): string | undefined => {
  if (sourceId === 'standalone' || sourceId === 'portable') return 'local'
  if (sourceId === 'cloud') return 'cloud'
  if (sourceId === 'desktop') return 'desktop'
  return undefined
}
const resolveCategory = (inst: InstallationRecord) => localCategoryFor(inst.sourceId)

describe('installations.markLaunched', () => {
  it('writes both lastLaunchedAt and lastLaunchedAtByCategory[category]', async () => {
    const installations = await loadInstallations()
    const before = Date.now()
    const entry = await installations.add({
      name: 'Local A',
      installPath: path.join(tmpRoot, 'a'),
      sourceId: 'standalone',
      status: 'installed'
    })

    const updated = await installations.markLaunched(entry.id, resolveCategory)
    expect(updated).not.toBeNull()
    expect(typeof updated!.lastLaunchedAt).toBe('number')
    expect(updated!.lastLaunchedAt!).toBeGreaterThanOrEqual(before)
    expect(updated!.lastLaunchedAtByCategory).toEqual({ local: updated!.lastLaunchedAt })

    // Persisted to disk, not just returned in memory.
    const reloaded = await installations.get(entry.id)
    expect(reloaded!.lastLaunchedAt).toBe(updated!.lastLaunchedAt)
    expect(reloaded!.lastLaunchedAtByCategory).toEqual({ local: updated!.lastLaunchedAt })
  })

  it('preserves prior per-category timestamps for other categories', async () => {
    const installations = await loadInstallations()
    const entry = await installations.add({
      name: 'Multi A',
      installPath: path.join(tmpRoot, 'multi-a'),
      sourceId: 'standalone',
      status: 'installed',
      lastLaunchedAtByCategory: { cloud: 100, desktop: 200 }
    })

    const updated = await installations.markLaunched(entry.id, resolveCategory)
    expect(updated!.lastLaunchedAtByCategory).toMatchObject({
      cloud: 100,
      desktop: 200,
      local: updated!.lastLaunchedAt
    })
  })

  it('omits the per-category map when the resolver returns undefined', async () => {
    const installations = await loadInstallations()
    const entry = await installations.add({
      name: 'No Category',
      installPath: path.join(tmpRoot, 'no-cat'),
      // Unrecognised source → resolver returns undefined → only the global
      // timestamp is stamped.
      sourceId: 'mystery',
      status: 'installed'
    })

    const updated = await installations.markLaunched(entry.id, resolveCategory)
    expect(typeof updated!.lastLaunchedAt).toBe('number')
    expect(updated!.lastLaunchedAtByCategory).toBeUndefined()
  })

  it('omits the per-category map when no resolver is provided', async () => {
    const installations = await loadInstallations()
    const entry = await installations.add({
      name: 'No Resolver',
      installPath: path.join(tmpRoot, 'no-res'),
      sourceId: 'standalone',
      status: 'installed'
    })

    const updated = await installations.markLaunched(entry.id)
    expect(typeof updated!.lastLaunchedAt).toBe('number')
    expect(updated!.lastLaunchedAtByCategory).toBeUndefined()
  })

  it('passes the freshly-loaded record to the resolver', async () => {
    const installations = await loadInstallations()
    const entry = await installations.add({
      name: 'Resolver Probe',
      installPath: path.join(tmpRoot, 'probe'),
      sourceId: 'standalone',
      status: 'installed'
    })

    let received: InstallationRecord | null = null
    await installations.markLaunched(entry.id, (inst) => {
      received = inst
      return 'local'
    })
    expect(received).not.toBeNull()
    expect(received!.id).toBe(entry.id)
    expect(received!.sourceId).toBe('standalone')
  })

  it('emits an installationEvents `updated` event on success', async () => {
    const installations = await loadInstallations()
    const entry = await installations.add({
      name: 'Event A',
      installPath: path.join(tmpRoot, 'event-a'),
      sourceId: 'standalone',
      status: 'installed'
    })

    const seen: InstallationRecord[] = []
    installations.installationEvents.on('updated', (rec: InstallationRecord) => seen.push(rec))

    await installations.markLaunched(entry.id, resolveCategory)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.id).toBe(entry.id)
    expect(seen[0]!.lastLaunchedAtByCategory).toEqual({ local: seen[0]!.lastLaunchedAt })
  })

  it('returns null and emits nothing when the install id does not exist', async () => {
    const installations = await loadInstallations()
    const seen: InstallationRecord[] = []
    installations.installationEvents.on('updated', (rec: InstallationRecord) => seen.push(rec))

    const updated = await installations.markLaunched('inst-does-not-exist', resolveCategory)
    expect(updated).toBeNull()
    expect(seen).toHaveLength(0)
  })
})

describe('installations.add (id uniqueness)', () => {
  // `inst-${Date.now()}` collided for same-millisecond `add()` calls, aliasing
  // records under one id; the fix appends a per-process counter.
  it('produces a distinct id for each add(), even back-to-back inside the same millisecond', async () => {
    const installations = await loadInstallations()
    // Pin Date.now so all 5 add() calls hit the same-ms collision path.
    const fixed = 1_700_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(fixed)
    const records = []
    for (let i = 0; i < 5; i++) {
      records.push(
        await installations.add({
          name: `Same-ms ${i}`,
          installPath: path.join(tmpRoot, `same-ms-${i}`),
          sourceId: 'standalone',
          status: 'installed'
        })
      )
    }
    const ids = records.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('installations.associateUnownedBuildInstalls', () => {
  it('associates exact legacy matches once without overwriting existing ownership', async () => {
    const installations = await loadInstallations()
    const matching = await installations.add({
      name: 'Exact Match',
      installPath: path.join(tmpRoot, 'matching'),
      sourceId: 'comfybuilder',
      distributionId: 'dist-visible',
      status: 'installed'
    })
    const sameName = await installations.add({
      name: 'Visible Build',
      installPath: path.join(tmpRoot, 'same-name'),
      sourceId: 'comfybuilder',
      distributionId: 'dist-not-visible',
      status: 'installed'
    })
    const localWithMatchingId = await installations.add({
      name: 'Local Record',
      installPath: path.join(tmpRoot, 'local-record'),
      sourceId: 'standalone',
      distributionId: 'dist-visible',
      status: 'installed'
    })
    const alreadyOwned = await installations.add({
      name: 'Already Owned',
      installPath: path.join(tmpRoot, 'already-owned'),
      sourceId: 'comfybuilder',
      workspaceId: 'workspace-old',
      distributionId: 'dist-visible',
      status: 'installed'
    })
    const changed = vi.fn()
    installations.installationEvents.on('changed', changed)

    const updated = await installations.associateUnownedBuildInstalls(
      'workspace-current',
      new Set(['dist-visible'])
    )

    expect(updated.map((record) => record.id)).toEqual([matching.id])
    expect((await installations.get(matching.id))!.workspaceId).toBe('workspace-current')
    expect((await installations.get(sameName.id))!.workspaceId).toBeUndefined()
    expect((await installations.get(localWithMatchingId.id))!.workspaceId).toBeUndefined()
    expect((await installations.get(alreadyOwned.id))!.workspaceId).toBe('workspace-old')
    expect(changed).toHaveBeenCalledOnce()

    await installations.associateUnownedBuildInstalls(
      'workspace-current',
      new Set(['dist-visible'])
    )
    expect(changed).toHaveBeenCalledOnce()
  })
})

describe('installations.getRecent', () => {
  it('returns null when no installs have been launched', async () => {
    const installations = await loadInstallations()
    expect(await installations.getRecent()).toBeNull()

    await installations.add({
      name: 'Never Launched',
      installPath: path.join(tmpRoot, 'never'),
      sourceId: 'standalone',
      status: 'installed'
    })
    expect(await installations.getRecent()).toBeNull()
  })

  it('returns the install with the largest global lastLaunchedAt', async () => {
    const installations = await loadInstallations()
    const a = await installations.add({
      name: 'A',
      installPath: path.join(tmpRoot, 'a'),
      sourceId: 'standalone',
      status: 'installed',
      lastLaunchedAt: 100
    })
    const b = await installations.add({
      name: 'B',
      installPath: path.join(tmpRoot, 'b'),
      sourceId: 'standalone',
      status: 'installed',
      lastLaunchedAt: 500
    })
    await installations.add({
      name: 'C',
      installPath: path.join(tmpRoot, 'c'),
      sourceId: 'standalone',
      status: 'installed',
      lastLaunchedAt: 300
    })

    const recent = await installations.getRecent()
    expect(recent!.id).toBe(b.id)
    expect(recent!.id).not.toBe(a.id)
  })
})

describe('installations.resolveAutoLaunchInstall', () => {
  it('returns null for null / undefined / empty / "none"', async () => {
    const installations = await loadInstallations()
    expect(await installations.resolveAutoLaunchInstall(null)).toBeNull()
    expect(await installations.resolveAutoLaunchInstall(undefined)).toBeNull()
    expect(await installations.resolveAutoLaunchInstall('')).toBeNull()
    expect(await installations.resolveAutoLaunchInstall('none')).toBeNull()
  })

  it('"last" resolves via getRecent and returns null when nothing has launched', async () => {
    const installations = await loadInstallations()
    expect(await installations.resolveAutoLaunchInstall('last')).toBeNull()

    await installations.add({
      name: 'older',
      installPath: path.join(tmpRoot, 'older'),
      sourceId: 'standalone',
      status: 'installed',
      lastLaunchedAt: 100
    })
    const newer = await installations.add({
      name: 'newer',
      installPath: path.join(tmpRoot, 'newer'),
      sourceId: 'standalone',
      status: 'installed',
      lastLaunchedAt: 500
    })
    const recent = await installations.resolveAutoLaunchInstall('last')
    expect(recent!.id).toBe(newer.id)
  })

  it('an installation id resolves the matching install, or null when stale', async () => {
    const installations = await loadInstallations()
    const a = await installations.add({
      name: 'a',
      installPath: path.join(tmpRoot, 'a'),
      sourceId: 'standalone',
      status: 'installed'
    })
    const found = await installations.resolveAutoLaunchInstall(a.id)
    expect(found!.id).toBe(a.id)
    expect(await installations.resolveAutoLaunchInstall('inst-does-not-exist')).toBeNull()
  })
})

describe('installations.load (legacy shared-storage flag migrations)', () => {
  function writeRawInstallations(records: Record<string, unknown>[]): string {
    // On win32 `dataDir()` is the Electron userData path directly (no `data/`).
    fs.mkdirSync(userDataPath, { recursive: true })
    const file = path.join(userDataPath, 'installations.json')
    fs.writeFileSync(file, JSON.stringify(records))
    return file
  }

  it('translates legacy useSharedPaths: true -> all new flags true', async () => {
    writeRawInstallations([
      {
        id: 'legacy-on',
        name: 'Legacy On',
        installPath: path.join(tmpRoot, 'on'),
        sourceId: 'standalone',
        status: 'installed',
        createdAt: new Date().toISOString(),
        useSharedPaths: true
      }
    ])
    const installations = await loadInstallations()
    const list = await installations.list()
    const rec = list.find((r) => r.id === 'legacy-on')!
    expect(rec.useSharedModels).toBe(true)
    expect(rec.useSharedInput).toBe(true)
    expect(rec.useSharedOutput).toBe(true)
    expect(rec).not.toHaveProperty('useSharedPaths')
    expect(rec).not.toHaveProperty('useSharedInputOutput')
  })

  it('translates legacy useSharedPaths: false -> useSharedModels: true, per-folder flags false', async () => {
    // The migration forces `useSharedModels: true` regardless of the legacy
    // value (isolating paths meant input/output, not the model library).
    writeRawInstallations([
      {
        id: 'legacy-off',
        name: 'Legacy Off',
        installPath: path.join(tmpRoot, 'off'),
        sourceId: 'standalone',
        status: 'installed',
        createdAt: new Date().toISOString(),
        useSharedPaths: false
      }
    ])
    const installations = await loadInstallations()
    const list = await installations.list()
    const rec = list.find((r) => r.id === 'legacy-off')!
    expect(rec.useSharedModels).toBe(true)
    expect(rec.useSharedInput).toBe(false)
    expect(rec.useSharedOutput).toBe(false)
    expect(rec).not.toHaveProperty('useSharedPaths')
    expect(rec).not.toHaveProperty('useSharedInputOutput')
  })

  it('splits legacy useSharedInputOutput into useSharedInput + useSharedOutput', async () => {
    writeRawInstallations([
      {
        id: 'split-off',
        name: 'Split Off',
        installPath: path.join(tmpRoot, 'split-off'),
        sourceId: 'standalone',
        status: 'installed',
        createdAt: new Date().toISOString(),
        useSharedInputOutput: false
      },
      {
        id: 'split-on',
        name: 'Split On',
        installPath: path.join(tmpRoot, 'split-on'),
        sourceId: 'standalone',
        status: 'installed',
        createdAt: new Date().toISOString(),
        useSharedInputOutput: true
      }
    ])
    const installations = await loadInstallations()
    const list = await installations.list()
    const off = list.find((r) => r.id === 'split-off')!
    expect(off.useSharedInput).toBe(false)
    expect(off.useSharedOutput).toBe(false)
    expect(off).not.toHaveProperty('useSharedInputOutput')
    const on = list.find((r) => r.id === 'split-on')!
    expect(on.useSharedInput).toBe(true)
    expect(on.useSharedOutput).toBe(true)
    expect(on).not.toHaveProperty('useSharedInputOutput')
  })

  it('keeps newer per-folder flags when a mixed-schema record also has the legacy flag', async () => {
    // A downgrade/upgrade cycle can leave both the legacy flag and the new
    // per-folder flags on one record; the per-folder values are newer and win.
    writeRawInstallations([
      {
        id: 'mixed',
        name: 'Mixed',
        installPath: path.join(tmpRoot, 'mixed'),
        sourceId: 'standalone',
        status: 'installed',
        createdAt: new Date().toISOString(),
        useSharedInputOutput: false,
        useSharedInput: true,
        useSharedOutput: false
      }
    ])
    const installations = await loadInstallations()
    const rec = (await installations.list()).find((r) => r.id === 'mixed')!
    expect(rec.useSharedInput).toBe(true)
    expect(rec.useSharedOutput).toBe(false)
    expect(rec).not.toHaveProperty('useSharedInputOutput')
  })

  it('leaves records without useSharedPaths untouched (no implicit migration)', async () => {
    // Records already on the new schema must round-trip without the
    // migration adding fields that weren't there before.
    writeRawInstallations([
      {
        id: 'modern',
        name: 'Modern',
        installPath: path.join(tmpRoot, 'modern'),
        sourceId: 'standalone',
        status: 'installed',
        createdAt: new Date().toISOString(),
        useSharedModels: false
      }
    ])
    const installations = await loadInstallations()
    const list = await installations.list()
    const rec = list.find((r) => r.id === 'modern')!
    expect(rec.useSharedModels).toBe(false)
    expect(rec.useSharedInput).toBeUndefined()
    expect(rec.useSharedOutput).toBeUndefined()
    expect(rec).not.toHaveProperty('useSharedPaths')
    expect(rec).not.toHaveProperty('useSharedInputOutput')
  })

  it('rewrites a legacy mid-update ComfyBuilder record from installing to updating', async () => {
    // Older versions reused status 'installing' for in-place updates,
    // disambiguated by the rollback payload; that state now reads 'updating'.
    // A fresh install (no rollback) and other sources keep 'installing'.
    writeRawInstallations([
      {
        id: 'mid-update',
        name: 'Mid Update',
        installPath: path.join(tmpRoot, 'mid-update'),
        sourceId: 'comfybuilder',
        status: 'installing',
        createdAt: new Date().toISOString(),
        comfybuilderRollback: { version: '1', artifactId: 'old', status: 'installed' }
      },
      {
        id: 'fresh',
        name: 'Fresh',
        installPath: path.join(tmpRoot, 'fresh'),
        sourceId: 'comfybuilder',
        status: 'installing',
        createdAt: new Date().toISOString()
      },
      {
        id: 'other-source',
        name: 'Other',
        installPath: path.join(tmpRoot, 'other'),
        sourceId: 'standalone',
        status: 'installing',
        createdAt: new Date().toISOString(),
        comfybuilderRollback: { version: '1' }
      }
    ])
    const installations = await loadInstallations()
    const list = await installations.list()
    expect(list.find((r) => r.id === 'mid-update')!.status).toBe('updating')
    expect(list.find((r) => r.id === 'fresh')!.status).toBe('installing')
    expect(list.find((r) => r.id === 'other-source')!.status).toBe('installing')
  })

  it('strips legacy useSharedPaths from disk on next write', async () => {
    const file = writeRawInstallations([
      {
        id: 'legacy-strip',
        name: 'Legacy Strip',
        installPath: path.join(tmpRoot, 'strip'),
        sourceId: 'standalone',
        status: 'installed',
        createdAt: new Date().toISOString(),
        useSharedPaths: true
      }
    ])
    const installations = await loadInstallations()
    // Update triggers a save, which re-serializes the migrated record.
    await installations.update('legacy-strip', { name: 'Renamed' })
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>[]
    const persisted = raw.find((r) => r['id'] === 'legacy-strip')!
    expect(persisted).not.toHaveProperty('useSharedPaths')
    expect(persisted).not.toHaveProperty('useSharedInputOutput')
    expect(persisted['useSharedModels']).toBe(true)
    expect(persisted['useSharedInput']).toBe(true)
    expect(persisted['useSharedOutput']).toBe(true)
  })
})

describe('installations.getRecentByCategory', () => {
  it('returns null when there are no installs', async () => {
    const installations = await loadInstallations()
    expect(await installations.getRecentByCategory('local', resolveCategory)).toBeNull()
  })

  it('returns null when no install in the category has been launched', async () => {
    const installations = await loadInstallations()
    await installations.add({
      name: 'Never Local',
      installPath: path.join(tmpRoot, 'nl'),
      sourceId: 'standalone',
      status: 'installed'
    })
    await installations.add({
      name: 'Cloud With Stamp',
      installPath: path.join(tmpRoot, 'cs'),
      sourceId: 'cloud',
      status: 'installed',
      lastLaunchedAt: 9999
    })

    expect(await installations.getRecentByCategory('local', resolveCategory)).toBeNull()
  })

  it('picks the install with the largest lastLaunchedAtByCategory[category] within the category', async () => {
    const installations = await loadInstallations()
    await installations.add({
      name: 'Local Old',
      installPath: path.join(tmpRoot, 'lo'),
      sourceId: 'standalone',
      status: 'installed',
      lastLaunchedAt: 200,
      lastLaunchedAtByCategory: { local: 200 }
    })
    const winner = await installations.add({
      name: 'Local New',
      installPath: path.join(tmpRoot, 'ln'),
      sourceId: 'portable',
      status: 'installed',
      lastLaunchedAt: 400,
      lastLaunchedAtByCategory: { local: 400 }
    })
    // Cloud install with a much higher timestamp must NOT win the local query.
    await installations.add({
      name: 'Cloud High',
      installPath: path.join(tmpRoot, 'ch'),
      sourceId: 'cloud',
      status: 'installed',
      lastLaunchedAt: 9999,
      lastLaunchedAtByCategory: { cloud: 9999 }
    })

    const recent = await installations.getRecentByCategory('local', resolveCategory)
    expect(recent!.id).toBe(winner.id)
  })

  it('falls back to global lastLaunchedAt for installs without a per-category entry', async () => {
    const installations = await loadInstallations()
    // Legacy install: only the global field set.
    const legacy = await installations.add({
      name: 'Legacy Local',
      installPath: path.join(tmpRoot, 'leg'),
      sourceId: 'standalone',
      status: 'installed',
      lastLaunchedAt: 500
    })
    // Newer install with a per-category entry, but lower timestamp.
    await installations.add({
      name: 'Newer Local',
      installPath: path.join(tmpRoot, 'new'),
      sourceId: 'portable',
      status: 'installed',
      lastLaunchedAt: 100,
      lastLaunchedAtByCategory: { local: 100 }
    })

    const recent = await installations.getRecentByCategory('local', resolveCategory)
    expect(recent!.id).toBe(legacy.id)
  })

  it('prefers the per-category timestamp over the global one when both exist', async () => {
    const installations = await loadInstallations()
    // Even though A's global timestamp is lower, its per-category entry is higher.
    const winner = await installations.add({
      name: 'A',
      installPath: path.join(tmpRoot, 'a'),
      sourceId: 'standalone',
      status: 'installed',
      lastLaunchedAt: 100,
      lastLaunchedAtByCategory: { local: 1000 }
    })
    await installations.add({
      name: 'B',
      installPath: path.join(tmpRoot, 'b'),
      sourceId: 'standalone',
      status: 'installed',
      lastLaunchedAt: 500,
      lastLaunchedAtByCategory: { local: 500 }
    })

    const recent = await installations.getRecentByCategory('local', resolveCategory)
    expect(recent!.id).toBe(winner.id)
  })

  it('ignores installs in other categories even when their per-category map mentions ours', async () => {
    const installations = await loadInstallations()
    // A cloud install whose per-category map has a stray `local` key must still
    // be filtered out, since the resolver says it's 'cloud'.
    await installations.add({
      name: 'Stray Cloud',
      installPath: path.join(tmpRoot, 'stray'),
      sourceId: 'cloud',
      status: 'installed',
      lastLaunchedAt: 9999,
      lastLaunchedAtByCategory: { local: 9999, cloud: 9999 }
    })
    const winner = await installations.add({
      name: 'Real Local',
      installPath: path.join(tmpRoot, 'real'),
      sourceId: 'standalone',
      status: 'installed',
      lastLaunchedAt: 1,
      lastLaunchedAtByCategory: { local: 1 }
    })

    const recent = await installations.getRecentByCategory('local', resolveCategory)
    expect(recent!.id).toBe(winner.id)
  })

  it('updates getRecentByCategory after a markLaunched call', async () => {
    const installations = await loadInstallations()
    const a = await installations.add({
      name: 'A',
      installPath: path.join(tmpRoot, 'a'),
      sourceId: 'standalone',
      status: 'installed',
      lastLaunchedAt: 100,
      lastLaunchedAtByCategory: { local: 100 }
    })
    const b = await installations.add({
      name: 'B',
      installPath: path.join(tmpRoot, 'b'),
      sourceId: 'standalone',
      status: 'installed',
      lastLaunchedAt: 200,
      lastLaunchedAtByCategory: { local: 200 }
    })

    expect((await installations.getRecentByCategory('local', resolveCategory))!.id).toBe(b.id)

    // markLaunched(a) should bump A above B.
    await installations.markLaunched(a.id, resolveCategory)
    expect((await installations.getRecentByCategory('local', resolveCategory))!.id).toBe(a.id)
  })
})

describe('installations.hasNameConflict', () => {
  it('is false when no other install shares the name', async () => {
    const installations = await loadInstallations()
    const a = await installations.add({
      name: 'Alpha',
      installPath: path.join(tmpRoot, 'a'),
      sourceId: 'standalone',
      status: 'installed'
    })
    expect(await installations.hasNameConflict(a.id, 'Beta')).toBe(false)
  })

  it('is true when another install already uses the name', async () => {
    const installations = await loadInstallations()
    await installations.add({
      name: 'Taken',
      installPath: path.join(tmpRoot, 'a'),
      sourceId: 'standalone',
      status: 'installed'
    })
    const b = await installations.add({
      name: 'Free',
      installPath: path.join(tmpRoot, 'b'),
      sourceId: 'standalone',
      status: 'installed'
    })
    expect(await installations.hasNameConflict(b.id, 'Taken')).toBe(true)
  })

  it('ignores the install being renamed (renaming to its own name is not a conflict)', async () => {
    const installations = await loadInstallations()
    const a = await installations.add({
      name: 'Self',
      installPath: path.join(tmpRoot, 'a'),
      sourceId: 'standalone',
      status: 'installed'
    })
    expect(await installations.hasNameConflict(a.id, 'Self')).toBe(false)
  })
})

describe('installations.enforceCloudName', () => {
  it('resets a renamed Cloud entry back to the canonical name', async () => {
    const installations = await loadInstallations()
    const cloud = await installations.add({
      name: 'My Renamed Cloud',
      installPath: path.join(tmpRoot, 'cloud'),
      sourceId: installations.CLOUD_SOURCE_ID,
      status: 'installed'
    })
    await installations.enforceCloudName()
    const rec = (await installations.list()).find((r) => r.id === cloud.id)!
    expect(rec.name).toBe(installations.CLOUD_INSTALL_NAME)
  })

  it('leaves a Cloud entry that already has the canonical name untouched', async () => {
    const installations = await loadInstallations()
    const cloud = await installations.add({
      name: installations.CLOUD_INSTALL_NAME,
      installPath: path.join(tmpRoot, 'cloud'),
      sourceId: installations.CLOUD_SOURCE_ID,
      status: 'installed'
    })
    await installations.enforceCloudName()
    const rec = (await installations.list()).find((r) => r.id === cloud.id)!
    expect(rec.name).toBe(installations.CLOUD_INSTALL_NAME)
  })

  it('does not touch non-Cloud installs', async () => {
    const installations = await loadInstallations()
    const local = await installations.add({
      name: 'My Local',
      installPath: path.join(tmpRoot, 'local'),
      sourceId: 'standalone',
      status: 'installed'
    })
    await installations.enforceCloudName()
    const rec = (await installations.list()).find((r) => r.id === local.id)!
    expect(rec.name).toBe('My Local')
  })

  it('is a no-op when there is no Cloud entry', async () => {
    const installations = await loadInstallations()
    await expect(installations.enforceCloudName()).resolves.toBeUndefined()
  })
})

describe('installations.clearPendingTemplateOpen', () => {
  it('clears the one-shot flag once, then is a no-op on the cleared record', async () => {
    const installations = await loadInstallations()
    const entry = await installations.add({
      name: 'With Template',
      installPath: path.join(tmpRoot, 't'),
      sourceId: 'standalone',
      status: 'installed',
      bundledTemplateId: 'flux_schnell',
      pendingTemplateOpen: 'flux_schnell',
      downloadTemplateModels: true
    })

    expect(await installations.clearPendingTemplateOpen(entry.id)).toBe(true)
    expect((await installations.get(entry.id))!.pendingTemplateOpen).toBeNull()
    // Already clear → no second mutation.
    expect(await installations.clearPendingTemplateOpen(entry.id)).toBe(false)
  })

  it('is a no-op for a legacy record with no template fields (migration-safe)', async () => {
    const installations = await loadInstallations()
    const entry = await installations.add({
      name: 'Legacy',
      installPath: path.join(tmpRoot, 'legacy'),
      sourceId: 'standalone',
      status: 'installed'
    })
    expect(entry.pendingTemplateOpen).toBeUndefined()
    expect(entry.bundledTemplateId).toBeUndefined()
    expect(await installations.clearPendingTemplateOpen(entry.id)).toBe(false)
  })

  it('returns false when the install is gone', async () => {
    const installations = await loadInstallations()
    expect(await installations.clearPendingTemplateOpen('does-not-exist')).toBe(false)
  })
})

describe('installations.uniqueName', () => {
  const recs = (...names: string[]): InstallationRecord[] =>
    names.map((name, i) => ({ id: `id-${i}`, name }) as InstallationRecord)

  it('returns the base name unchanged when it is free', async () => {
    const { uniqueName } = await loadInstallations()
    expect(uniqueName('ComfyUI', recs('Other'))).toBe('ComfyUI')
  })

  it('appends " (1)" when the base name is taken', async () => {
    const { uniqueName } = await loadInstallations()
    expect(uniqueName('ComfyUI', recs('ComfyUI'))).toBe('ComfyUI (1)')
  })

  it('finds the next free suffix when lower ones are taken', async () => {
    const { uniqueName } = await loadInstallations()
    expect(uniqueName('ComfyUI', recs('ComfyUI', 'ComfyUI (1)', 'ComfyUI (2)'))).toBe('ComfyUI (3)')
  })

  it('renumbers an already-suffixed name instead of compounding it', async () => {
    const { uniqueName } = await loadInstallations()
    expect(uniqueName('ComfyUI (1)', recs('ComfyUI', 'ComfyUI (1)'))).toBe('ComfyUI (2)')
  })

  it('does not compound even after repeated chaining of the deduped name', async () => {
    const { uniqueName } = await loadInstallations()
    const first = uniqueName('ComfyUI', recs('ComfyUI')) // "ComfyUI (1)"
    // Feeding the deduped name back in while it is now taken must not nest.
    expect(uniqueName(first, recs('ComfyUI', 'ComfyUI (1)'))).toBe('ComfyUI (2)')
  })

  it('preserves an intentional " (N)" name when it is actually free', async () => {
    const { uniqueName } = await loadInstallations()
    expect(uniqueName('ComfyUI (1)', recs('ComfyUI'))).toBe('ComfyUI (1)')
  })

  it('excludes the renamed install from the conflict set', async () => {
    const { uniqueName } = await loadInstallations()
    const existing = recs('ComfyUI') // id-0
    expect(uniqueName('ComfyUI', existing, 'id-0')).toBe('ComfyUI')
  })
})

describe('mutations fail closed when installations.json cannot be recovered (issue #1367)', () => {
  it('serves stale .bak records for reads but rejects mutations', async () => {
    const installations = await loadInstallations()
    const entry = await installations.add({
      name: 'Local A',
      installPath: path.join(tmpRoot, 'a'),
      sourceId: 'standalone',
      status: 'installed'
    })
    const dataPath = path.join(userDataPath, 'installations.json')
    // A stale backup that predates a later rename of the install.
    fs.copyFileSync(dataPath, dataPath + '.bak')

    const realRead = fs.promises.readFile.bind(fs.promises) as typeof fs.promises.readFile
    vi.spyOn(fs.promises, 'readFile').mockImplementation(((
      p: Parameters<typeof fs.promises.readFile>[0],
      opts?: unknown
    ) => {
      if (p === dataPath) {
        const err = new Error('fake EPERM') as NodeJS.ErrnoException
        err.code = 'EPERM' // lock never clears
        return Promise.reject(err)
      }
      return realRead(p, opts as BufferEncoding)
    }) as typeof fs.promises.readFile)

    // Reads degrade to the backup records...
    expect(await installations.list()).toHaveLength(1)
    // ...but a read-modify-write must fail closed: saving a list built from
    // the stale backup would overwrite the newer primary once the lock clears.
    await expect(installations.update(entry.id, { name: 'Renamed' })).rejects.toThrow(
      /cannot be recovered/
    )

    vi.restoreAllMocks()
    const persisted = await installations.get(entry.id)
    expect(persisted!.name).toBe('Local A')
  })

  it('rejects mutations when installations.json is readable but corrupt', async () => {
    const installations = await loadInstallations()
    const entry = await installations.add({
      name: 'Local A',
      installPath: path.join(tmpRoot, 'a'),
      sourceId: 'standalone',
      status: 'installed'
    })
    const dataPath = path.join(userDataPath, 'installations.json')
    // Truncated write / interrupted power cycle: readable, but not JSON.
    const corrupt = fs.readFileSync(dataPath, 'utf-8').slice(0, 20)
    fs.writeFileSync(dataPath, corrupt)
    fs.rmSync(dataPath + '.bak', { force: true })

    // Reads degrade to an empty list...
    expect(await installations.list()).toEqual([])
    // ...but a mutation must not replace the corrupt file with a list built
    // from nothing, losing every prior record.
    await expect(installations.update(entry.id, { name: 'Renamed' })).rejects.toThrow(
      /cannot be recovered/
    )
    expect(fs.readFileSync(dataPath, 'utf-8')).toBe(corrupt)
  })
})
