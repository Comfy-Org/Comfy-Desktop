
import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { getReleaseCacheCheckedAt } from './support/devHooks'

const PERIODIC_INTERVAL_MS = 12_000

let ctx: AppContext
let stagedInstallPath = ''

const INSTALL_ID = 'inst-periodic-update-check'

interface FieldOption {
  value: string
  label: string
  data?: { latestVersion?: string }
}
interface DetailField {
  id?: string
  options?: FieldOption[]
}
interface DetailSection {
  tab?: string
  fields?: DetailField[]
}

async function getStableLatestVersion(): Promise<string | undefined> {
  const sections = await ctx.panel.evaluate<DetailSection[]>(
    `window.api.getDetailSections(${JSON.stringify(INSTALL_ID)})`,
  )
  return sections
    .find((s) => s.tab === 'update')
    ?.fields?.find((f) => f.id === 'updateChannel')
    ?.options?.find((o) => o.value === 'stable')
    ?.data?.latestVersion
}

async function getCacheCheckedAt(): Promise<number | null> {
  return await getReleaseCacheCheckedAt(ctx.app, 'Comfy-Org/ComfyUI', 'stable')
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  stagedInstallPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-periodic-update-e2e-'))
  await mkdir(path.join(stagedInstallPath, 'ComfyUI'), { recursive: true })

  process.env['E2E_PERIODIC_RECHECK_MS'] = String(PERIODIC_INTERVAL_MS)
  try {
    ctx = await launchApp({
      settings: { firstUseCompleted: true, telemetryEnabled: false },
      installations: [
        {
          id: INSTALL_ID,
          name: 'Periodic Update Check Test',
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
  } finally {
    delete process.env['E2E_PERIODIC_RECHECK_MS']
  }
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (stagedInstallPath) await rm(stagedInstallPath, { recursive: true, force: true })
})

test('background timer re-fetches the release cache on its interval @lifecycle', async () => {
  test.setTimeout(60_000)

  await expect
    .poll(async () => {
      const v = await getStableLatestVersion()
      return typeof v === 'string' && /v\d+\.\d+/.test(v)
    }, { timeout: 30_000, intervals: [500, 1_000, 2_000] })
    .toBe(true)

  const firstCheckedAt = await getCacheCheckedAt()
  expect(firstCheckedAt, 'cache.stable.checkedAt missing after initial pre-warm').toBeTruthy()

  await new Promise((r) => setTimeout(r, PERIODIC_INTERVAL_MS + 5_000))

  const secondCheckedAt = await getCacheCheckedAt()
  expect(
    secondCheckedAt,
    `periodic timer did not advance checkedAt: initial=${firstCheckedAt}, after one interval+buffer=${secondCheckedAt}`,
  ).toBeGreaterThan(firstCheckedAt!)
})
