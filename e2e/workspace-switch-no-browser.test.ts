import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type * as Http from 'node:http'
import type * as Https from 'node:https'
import { expect, test } from '@playwright/test'
import en from '../locales/en.json'
import { launchApp, type AppContext } from './launchApp'
import { FakeCloud, type FakeReply } from './support/fakeCloud'
import { captureHostWindow } from './support/windowCapture'
import { openPicker } from './support/navMatrixHelpers'
import { findWebContentsId, titlePopupPage, WebContentsPage } from './support/cdpPages'
import { openPickerViaTitlePill } from './support/chooserHelpers'
import type { SeedInstallation } from './support/electronHarness'
import { byTestId, TID } from './support/testIds'

const UNAVAILABLE_COPY = en.devPlatform.workspace.switchUnavailable
const RETRYABLE_COPY = en.devPlatform.workspace.switchRetryable
const FAILURE_CAPTION = '[data-testid="chooser-workspace-switch-failure"]'
const SWITCHER = '[data-testid="workspace-switcher-trigger"]'
const SWITCHER_NAME = '[data-testid="workspace-switcher-name"]'
const SWITCH_ACTION = '[data-testid="workspace-switch-action"]'
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

async function launch(
  settings: Record<string, unknown> = { firstUseCompleted: true },
  installations?: SeedInstallation[]
) {
  ctx = await launchApp({ userDataDir, settings, installations })
  const actual = await ctx.app.evaluate(({ app }) => app.getPath('userData'))
  expect(await realpath(actual), 'the run stays off the real profile').toBe(userDataDir)
  stopBrowser = cloud.completeSignInsLikeABrowser(ctx.app, (url) => browserOpens.push(url))
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
    .poll(() => panel().textOf(SWITCHER_NAME), { timeout: 15_000 })
    .toBe(`Workspace ${workspaceId}`)
}

async function expectBuildsFrom(workspaceId: string): Promise<void> {
  await expect.poll(() => cloud.builds.at(-1)?.workspace, { timeout: 15_000 }).toBe(workspaceId)
}

