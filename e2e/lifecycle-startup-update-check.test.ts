
import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'

let ctx: AppContext
let stagedInstallPath = ''

const INSTALL_ID = 'inst-startup-update-check'
const INSTALL_NAME = 'Startup Update Check Test'

interface FieldOption {
  value: string
  label: string
  data?: { latestVersion?: string; updateAvailable?: boolean }
}

interface DetailField {
  id?: string
  value?: unknown
  options?: FieldOption[]
}

interface DetailSection {
  tab?: string
  fields?: DetailField[]
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  stagedInstallPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-startup-update-e2e-'))
  await mkdir(path.join(stagedInstallPath, 'ComfyUI'), { recursive: true })

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: INSTALL_ID,
        name: INSTALL_NAME,
        installPath: stagedInstallPath,
        sourceId: 'standalone',
        status: 'installed',
        updateChannel: 'stable',
        comfyVersion: { commit: 'a'.repeat(40), baseTag: 'v0.1.0', commitsAhead: 0 },
        releaseTag: 'v0.1.0',
        variant: 'cpu',
        pythonVersion: '3.12',
      },
    ],
  })
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (stagedInstallPath) await rm(stagedInstallPath, { recursive: true, force: true })
})

test('startup pre-warm fills the release cache without any UI gesture @lifecycle', async () => {
  test.setTimeout(60_000)

  await expect
    .poll(async () => {
      const sections = await ctx.panel.evaluate<DetailSection[]>(
        `window.api.getDetailSections(${JSON.stringify(INSTALL_ID)})`,
      )
      const updateSection = sections.find((s) => s.tab === 'update')
      const channelField = updateSection?.fields?.find((f) => f.id === 'updateChannel')
      const stableCard = channelField?.options?.find((o) => o.value === 'stable')
      const data = stableCard?.data
      return !!data && typeof data.latestVersion === 'string' && /v\d+\.\d+/.test(data.latestVersion)
    }, { timeout: 30_000, intervals: [500, 1_000, 2_000] })
    .toBe(true)

  const sections = await ctx.panel.evaluate<DetailSection[]>(
    `window.api.getDetailSections(${JSON.stringify(INSTALL_ID)})`,
  )
  const stableCard = sections
    .find((s) => s.tab === 'update')!
    .fields!.find((f) => f.id === 'updateChannel')!
    .options!.find((o) => o.value === 'stable')!
  expect(
    stableCard.data?.updateAvailable,
    'startup pre-warm fetched releases but isUpdateAvailable still false',
  ).toBe(true)
})
