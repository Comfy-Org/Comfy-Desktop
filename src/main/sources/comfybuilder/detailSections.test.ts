// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '', isPackaged: false },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: {},
  shell: { openPath: vi.fn() },
  net: { request: vi.fn() },
}))

import { getDetailSections } from './detailSections'
import {
  clearVersionCache,
  getCachedVersions,
  setCachedVersions,
} from '../../devplatform/versionCache'
import type { InstallationRecord } from '../../installations'

const record = (overrides: Record<string, unknown> = {}): InstallationRecord =>
  ({
    id: 'i1',
    name: 'Studio Render Pipeline',
    sourceId: 'comfybuilder',
    sourceLabel: 'Comfy Builder',
    installPath: '/installs/studio',
    status: 'installed',
    distributionId: 'd1',
    distributionName: 'Studio Render Pipeline',
    version: '7',
    ...overrides,
  }) as unknown as InstallationRecord

type Section = {
  tab?: string
  title?: string
  pinBottom?: boolean
  fields?: Record<string, unknown>[]
  actions?: Record<string, unknown>[]
}

const sectionsFor = (inst: InstallationRecord): Section[] =>
  getDetailSections(inst) as unknown as Section[]

const tabsOf = (s: Section[]): string[] => s.map((x) => x.tab).filter(Boolean) as string[]

const fieldIds = (s: Section | undefined): string[] =>
  (s?.fields ?? []).map((f) => (f.id ?? f.key) as string).filter(Boolean)

type StatRow = { id: string; label: string; value: string; highlight?: boolean }
type StatsValue = { headline: string; headlineHighlight: boolean; badge: string | null; rows: StatRow[] }

const statsField = (inst: InstallationRecord): Record<string, unknown> | undefined =>
  (sectionsFor(inst).find((s) => s.tab === 'update')?.fields ?? []).find(
    (f) => f.editType === 'version-stats',
  )

const statsValue = (inst: InstallationRecord): StatsValue =>
  (statsField(inst)?.value ?? { rows: [] }) as StatsValue

const rowIds = (inst: InstallationRecord): string[] => statsValue(inst).rows.map((r) => r.id)

const updateActions = (inst: InstallationRecord): Record<string, unknown>[] =>
  (sectionsFor(inst).find((s) => s.tab === 'update')?.actions ?? []) as Record<string, unknown>[]


beforeEach(() => clearVersionCache())

