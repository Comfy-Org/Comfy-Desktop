import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '', isPackaged: false },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: {},
  shell: { openPath: vi.fn() },
  net: { request: vi.fn() }
}))

import * as i18n from '../lib/i18n'
import { portable } from './portable'
import { gitSource } from './git'
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
    status: 'installed',
    createdAt: '2026-11-24T00:00:00.000Z',
    distributionId: 'd1',
    distributionName: 'Build 1',
    version: '7'
  }) as unknown as InstallationRecord

const sources: [string, (r: InstallationRecord) => Record<string, unknown>[]][] = [
  ['Portable', (r) => portable.getDetailSections(r)],
  ['Git', (r) => gitSource.getDetailSections(r)],
  ['ComfyBuilder', comfyBuilderDetailSections]
]

beforeAll(() => {
  i18n.init('zh')
})

describe('the build overview location row', () => {
  it.each(sources)(
    'marks the %s location with a key that does not depend on the app language',
    (name, getSections) => {
      const fields = (getSections(record(name.toLowerCase())) as Section[])
        .filter((section) => section.tab === 'status')
        .flatMap((section) => section.fields ?? [])
      const location = fields.find((field) => field.key === 'location')

      expect(location?.value).toBe(installPath)
      expect(location?.label).toBe(i18n.t('common.location'))
      expect(location?.label).not.toBe('Location')
    }
  )
})
