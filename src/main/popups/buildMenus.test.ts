import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INFO_CLOSE,
  INFO_FOLDER,
  INFO_SETTINGS,
  SWITCHER_DASHBOARD,
  SWITCHER_MANAGE,
  buildInfoRows,
  buildSwitcherRows
} from './buildMenus'
import type { BuildMenuFacts } from './buildMenus'
import type { InstancePickerInstall } from './titlePopup'

const NOW = Date.UTC(2026, 9, 17, 12)
const MINUTE = 60_000

/** Echo the key and its params, so rows read as which string they use. */
const t = (key: string, params?: Record<string, string | number>): string =>
  params ? `${key}(${Object.values(params).join(',')})` : key

const studio: InstancePickerInstall = {
  id: 'studio',
  name: 'Studio',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  version: 'v0.3.40',
  installPath: path.join(os.homedir(), 'ComfyUI', 'studio'),
  lastLaunchedAt: NOW - 5 * MINUTE
}
const sketch: InstancePickerInstall = {
  id: 'sketch',
  name: 'Sketch',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  installPath: '/Volumes/work/sketch',
  lastLaunchedAt: NOW - 3 * 24 * 60 * MINUTE
}
const cloud: InstancePickerInstall = {
  id: 'cloud',
  name: 'Comfy Cloud',
  sourceLabel: 'Comfy Cloud',
  sourceCategory: 'cloud',
  lastLaunchedAt: NOW - 2 * 60 * MINUTE
}

function facts(overrides: Partial<BuildMenuFacts> = {}): BuildMenuFacts {
  return {
    installs: [studio, sketch, cloud],
    running: new Set(),
    launching: new Set(),
    withWindow: new Set(),
    currentId: null,
    cloudHost: 'cloud.comfy.org',
    ...overrides
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('buildSwitcherRows', () => {
  it('lists open builds, then the rest by last use, between All builds and Manage builds', () => {
    const rows = buildSwitcherRows(facts({ withWindow: new Set(['sketch']) }), t)
    expect(rows.map((r) => r.id ?? r.kind)).toEqual([
      SWITCHER_DASHBOARD,
      'heading',
      'switcher:open:sketch',
      'heading',
      'switcher:open:studio',
      'switcher:open:cloud',
      'separator',
      SWITCHER_MANAGE
    ])
    expect(rows[1]?.label).toBe('titleBar.switcher.open')
    expect(rows[3]?.label).toBe('titleBar.switcher.recent')
  })

  it('leaves out a section with no builds', () => {
    const rows = buildSwitcherRows(facts(), t)
    expect(rows.filter((r) => r.kind === 'heading').map((r) => r.label)).toEqual([
      'titleBar.switcher.recent'
    ])
  })

  it('marks the current build and says when the others were last used', () => {
    const rows = buildSwitcherRows(
      facts({ currentId: 'studio', withWindow: new Set(['studio']) }),
      t
    )
    const current = rows.find((r) => r.id === 'switcher:open:studio')
    const other = rows.find((r) => r.id === 'switcher:open:cloud')
    expect(current).toMatchObject({ checked: true, meta: 'titleBar.switcher.current' })
    expect(other).toMatchObject({ checked: false, meta: 'snapshots.timeHoursAgo(2)' })
  })

  it("shows each build's state as a status dot and a line of text", () => {
    const rows = buildSwitcherRows(
      facts({ running: new Set(['studio']), launching: new Set(['sketch']) }),
      t
    )
    const byId = (id: string) => rows.find((r) => r.id === `switcher:open:${id}`)
    expect(byId('studio')).toMatchObject({ status: 'running', detail: 'chooser.statusRunning' })
    expect(byId('sketch')).toMatchObject({ status: 'busy', detail: 'chooser.statusLaunching' })
    expect(byId('cloud')).toMatchObject({
      status: 'ready',
      icon: 'cloud',
      detail: 'buildsDashboard.status.ready'
    })
  })
})

describe('buildInfoRows', () => {
  it('describes a local build, with its home folder shown as ~, and offers its folder', () => {
    const rows = buildInfoRows(studio, facts({ running: new Set(['studio']) }), t)
    const location = `~${path.sep}ComfyUI${path.sep}studio`
    expect(rows[0]).toMatchObject({
      kind: 'title',
      label: 'Studio',
      status: 'running',
      detail: 'Standalone'
    })
    const infos = rows.filter((r) => r.kind === 'info').map((r) => [r.label, r.meta])
    expect(infos).toEqual([
      ['titleBar.info.status', 'chooser.statusRunning'],
      ['ComfyUI', 'v0.3.40'],
      ['titleBar.info.location', location],
      ['titleBar.info.lastUsed', 'snapshots.timeMinutesAgo(5)']
    ])
    expect(rows.filter((r) => r.id).map((r) => r.id)).toEqual([
      INFO_SETTINGS,
      INFO_FOLDER,
      INFO_CLOSE
    ])
  })

  it('shows a folder beside the home folder in full', () => {
    const sibling = { ...studio, installPath: `${os.homedir()}2${path.sep}studio` }
    const rows = buildInfoRows(sibling, facts(), t)
    expect(rows.find((r) => r.label === 'titleBar.info.location')?.meta).toBe(sibling.installPath)
  })

  it("gives a Cloud build Comfy Cloud's host as its location and no folder to open", () => {
    const rows = buildInfoRows(cloud, facts(), t)
    expect(rows.find((r) => r.label === 'titleBar.info.location')?.meta).toBe('cloud.comfy.org')
    expect(rows.some((r) => r.id === INFO_FOLDER)).toBe(false)
    expect(rows.some((r) => r.label === 'ComfyUI')).toBe(false)
  })

  it("gives a remote build its server as its location, not the source's name", () => {
    const remote = {
      id: 'r',
      name: 'Render box',
      sourceLabel: 'Remote Connection',
      sourceCategory: 'remote',
      remoteUrl: 'https://render.local:8188'
    } as InstancePickerInstall
    const rows = buildInfoRows(remote, facts({ installs: [remote] }), t)
    expect(rows.find((r) => r.label === 'titleBar.info.location')?.meta).toBe('render.local:8188')
  })

  it('names an available update', () => {
    const rows = buildInfoRows(
      { ...sketch, statusTag: { style: 'update', label: 'v0.3.41 available' } },
      facts(),
      t
    )
    expect(rows.find((r) => r.label === 'titleBar.info.update')?.meta).toBe('v0.3.41 available')
  })

  it('shows a date for a build last used over a month ago, and nothing for one never used', () => {
    const old = { ...sketch, lastLaunchedAt: NOW - 45 * 24 * 60 * MINUTE }
    const used = buildInfoRows(old, facts(), t).find((r) => r.label === 'titleBar.info.lastUsed')
    expect(used?.meta).toBe(new Date(old.lastLaunchedAt).toLocaleDateString())
    const never = buildInfoRows({ ...sketch, lastLaunchedAt: undefined }, facts(), t)
    expect(never.some((r) => r.label === 'titleBar.info.lastUsed')).toBe(false)
  })
})
