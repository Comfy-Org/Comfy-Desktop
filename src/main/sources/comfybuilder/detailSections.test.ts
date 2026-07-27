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
import { clearVersionCache, setCachedVersions } from '../../devplatform/versionCache'
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

beforeEach(() => clearVersionCache())

describe('comfybuilder.getDetailSections', () => {
  it('surfaces the tabs a distribution install should have', () => {
    const tabs = tabsOf(sectionsFor(record()))
    expect(tabs).toContain('status')
    expect(tabs).toContain('settings')
    expect(tabs).toContain('storage')
    expect(tabs).toContain('update')
  })

  it('declares NO snapshots section, which is what hides the tab', () => {
    // Snapshots are admin/owner only (Jul 24 dev-platform standup). A tab
    // appears iff a section declares it, so this absence IS the policy gate —
    // copying another source's sections wholesale would silently re-open it.
    expect(tabsOf(sectionsFor(record()))).not.toContain('snapshots')
  })

  it('offers no shared-model storage toggles', () => {
    // Each distribution carries its own allowed model list; shared models are
    // off for distributions in MVP.
    const storage = sectionsFor(record()).find((s) => s.tab === 'storage')
    expect(storage).toBeDefined()
    expect(fieldIds(storage)).not.toContain('useSharedModels')
    expect(fieldIds(storage)).not.toContain('useSharedInputOutput')
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

  it('omits the published-version list until the catalog has been read', () => {
    // "No versions found" is a different claim from "not looked yet".
    const update = sectionsFor(record()).find((s) => s.tab === 'update')
    expect(fieldIds(update)).not.toContain('latest-distribution-version')
    expect(fieldIds(update)).not.toContain('published-distribution-versions')
    expect((update?.actions ?? []).map((a) => a.id)).toContain('check-update')
  })

  it('states installed and latest as bare versions once the cache is warm', () => {
    setCachedVersions('d1', [3, 7, 9])
    const update = sectionsFor(record({ version: '7' })).find((s) => s.tab === 'update')
    const fields = update?.fields ?? []
    expect(fields.find((f) => f.key === 'current-distribution-version')?.value).toBe('v7')
    expect(fields.find((f) => f.key === 'latest-distribution-version')?.value).toBe('v9')
    // Newest first, whatever order the catalog returned.
    expect(fields.find((f) => f.key === 'published-distribution-versions')?.value).toBe(
      'v9 · v7 · v3',
    )
  })

  it('shows installed and latest as equal when already on the newest version', () => {
    setCachedVersions('d1', [7, 3])
    const fields =
      sectionsFor(record({ version: '7' })).find((s) => s.tab === 'update')?.fields ?? []
    expect(fields.find((f) => f.key === 'current-distribution-version')?.value).toBe('v7')
    expect(fields.find((f) => f.key === 'latest-distribution-version')?.value).toBe('v7')
  })

  it('dedupes repeated versions from the catalog', () => {
    setCachedVersions('d1', [5, 5, 2])
    const fields =
      sectionsFor(record({ version: '5' })).find((s) => s.tab === 'update')?.fields ?? []
    expect(fields.find((f) => f.key === 'published-distribution-versions')?.value).toBe('v5 · v2')
  })

  it('drops the update tab for a record with no distribution link', () => {
    const tabs = tabsOf(sectionsFor(record({ distributionId: undefined })))
    expect(tabs).not.toContain('update')
    // The rest of the manage view still stands.
    expect(tabs).toContain('settings')
  })
})
