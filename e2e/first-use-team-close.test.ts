import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { getIpcInvocations } from './support/devHooks'
import { pickFromSetupDropdown, SOURCE_DROPDOWN } from './support/chooserHelpers'
import { FakeCloud } from './support/fakeCloud'

const CLOUD_ENV = ['COMFY_CLOUD_ISSUER', 'COMFY_BUILDER_BASE_URL'] as const

let cloud: FakeCloud
let ctx: AppContext | null = null
let userDataDir: string
let stopBrowser: () => Promise<void> = async () => {}
let inheritedEnv: Record<string, string | undefined>

test.setTimeout(120_000)

test.beforeAll(async () => {
  inheritedEnv = Object.fromEntries(CLOUD_ENV.map((key) => [key, process.env[key]]))
  cloud = new FakeCloud()
  cloud.workspaces.push({ id: 'P', name: 'Personal Workspace', type: 'personal', role: 'owner' })
  cloud.mintBehavior = () => ({ status: 404, body: { code: 'NOT_FOUND' } })
  await cloud.start()
  for (const key of CLOUD_ENV) process.env[key] = cloud.url
  userDataDir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'comfy-first-use-team-e2e-')))
  ctx = await launchApp({ userDataDir, settings: { firstUseCompleted: false } })
  stopBrowser = cloud.completeSignInsLikeABrowser(ctx.app)
})

test.afterAll(async () => {
  await stopBrowser()
  await ctx?.cleanup()
  await cloud?.stop()
  for (const [key, value] of Object.entries(inheritedEnv ?? {})) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
})

test('a team sign-in that cannot reach the Personal workspace returns to Set up with onboarding still pending @real-comfy', async () => {
  if (!ctx) throw new Error('app is not running')
  const { app, panel, titleBar } = ctx

  await panel.waitForVisible('[data-testid="setup-screen"]', { timeout: 15_000 })
  expect(await panel.click('[data-testid="setup-change"]'), 'Change opens before the EULA').toBe(
    true
  )
  await panel.waitForVisible('[data-testid="config-change-form"]', { timeout: 10_000 })
  expect(
    await pickFromSetupDropdown(
      panel,
      SOURCE_DROPDOWN,
      '[data-testid="workspace-install-source-managed"]'
    ),
    "picked Your team's builds"
  ).toBe(true)

  await expect
    .poll(() => cloud.mints.map(({ workspaceId }) => workspaceId), {
      timeout: 30_000,
      message: 'signed in on team A, then tried and failed to switch to the Personal workspace'
    })
    .toContain('P')

  await panel.waitForVisible('[data-testid="setup-screen"]', { timeout: 15_000 })
  await panel.waitForVisible(
    '[data-testid="setup-consent-tos"] [role="checkbox"][aria-checked="false"]',
    { timeout: 5_000 }
  )
  expect(await panel.exists('[data-testid="config-change-form"]')).toBe(false)
  expect(await panel.exists('[data-testid="home-view"]'), 'Home stays locked').toBe(false)
  expect(
    await titleBar.exists('.title-menu-button[aria-haspopup="menu"]'),
    'the title bar menu stays locked'
  ).toBe(false)

  const saves = (await getIpcInvocations(app, 'set-setting')) as Array<{
    key: string
    value: unknown
  }>
  expect(
    saves.filter((save) => save.key === 'firstUseCompleted' && save.value === true),
    'onboarding is not marked complete'
  ).toEqual([])
  const onDisk = JSON.parse(await readFile(path.join(userDataDir, 'settings.json'), 'utf-8')) as {
    firstUseCompleted?: boolean
  }
  expect(onDisk.firstUseCompleted, 'the next launch still starts on Set up').not.toBe(true)
})
