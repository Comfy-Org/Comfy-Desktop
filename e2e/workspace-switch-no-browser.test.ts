import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import en from '../locales/en.json'
import { launchApp, type AppContext } from './launchApp'
import { getShellOpenExternalCalls } from './support/devHooks'
import { FakeCloud, type FakeReply } from './support/fakeCloud'
import { captureHostWindow } from './support/windowCapture'

const UNAVAILABLE_COPY = en.devPlatform.workspace.switchUnavailable
const RETRYABLE_COPY = en.devPlatform.workspace.switchRetryable
const FAILURE_CAPTION = '[data-testid="chooser-workspace-switch-failure"]'
const SELECTOR = '[data-testid="devplatform-workspace-selector"]'
const REFRESH = '[data-testid="chooser-workspace-refresh"]'
const SIGN_IN = '[data-testid="devplatform-account-signin"]'
const SETTLE_MS = 1_500
const AUTH_VAULT = 'comfy-cloud-auth.bin'

let cloud: FakeCloud
let ctx: AppContext | null = null
let userDataDir: string
let browserOpens: string[]
let stopBrowser: () => Promise<void> = async () => {}
let inheritedEnv: Record<string, string | undefined>

function panel(): AppContext['panel'] {
  if (!ctx) throw new Error('app is not running')
  return ctx.panel
}

