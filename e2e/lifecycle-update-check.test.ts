import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { closeTitlePopupIfOpen, titlePopupPage, waitForWebContents } from './support/cdpPages'
import { ageReleaseCache, getIpcInvocations, resetIpcInvocations } from './support/devHooks'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let stagedInstallPath = ''
let stagedInstallPathB = ''

const INSTALL_ID = 'inst-update-check'
const INSTALL_NAME = 'Update Check Test'
const INSTALL_ID_B = 'inst-update-check-b'
const INSTALL_NAME_B = 'Update Check Test B'
const SEEDED_BASE_TAG = 'v0.1.0'
const SEEDED_COMMIT = 'a'.repeat(40)

interface FieldOption {
  value: string
  label: string
  data?: {
    installedVersion: string
    latestVersion: string
    lastChecked: string
    updateAvailable: boolean
  }
}

interface DetailField {
  id?: string
  label?: string
  value?: unknown
  options?: FieldOption[]
}

interface DetailSection {
  tab?: string
  title?: string
  fields?: DetailField[]
  actions?: unknown[]
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  stagedInstallPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-update-check-e2e-'))
  stagedInstallPathB = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-update-check-e2e-b-'))
  await mkdir(path.join(stagedInstallPath, 'ComfyUI'), { recursive: true })
  await mkdir(path.join(stagedInstallPathB, 'ComfyUI'), { recursive: true })

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
        comfyVersion: { commit: SEEDED_COMMIT, baseTag: SEEDED_BASE_TAG, commitsAhead: 0 },
        releaseTag: SEEDED_BASE_TAG,
        variant: 'cpu',
        pythonVersion: '3.12'
      },
      {
        id: INSTALL_ID_B,
        name: INSTALL_NAME_B,
        installPath: stagedInstallPathB,
        sourceId: 'standalone',
        status: 'installed',
        updateChannel: 'stable',
        comfyVersion: { commit: SEEDED_COMMIT, baseTag: SEEDED_BASE_TAG, commitsAhead: 0 },
        releaseTag: SEEDED_BASE_TAG,
        variant: 'cpu',
        pythonVersion: '3.12'
      }
    ]
  })
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (stagedInstallPath) await rm(stagedInstallPath, { recursive: true, force: true })
  if (stagedInstallPathB) await rm(stagedInstallPathB, { recursive: true, force: true })
})

async function getChannelField(installationId: string): Promise<DetailField> {
  const sections = await ctx.panel.evaluate<DetailSection[]>(
    `window.api.getDetailSections(${JSON.stringify(installationId)})`
  )
  const updateSection = sections.find((s) => s.tab === 'update')
  expect(updateSection, 'no update section in detail sections').toBeDefined()
  const channelField = updateSection!.fields!.find((f) => f.id === 'updateChannel')
  expect(channelField?.options, 'update channel field missing options').toBeDefined()
  return channelField!
}

test('check-update hits the real Comfy-Org/ComfyUI remote and finds a newer release @lifecycle', async () => {
  await openPickerOnUpdateTab(INSTALL_ID)
  const popup = titlePopupPage(ctx.app)

  const checkButton = byTestId(TID.updateActionButton('check-update'))
  await popup.waitForVisible(checkButton, { timeout: 15_000 })
  const waitForCheckButtonEnabled = (message: string): Promise<void> =>
    popup.waitFor(
      () =>
        popup.evaluate<boolean>(
          `(() => { const el = document.querySelector('${checkButton}'); return !!el && !el.disabled })()`
        ),
      { timeout: 30_000, message }
    )
  await waitForCheckButtonEnabled('check-update button never became enabled')
  await resetIpcInvocations(ctx.app, 'run-action')
  expect(await popup.click(checkButton)).toBe(true)

  await expect
    .poll(
      async () =>
        countAutoCheckUpdateCalls(await getIpcInvocations(ctx.app, 'run-action'), INSTALL_ID),
      { timeout: 10_000, intervals: [200, 500] }
    )
    .toBeGreaterThanOrEqual(1)
  await waitForCheckButtonEnabled('check-update button never re-enabled after the manual check')

  await expect
    .poll(
      async () => {
        const channelField = await getChannelField(INSTALL_ID)
        const stableCard = channelField.options!.find((o) => o.value === 'stable')
        return stableCard?.data?.latestVersion ?? ''
      },
      { timeout: 30_000, intervals: [250, 500, 1_000] }
    )
    .toMatch(/v\d+\.\d+/)

  const channelField = await getChannelField(INSTALL_ID)
  const stableCard = channelField.options!.find((o) => o.value === 'stable')
  expect(
    stableCard!.data!.updateAvailable,
    `stable card did not flag update available against seeded baseTag ${SEEDED_BASE_TAG}; got latestVersion=${stableCard!.data!.latestVersion}`
  ).toBe(true)

  await closeTitlePopupIfOpen(ctx.app)
})

