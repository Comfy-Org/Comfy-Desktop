import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { setAppUpdateState, setInstallUpdate, type AppUpdateStateLike } from './support/devHooks'

let ctx: AppContext

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp({ settings: { firstUseCompleted: true, telemetryEnabled: false } })
})

test.afterAll(async () => {
  await ctx.cleanup()
})

test.beforeEach(async () => {
  await closeUpdateQuestionIfOpen()
  await setAppUpdateState(ctx.app, IDLE_APP_UPDATE)
  await setInstallUpdate(ctx.app, { available: false })
})

const IDLE_APP_UPDATE: AppUpdateStateLike = { kind: null, version: null, autoUpdate: true }
const SIDEBAR_UPDATE = '[data-testid="app-sidebar-desktop-update"]'

function sidebarUpdateIn(kind: NonNullable<AppUpdateStateLike['kind']>): string {
  return `${SIDEBAR_UPDATE}[data-state="${kind}"]`
}

async function expectSidebarUpdate(kind: NonNullable<AppUpdateStateLike['kind']>): Promise<void> {
  await ctx.panel.waitForVisible(sidebarUpdateIn(kind), { timeout: 5_000 })
}

const QUESTION_ACTION = '[data-testid="base-alert-action"]'
const QUESTION_CANCEL = '[data-testid="base-alert-cancel"]'

async function expectUpdateQuestion(actionLabel: string): Promise<void> {
  await ctx.panel.waitForVisible(QUESTION_ACTION, { timeout: 5_000 })
  expect(await ctx.panel.textOf(QUESTION_ACTION)).toContain(actionLabel)
}

async function closeUpdateQuestionIfOpen(): Promise<void> {
  if (!(await ctx.panel.isVisible(QUESTION_CANCEL))) return
  expect(await ctx.panel.click(QUESTION_CANCEL)).toBe(true)
  await ctx.panel.waitFor(async () => !(await ctx.panel.isVisible(QUESTION_ACTION)), {
    timeout: 3_000,
    message: 'the update question did not close'
  })
}

test('desktop update is hidden in the sidebar and the title bar when state is idle @windows @macos @linux', async () => {
  await ctx.panel.waitFor(async () => !(await ctx.panel.exists(SIDEBAR_UPDATE)), {
    timeout: 5_000,
    message: 'sidebar desktop update stayed visible while idle'
  })
  expect(await ctx.titleBar.exists('.title-update-pill')).toBe(false)
})

test('desktop update shows in the sidebar for state=available @windows @macos @linux', async () => {
  await setAppUpdateState(ctx.app, { kind: 'available', version: '1.2.3', autoUpdate: false })
  await expectSidebarUpdate('available')
  expect(await ctx.titleBar.exists('.title-update-pill')).toBe(false)
})

test('desktop update shows in the sidebar for state=downloading @windows @macos @linux', async () => {
  await setAppUpdateState(ctx.app, { kind: 'downloading', version: '1.2.3', autoUpdate: true })
  await expectSidebarUpdate('downloading')
})

test('desktop update shows in the sidebar for state=ready @windows @macos @linux', async () => {
  await setAppUpdateState(ctx.app, { kind: 'ready', version: '1.2.3', autoUpdate: true })
  await expectSidebarUpdate('ready')
})

test('clicking the available sidebar desktop update asks to download in the panel @windows @macos @linux', async () => {
  await setAppUpdateState(ctx.app, { kind: 'available', version: '1.2.3', autoUpdate: false })
  await expectSidebarUpdate('available')

  expect(await ctx.panel.click(SIDEBAR_UPDATE), 'sidebar desktop update click dispatched').toBe(
    true
  )

  await expectUpdateQuestion('Download')
  await closeUpdateQuestionIfOpen()
})

test('clicking the ready sidebar desktop update asks to restart in the panel @windows @macos @linux', async () => {
  await setAppUpdateState(ctx.app, { kind: 'ready', version: '1.2.3', autoUpdate: true })
  await expectSidebarUpdate('ready')

  expect(await ctx.panel.click(SIDEBAR_UPDATE), 'sidebar desktop update click dispatched').toBe(
    true
  )

  await expectUpdateQuestion('Restart & Update')
  await closeUpdateQuestionIfOpen()
})