function playBrowser(app: AppContext['app']): () => Promise<void> {
  let handled = 0
  let stopped = false
  const loop = (async () => {
    while (!stopped) {
      const calls = await getShellOpenExternalCalls(app).catch(() => [] as string[])
      for (const url of calls.slice(handled)) {
        handled += 1
        browserOpens.push(url)
        await fetch(url).catch(() => {})
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  })()
  return async () => {
    stopped = true
    await loop
  }
}

async function launch(settings: Record<string, unknown> = { firstUseCompleted: true }) {
  ctx = await launchApp({ userDataDir, settings })
  const actual = await ctx.app.evaluate(({ app }) => app.getPath('userData'))
  expect(await realpath(actual), 'the run stays off the real profile').toBe(userDataDir)
  stopBrowser = playBrowser(ctx.app)
}

async function quit(): Promise<void> {
  await stopBrowser()
  stopBrowser = async () => {}
  await ctx?.cleanup()
  ctx = null
}

async function shot(name: string): Promise<void> {
  const dir = process.env['E2E_SHOTS_DIR']
  if (!dir || !ctx) return
  await mkdir(dir, { recursive: true })
  await captureHostWindow(ctx.app, ctx.panel, path.join(dir, `${name}.png`))
}

function activeWorkspace(): Promise<string | undefined> {
  return panel().evaluate<string | undefined>(
    'window.api.comfybuilder.getAuthStatus().then((status) => status.workspaceId)'
  )
}

async function expectActive(workspaceId: string): Promise<void> {
  await expect.poll(activeWorkspace, { timeout: 15_000 }).toBe(workspaceId)
}

async function expectSelected(workspaceId: string): Promise<void> {
  await expect
    .poll(() => panel().textOf(`${SELECTOR} .workspace-selector__name`), { timeout: 15_000 })
    .toBe(`Workspace ${workspaceId}`)
}

async function expectBuildsFrom(workspaceId: string): Promise<void> {
  await expect.poll(() => cloud.builds.at(-1)?.workspace, { timeout: 15_000 }).toBe(workspaceId)
}

async function select(workspaceId: string): Promise<void> {
  const item = `[data-testid="devplatform-workspace-${workspaceId}"]`
  await panel().waitForVisible(SELECTOR)
  await panel().clickUntilVisible(SELECTOR, item)
  expect(await panel().click(item), `selected ${workspaceId}`).toBe(true)
}

async function expectCaption(copy: string): Promise<void> {
  await expect.poll(() => panel().textOf(FAILURE_CAPTION), { timeout: 15_000 }).toBe(copy)
}

async function expectNoCaption(): Promise<void> {
  await expect.poll(() => panel().exists(FAILURE_CAPTION), { timeout: 15_000 }).toBe(false)
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
}

async function signInOnFreshProfile(): Promise<void> {
  await launch()
  await panel().waitForVisible(SIGN_IN)
  expect(await panel().click(SIGN_IN), 'clicked sign in').toBe(true)
  await expectActive('A')
  await expectBuildsFrom('A')
  await expectSelected('A')
  expect(browserOpens).toHaveLength(1)
}

function consecutive<T>(values: T[]): T[] {
  return values.filter((value, index) => value !== values[index - 1])
}

test.setTimeout(120_000)

test.beforeAll(() => {
  inheritedEnv = {
    COMFY_CLOUD_ISSUER: process.env['COMFY_CLOUD_ISSUER'],
    COMFY_BUILDER_BASE_URL: process.env['COMFY_BUILDER_BASE_URL']
  }
})

test.afterAll(() => {
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test.beforeEach(async () => {
  cloud = new FakeCloud()
  await cloud.start()
  process.env['COMFY_CLOUD_ISSUER'] = cloud.url
  process.env['COMFY_BUILDER_BASE_URL'] = cloud.url
  userDataDir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'comfy-workspace-switch-e2e-')))
  browserOpens = []
})

test.afterEach(async () => {
  await quit()
  await cloud.stop()
  await rm(userDataDir, { recursive: true, force: true })
})

test('T-V1: sign in once, switch A to B to C to A with no further browser, and restore B after a relaunch @macos @windows', async () => {
  await launch()
  await panel().waitForVisible(SIGN_IN)
  await shot('01-signed-out')
  expect(await panel().click(SIGN_IN), 'clicked sign in').toBe(true)
  await expectActive('A')
  await expectBuildsFrom('A')
  await expectSelected('A')
  await shot('02-signed-in-on-A')

  await select('B')
  await expectActive('B')
  await expectBuildsFrom('B')
  await expectSelected('B')
  await shot('03-switched-to-B')

  await select('C')
  await expectActive('C')
  await expectBuildsFrom('C')
  await expectSelected('C')
  await shot('04-switched-to-C')

  await select('A')
  await expectActive('A')
  await expectBuildsFrom('A')
  await expectSelected('A')
  await settle()
  await shot('05-back-on-A')

  expect(browserOpens, 'one browser for the whole session').toHaveLength(1)
  expect(cloud.authorizeUrls, 'one consent for the whole session').toHaveLength(1)
  expect(cloud.mints).toEqual([
    { workspaceId: 'B', bearerWorkspace: 'A' },
    { workspaceId: 'C', bearerWorkspace: 'A' }
  ])
  expect(consecutive(cloud.builds.map(({ workspace }) => workspace))).toEqual(['A', 'B', 'C', 'A'])
  expect(
    cloud.builds.filter(({ workspace }) => workspace !== 'A').some(({ canMint }) => canMint),
    'B and C builds calls carried minted tokens, not the grant'
  ).toBe(false)

  await select('B')
  await expectActive('B')
  const settingsPath = path.join(userDataDir, 'settings.json')
  await expect
    .poll(async () => {
      const raw = await readFile(settingsPath, 'utf-8')
      return (JSON.parse(raw) as { dashboardWorkspaceId?: string }).dashboardWorkspaceId
    })
    .toBe('B')
  expect(browserOpens, 'returning to a cached workspace takes no browser').toHaveLength(1)
  expect(cloud.authorizeUrls, 'returning to a cached workspace takes no consent').toHaveLength(1)
  await quit()

  const vault = path.join(userDataDir, AUTH_VAULT)
  expect(existsSync(vault), 'the vault is on disk').toBe(true)
  expect(await readFile(vault, 'utf-8'), 'the vault is encrypted').not.toContain('refresh-')
  const mintsBefore = cloud.mints.length
  const authorizeBefore = cloud.authorizeUrls.length
  browserOpens = []
  cloud.builds.length = 0

  await launch(JSON.parse(await readFile(settingsPath, 'utf-8')) as Record<string, unknown>)
  await expectActive('B')
  await expectSelected('B')
  await expectBuildsFrom('B')
  await settle()
  await shot('06-relaunched-on-B')

  expect(browserOpens, 'a relaunch opens no browser').toEqual([])
  expect(cloud.authorizeUrls).toHaveLength(authorizeBefore)
  expect(cloud.mints).toHaveLength(mintsBefore)
})

test('T-V2: a non-member 404 opens no browser, shows the unavailable caption and stays put @macos @windows', async () => {
  await signInOnFreshProfile()
  cloud.mintBehavior = () => ({ status: 404, body: { code: 'NOT_FOUND' } })

  await select('B')
  await expectCaption(UNAVAILABLE_COPY)
  await settle()
  await shot('07-unavailable-caption')

  expect(await activeWorkspace()).toBe('A')
  expect(browserOpens).toHaveLength(1)
  expect(cloud.authorizeUrls).toHaveLength(1)
  expect(cloud.mints).toEqual([{ workspaceId: 'B', bearerWorkspace: 'A' }])
})

test('T-V4: sso_required opens exactly one more browser carrying B, then B is active @macos @windows', async () => {
  await signInOnFreshProfile()
  cloud.mintBehavior = (workspaceId, bearerWorkspace) =>
    workspaceId === bearerWorkspace ? undefined : { status: 403, body: { code: 'sso_required' } }

  await select('B')
  await expectActive('B')
  await expectBuildsFrom('B')
  await settle()
  await expectNoCaption()
  await shot('08-sso-consent-on-B')

  expect(browserOpens).toHaveLength(2)
  expect(cloud.authorizeUrls).toHaveLength(2)
  expect(cloud.authorizeUrls[1]?.searchParams.get('workspace_id')).toBe('B')
  expect(cloud.mints).toEqual([{ workspaceId: 'B', bearerWorkspace: 'A' }])
})

const MINT_DISABLED: FakeReply = {
  status: 503,
  body: { code: 'oauth_workspace_mint_disabled' }
}

test('server kill: each switch takes exactly one browser and the new anchor activates with no mint @macos @windows', async () => {
  await signInOnFreshProfile()
  cloud.mintBehavior = (workspaceId, bearerWorkspace) =>
    workspaceId === bearerWorkspace ? undefined : MINT_DISABLED

  await select('B')
  await expectActive('B')
  await expectBuildsFrom('B')
  expect(browserOpens).toHaveLength(2)
  expect(cloud.authorizeUrls[1]?.searchParams.get('workspace_id')).toBe('B')

  await select('C')
  await expectActive('C')
  await expectBuildsFrom('C')
  await settle()
  await shot('09-server-kill-degraded')

  expect(browserOpens, 'one browser per switch').toHaveLength(3)
  expect(cloud.authorizeUrls[2]?.searchParams.get('workspace_id')).toBe('C')
  expect(cloud.mints.map(({ workspaceId }) => workspaceId)).toEqual(['B', 'C'])
})

test('server kill: consent on another workspace does not loop: it stays put with one browser @macos @windows', async () => {
  await signInOnFreshProfile()
  cloud.mintBehavior = (workspaceId, bearerWorkspace) =>
    workspaceId === bearerWorkspace ? undefined : MINT_DISABLED
  cloud.consentOverride = 'A'

  await select('B')
  await expectCaption(RETRYABLE_COPY)
  await settle()
  await shot('10-server-kill-no-loop')

  expect(await activeWorkspace()).toBe('A')
  expect(browserOpens, 'no second browser for the same switch').toHaveLength(2)
  expect(cloud.mints.map(({ workspaceId }) => workspaceId)).toEqual(['B', 'B'])
})

test('a relaunch after a failed switch opens no browser, and Refresh is what asks for one @macos @windows', async () => {
  await signInOnFreshProfile()
  cloud.mintBehavior = (workspaceId, bearerWorkspace) =>
    workspaceId === bearerWorkspace ? undefined : MINT_DISABLED
  cloud.consentOverride = 'A'

  await select('B')
  await expectCaption(RETRYABLE_COPY)
  const settingsPath = path.join(userDataDir, 'settings.json')
  await expect
    .poll(async () => {
      const raw = await readFile(settingsPath, 'utf-8')
      return (JSON.parse(raw) as { dashboardWorkspaceId?: string }).dashboardWorkspaceId
    })
    .toBe('B')
  await quit()
  browserOpens = []
  const authorizeBefore = cloud.authorizeUrls.length

  await launch(JSON.parse(await readFile(settingsPath, 'utf-8')) as Record<string, unknown>)
  await expectCaption(RETRYABLE_COPY)
  await settle()

  expect(browserOpens, 'a launch opens no browser on its own').toEqual([])
  expect(cloud.authorizeUrls).toHaveLength(authorizeBefore)
  expect(await activeWorkspace()).toBe('A')

  expect(await panel().click(REFRESH), 'clicked refresh').toBe(true)
  await expect.poll(() => browserOpens.length).toBe(1)
})

test('a 500 on mint opens no browser, shows the retry caption and the app keeps working on A @macos @windows', async () => {
  await signInOnFreshProfile()
  cloud.mintBehavior = () => ({ status: 500, body: {} })

  await select('B')
  await expectCaption(RETRYABLE_COPY)
  await settle()
  await shot('11-retry-caption-500')

  expect(await activeWorkspace()).toBe('A')
  expect(browserOpens).toHaveLength(1)

  cloud.builds.length = 0
  expect(await panel().click(REFRESH), 'clicked refresh').toBe(true)
  await expectBuildsFrom('A')
  await expectCaption(RETRYABLE_COPY)

  cloud.mintBehavior = () => undefined
  await select('C')
  await expectActive('C')
  await expectNoCaption()
  expect(browserOpens).toHaveLength(1)
})

test('connection refused on mint opens no browser, shows the retry caption, and Refresh recovers @macos @windows', async () => {
  await signInOnFreshProfile()
  await cloud.stop()

  await select('B')
  await expectCaption(RETRYABLE_COPY)
  await settle()
  await shot('12-retry-caption-connection-refused')

  expect(await activeWorkspace()).toBe('A')
  expect(browserOpens).toHaveLength(1)

  await cloud.start()
  expect(await panel().click(REFRESH), 'clicked refresh').toBe(true)
  await expectActive('B')
  await expectNoCaption()
  await shot('13-recovered-after-refresh')
  expect(browserOpens).toHaveLength(1)
})
