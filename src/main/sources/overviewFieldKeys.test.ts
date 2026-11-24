import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '', isPackaged: false },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: {},
  shell: { openPath: vi.fn() },
  net: { request: vi.fn() }
}))

vi.mock('../lib/i18n', async () => {
  const { translateMessage } = await import('../lib/localeTestHelper')
  return {
    t: (key: string, params?: Record<string, string | number>) =>
      translateMessage('zh', key, params)
  }
})

import { translateMessage } from '../lib/localeTestHelper'
import { portable } from './portable'
import { gitSource } from './git'
import { desktop } from './desktop'
import { getDetailSections as comfyBuilderDetailSections } from './comfybuilder/detailSections'
import type { InstallationRecord } from '../installations'

type Field = { key?: string; label?: string; value?: unknown }
type Section = { tab?: string; fields?: Field[] }

const installPath = '/installs/build-1'

const record = (sourceId: string): InstallationRecord =>
  ({
    id: 'build-1',
    name: 'Build 1',
    sourceId,
    sourceLabel: sourceId,
    installPath,
    desktopExePath: '/Applications/ComfyUI.app',
    status: 'installed',
    createdAt: '2026-11-24T00:00:00.000Z',
    distributionId: 'd1',
    distributionName: 'Build 1',
    version: '7'
  }) as unknown as InstallationRecord

const sources: [string, (r: InstallationRecord) => Record<string, unknown>[]][] = [
  ['Portable', (r) => portable.getDetailSections(r)],
  ['Git', (r) => gitSource.getDetailSections(r)],
  ['ComfyBuilder', comfyBuilderDetailSections],
  ['Legacy Desktop', (r) => desktop.getDetailSections(r)]
]

function statusField(
  name: string,
  getSections: (r: InstallationRecord) => Record<string, unknown>[],
  key: string
): Field | undefined {
  return (getSections(record(name.toLowerCase())) as Section[])
    .filter((section) => section.tab === 'status')
    .flatMap((section) => section.fields ?? [])
    .find((field) => field.key === key)
}

describe('the build overview rows found by key, in any app language', () => {
  it.each(sources)('marks the %s location row', (name, getSections) => {
    const location = statusField(name, getSections, 'location')

    expect(location?.value).toBe(installPath)
    expect(location?.label).toMatch(/位置|路径/)
  })

  it.each(sources)('marks the %s install method row', (name, getSections) => {
    const installMethod = statusField(name, getSections, 'install-method')

    expect(installMethod?.label).toBe(translateMessage('zh', 'common.installMethod'))
    expect(installMethod?.label).toBe('安装方式')
  })
})