describe('comfybuilder.getDetailSections', () => {
  it('surfaces the tabs a distribution install should have', () => {
    const tabs = tabsOf(sectionsFor(record()))
    expect(tabs).toContain('status')
    expect(tabs).toContain('settings')
    expect(tabs).toContain('update')
  })

  it('declares NO snapshots section, which is what hides the tab', () => {
    // Snapshots are admin/owner only (Jul 24 dev-platform standup). A tab
    // appears iff a section declares it, so this absence IS the policy gate —
    // copying another source's sections wholesale would silently re-open it.
    expect(tabsOf(sectionsFor(record()))).not.toContain('snapshots')
  })

  it('declares NO storage section, because a reduced one shows shared models', () => {
    // Shared models are off for distributions at MVP — each carries its own
    // allowed list. Declaring a storage section with the toggles omitted does
    // NOT achieve that: StoragePane reads an absent `useSharedModels` as
    // enabled (`f ? f.value !== false : true`) and renders the global
    // shared-models directory list. Declaring it `false` is no better, since
    // BooleanToggle ignores `editable` and would render a live switch.
    expect(tabsOf(sectionsFor(record()))).not.toContain('storage')
  })

  it('keeps startup arguments editable', () => {
    const settings = sectionsFor(record()).find((s) => s.tab === 'settings')
    const args = (settings?.fields ?? []).find((f) => f.id === 'launchArgs')
    expect(args).toBeDefined()
    expect(args?.editable).toBe(true)
  })

  it('labels the distribution version apart from the ComfyUI version', () => {
    // A bare "7" in a slot every other install fills with "v0.28.2" reads as a
    // ComfyUI version and is not one.
    const status = sectionsFor(record()).find((s) => s.tab === 'status')
    const ids = fieldIds(status)
    expect(ids).toContain('distribution-version')
    expect(ids).toContain('comfyui-version')
    const distField = (status?.fields ?? []).find((f) => f.key === 'distribution-version')
    expect(distField?.value).toBe('v7')
  })

  it('pins launch/rename/open-folder/remove/delete, all session-dispatched ids', () => {
    const pinned = sectionsFor(record()).find((s) => s.pinBottom === true)
    const ids = (pinned?.actions ?? []).map((a) => a.id)
    expect(ids).toEqual(
      expect.arrayContaining(['launch', 'rename', 'open-folder', 'remove', 'delete']),
    )
  })

  it('renders the update tab as a version-stats table, like a local install', () => {
    // Same component the local-install Update tab uses, so the two read as one
    // surface rather than merely saying the same words.
    setCachedVersions('d1', [3, 7, 9])
    const field = statsField(record({ version: '7' }))
    expect(field?.editType).toBe('version-stats')
    expect(field?.editable).toBe(false)
  })

  it('omits the published-version list until the catalog has been read', () => {
    // "No versions found" is a different claim from "not looked yet".
    const update = sectionsFor(record()).find((s) => s.tab === 'update')
    expect(rowIds(record())).not.toContain('latest')
    expect(rowIds(record())).not.toContain('published')
    expect((update?.actions ?? []).map((a) => a.id)).toContain('check-update')
  })

  it('states installed and latest as bare versions once the cache is warm', () => {
    // Newest wins whatever order the catalog returned.
    setCachedVersions('d1', [3, 7, 9])
    const rows = statsValue(record({ version: '7' })).rows
    expect(rows.find((r) => r.id === 'installed')?.value).toBe('v7')
    expect(rows.find((r) => r.id === 'latest')?.value).toBe('v9')
  })

  it('offers the update action only when a newer version exists', () => {
    // An always-present Update that no-ops on the newest version teaches the
    // user to distrust it.
    setCachedVersions('d1', [3, 7, 9])
    const behind = updateActions(record({ version: '7' }))
    const update = behind.find((a) => a.id === 'update-distribution')
    expect(update).toBeDefined()
    expect(update?.data).toEqual({ version: 9 })
    expect(update?.showProgress).toBe(true)
    expect(update?.confirm).toBeDefined()

    setCachedVersions('d1', [7, 3])
    expect(
      updateActions(record({ version: '7' })).find((a) => a.id === 'update-distribution'),
    ).toBeUndefined()
  })

  it('offers no update when the installed version is unknown', () => {
    // `Number('')` is 0, which would read as "behind everything" and offer an
    // update from a blank version.
    setCachedVersions('d1', [9, 7])
    const blank = record({ version: '' })
    expect(updateActions(blank).find((a) => a.id === 'update-distribution')).toBeUndefined()
    expect(statsValue(blank).headlineHighlight).toBe(false)
  })

  it('disables the update action while the install is not ready', () => {
    setCachedVersions('d1', [9, 7])
    const update = updateActions(record({ version: '7', status: 'failed' })).find(
      (a) => a.id === 'update-distribution',
    )
    expect(update?.enabled).toBe(false)
  })

  it('accents the latest row and the headline only when an update is waiting', () => {
    setCachedVersions('d1', [3, 7, 9])
    const behind = statsValue(record({ version: '7' }))
    expect(behind.headlineHighlight).toBe(true)
    expect(behind.rows.find((r) => r.id === 'latest')?.highlight).toBe(true)

    setCachedVersions('d1', [7, 3])
    const current = statsValue(record({ version: '7' }))
    expect(current.headlineHighlight).toBe(false)
    expect(current.rows.find((r) => r.id === 'latest')?.highlight).toBe(false)
  })

  it('shows installed and latest as equal when already on the newest version', () => {
    setCachedVersions('d1', [7, 3])
    const rows = statsValue(record({ version: '7' })).rows
    expect(rows.find((r) => r.id === 'installed')?.value).toBe('v7')
    expect(rows.find((r) => r.id === 'latest')?.value).toBe('v7')
  })

  it('dedupes repeated versions from the catalog', () => {
    setCachedVersions('d1', [5, 5, 2, 5])
    expect(getCachedVersions('d1')?.versions).toEqual([5, 2])
  })

  it('drops the update tab for a record with no distribution link', () => {
    const tabs = tabsOf(sectionsFor(record({ distributionId: undefined })))
    expect(tabs).not.toContain('update')
    // The rest of the manage view still stands.
    expect(tabs).toContain('settings')
  })
})