test('cross-channel fetch populates the latest channel card too @lifecycle', async () => {
  const sections = await ctx.panel.evaluate<DetailSection[]>(
    `window.api.getDetailSections(${JSON.stringify(INSTALL_ID)})`
  )
  const updateSection = sections.find((s) => s.tab === 'update')!
  const channelField = updateSection.fields!.find((f) => f.id === 'updateChannel')!
  const latestCard = channelField.options!.find((o) => o.value === 'latest')
  expect(
    latestCard?.data,
    'latest channel card has no data — cross-channel prefetch did not run'
  ).toBeDefined()
  expect(latestCard!.data!.latestVersion).toMatch(/[a-f0-9]{7,}/)
})

async function openPickerOnUpdateTab(installationId: string): Promise<void> {
  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(installationId)},
        initialTab: 'update',
      })
      return true
    })()`
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
}

async function clickToUpdateTab(installationId: string): Promise<void> {
  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(installationId)},
        initialTab: 'settings',
      })
      return true
    })()`
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  const updateTab = byTestId(TID.settingsTab('update'))
  await popup.waitForVisible(updateTab, { timeout: 15_000 })
  expect(await popup.click(updateTab)).toBe(true)
}

function countAutoCheckUpdateCalls(calls: unknown[], installationId: string): number {
  return (calls as { installationId?: string; actionId?: string }[]).filter(
    (c) => c.installationId === installationId && c.actionId === 'check-update'
  ).length
}

test('Update tab does NOT auto-refresh when the channel data is fresh @lifecycle', async () => {
  await resetIpcInvocations(ctx.app, 'run-action')

  await clickToUpdateTab(INSTALL_ID)

  await new Promise((r) => setTimeout(r, 1500))

  const checkUpdates = countAutoCheckUpdateCalls(
    await getIpcInvocations(ctx.app, 'run-action'),
    INSTALL_ID
  )
  expect(
    checkUpdates,
    `auto-refresh fired ${checkUpdates}x against fresh cache — expected 0 (dedupe broken)`
  ).toBe(0)

  await closeTitlePopupIfOpen(ctx.app)
})

test('Update tab auto-refreshes when channel data is stale @lifecycle', async () => {
  test.setTimeout(120_000)

  const stalenessTs = Date.now() - 30 * 60 * 1000
  await ageReleaseCache(ctx.app, stalenessTs)

  const staleSections = await ctx.panel.evaluate<DetailSection[]>(
    `window.api.getDetailSections(${JSON.stringify(INSTALL_ID_B)})`
  )
  const staleUpdateSection = staleSections.find((s) => s.tab === 'update')!
  const staleChannelField = staleUpdateSection.fields!.find((f) => f.id === 'updateChannel')!
  const staleCard = staleChannelField.options!.find((o) => o.value === staleChannelField.value)
  expect(
    (staleCard?.data as { lastCheckedAt?: number } | undefined)?.lastCheckedAt,
    'ageReleaseCache hook did not mutate the in-memory map main reads from'
  ).toBe(stalenessTs)

  await resetIpcInvocations(ctx.app, 'run-action')

  await clickToUpdateTab(INSTALL_ID_B)

  await expect
    .poll(
      async () =>
        countAutoCheckUpdateCalls(await getIpcInvocations(ctx.app, 'run-action'), INSTALL_ID_B),
      { timeout: 15_000, intervals: [250, 500, 1_000] }
    )
    .toBeGreaterThanOrEqual(1)

  await expect
    .poll(
      async () => {
        const sections = await ctx.panel.evaluate<DetailSection[]>(
          `window.api.getDetailSections(${JSON.stringify(INSTALL_ID_B)})`
        )
        const updateSection = sections.find((s) => s.tab === 'update')!
        const channelField = updateSection.fields!.find((f) => f.id === 'updateChannel')!
        const card = channelField.options!.find((o) => o.value === channelField.value)
        const checkedAt = (card?.data as { lastCheckedAt?: number } | undefined)?.lastCheckedAt
        return typeof checkedAt === 'number' && checkedAt > stalenessTs
      },
      { timeout: 15_000, intervals: [250, 500, 1_000] }
    )
    .toBe(true)

  await closeTitlePopupIfOpen(ctx.app)
})