async function select(workspaceId: string): Promise<void> {
  const item = `[data-testid="workspace-option-${workspaceId}"]`
  await panel().waitForVisible(SWITCHER)
  await panel().clickUntilVisible(SWITCHER, SWITCH_ACTION)
  await panel().clickUntilVisible(SWITCH_ACTION, item)
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

async function signInOnFreshProfile(installations?: SeedInstallation[]): Promise<void> {
  await launch(undefined, installations)
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
  cloud = new FakeCloud((_req, res, url) => {
    if (url.pathname !== '/team-a-build') return false
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html><body>Team A build</body></html>')
    return true
  })
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

test('Comfy Cloud stays available and reopens in the selected team or Personal workspace @macos @windows', async () => {
  const hostId = 'team-a-build'
  cloud.workspaces.push({ id: 'P', name: 'Personal Workspace', type: 'personal', role: 'owner' })
  await signInOnFreshProfile([
    {
      id: hostId,
      name: 'Team A build',
      sourceId: 'remote',
      workspaceId: 'A',
      remoteUrl: `${cloud.url}/team-a-build`,
      launchMode: 'window'
    }
  ])
  await ctx!.app.evaluate(async ({ session, net }, baseUrl) => {
    const mainProcess = globalThis.process
    const https = mainProcess.getBuiltinModule('node:https') as typeof Https
    const http = mainProcess.getBuiltinModule('node:http') as typeof Http
    const get = https.get
    https.get = ((...args: unknown[]) => {
      if (typeof args[0] !== 'string' && !(args[0] instanceof URL)) {
        return Reflect.apply(get, https, args)
      }
      const url = new URL(String(args[0]))
      if (url.hostname !== 'cloud.comfy.org') return Reflect.apply(get, https, args)
      args[0] = `${baseUrl}/cloud-view${url.search}`
      return Reflect.apply(http.get, http, args)
    }) as typeof https.get
    await session.fromPartition('persist:shared').protocol.handle('https', (request) => {
      const url = new URL(request.url)
      if (url.hostname !== 'cloud.comfy.org') {
        return net.fetch(request, { bypassCustomProtocolHandlers: true })
      }
      return new Response(
        `<html><body><script>
          const url = new URL(location.href)
          const target = url.searchParams.get('workspace')
          const switchTarget = sessionStorage.getItem('Comfy.Workspace.SwitchTargetId')
          const active = target ?? switchTarget ??
            JSON.parse(sessionStorage.getItem('Comfy.Workspace.Current') ?? 'null')?.id
          sessionStorage.removeItem('Comfy.Workspace.SwitchTargetId')
          sessionStorage.setItem('Comfy.Workspace.Current', JSON.stringify({ id: active }))
          url.searchParams.delete('workspace')
          history.replaceState(null, '', url)
          document.body.dataset.workspace = active
          document.body.dataset.page = crypto.randomUUID()
        </script></body></html>`,
        { headers: { 'content-type': 'text/html' } }
      )
    })
  }, cloud.url)

  expect(await panel().click('[data-testid="app-sidebar-home"]')).toBe(true)
  const cloudInstallId = await panel().evaluate<string>(
    "window.api.getInstallations().then((installs) => installs.find((install) => install.sourceId === 'cloud').id)"
  )
  const app = ctx!.app
  const cloudPage = new WebContentsPage(app, 'https://cloud.comfy.org/')
  const hostTitleBar = new WebContentsPage(app, `comfyTitleBar.html?installationId=${hostId}`)
  const cloudRow = byTestId(TID.pickerRow(cloudInstallId))
  const selectDashboard = async (selected: string): Promise<void> => {
    await select(selected)
    await expect
      .poll(() => panel().evaluate<string>('window.api.getSetting("dashboardWorkspaceId")'))
      .toBe(selected)
  }
  const openCloudFromPicker = async (picker: WebContentsPage): Promise<void> => {
    await picker.waitForVisible(cloudRow)
    expect(await picker.click(cloudRow)).toBe(true)
    expect(await picker.click(byTestId(TID.pickerPrimaryCta))).toBe(true)
  }
  const openCloudFromHome = async (): Promise<void> => {
    expect(await panel().clickByText('[data-testid="home-build"]', 'Comfy Cloud')).toBe(true)
  }
  const expectCloudWorkspace = async (workspaceId: string): Promise<void> => {
    await cloudPage.waitForSelector(`body[data-workspace="${workspaceId}"]`)
  }

  expect(await panel().clickByText('[data-testid="home-build"]', 'Team A build')).toBe(true)
  await hostTitleBar.waitForVisible('.title-bar')
  await selectDashboard('B')
  await openCloudFromPicker(await openPickerViaTitlePill(app, hostTitleBar))
  await expectCloudWorkspace('A')
  const cloudViewId = await findWebContentsId(app, 'https://cloud.comfy.org/')
  expect(cloudViewId).not.toBeNull()

  await openCloudFromHome()
  await expectCloudWorkspace('B')
  await openCloudFromPicker(await openPickerViaTitlePill(app, hostTitleBar))
  await expectCloudWorkspace('A')

  for (const selected of ['B', 'personal', 'A']) {
    await selectDashboard(selected)
    await panel().waitForVisible('[data-testid="home-build"]')
    if (selected === 'personal') {
      await openPicker(app, panel())
      await openCloudFromPicker(titlePopupPage(app))
    } else {
      await openCloudFromHome()
    }
    await expectCloudWorkspace(selected === 'personal' ? 'P' : selected)
  }

  const switchCloudTabToB = async (): Promise<void> => {
    await cloudPage.evaluate(`(() => {
      sessionStorage.removeItem('Comfy.Workspace.Current')
      sessionStorage.setItem('Comfy.Workspace.SwitchTargetId', 'B')
      setTimeout(() => location.reload(), 0)
    })()`)
    await expectCloudWorkspace('B')
  }

  await switchCloudTabToB()
  await selectDashboard('B')
  const page = await cloudPage.evaluate<string>('document.body.dataset.page')
  await expect(
    panel().evaluate<boolean>(`window.api.focusComfyWindow(${JSON.stringify(cloudInstallId)})`)
  ).resolves.toBe(true)
  expect(await cloudPage.evaluate<string>('document.body.dataset.page')).toBe(page)

  await selectDashboard('A')
  await openCloudFromHome()
  await expectCloudWorkspace('A')
  await switchCloudTabToB()
  await openCloudFromHome()
  await expectCloudWorkspace('A')

  const views = await app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .filter((view) => view.getURL().startsWith('https://cloud.comfy.org/'))
      .map((view) => view.id)
  )
  expect(views, 'the existing Cloud view is reused').toEqual([cloudViewId])
  expect(browserOpens, 'workspace navigation asks for no extra sign-in').toHaveLength(1)
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
