import os from 'node:os'
import path from 'node:path'
import { access, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { closeTitlePopupIfOpen, titlePopupPage, waitForWebContents } from './support/cdpPages'
import { byTestId, TID } from './support/testIds'
import { getIpcInvocations } from './support/devHooks'

let ctx: AppContext
let untrackPath: string
let deletePath: string

const UNTRACK_ID = 'inst-untrack-test'
const UNTRACK_NAME = 'Untrack Me'
const DELETE_ID = 'inst-delete-test'
const DELETE_NAME = 'Delete Me'

const MARKER_FILENAME = '.comfyui-desktop-2'

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function tileExists(installationId: string): Promise<boolean> {
  return ctx.panel.exists(byTestId(TID.dashboardTile(installationId)))
}

async function openKebabAndClick(installationId: string, menuItemId: string): Promise<void> {
  const kebabClicked = await ctx.panel.click(byTestId(TID.dashboardTileKebab(installationId)))
  expect(kebabClicked, `kebab click on ${installationId}`).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.contextMenuItem(menuItemId)), { timeout: 5_000 })
  const itemClicked = await ctx.panel.click(byTestId(TID.contextMenuItem(menuItemId)))
  expect(itemClicked, `menu item click ${menuItemId}`).toBe(true)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  untrackPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-untrack-e2e-'))
  deletePath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-delete-e2e-'))
  await mkdir(untrackPath, { recursive: true })
  await mkdir(deletePath, { recursive: true })
  await writeFile(path.join(untrackPath, MARKER_FILENAME), UNTRACK_ID)
  await writeFile(path.join(deletePath, MARKER_FILENAME), DELETE_ID)

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: [
      {
        id: UNTRACK_ID,
        name: UNTRACK_NAME,
        installPath: untrackPath,
        sourceId: 'standalone',
        status: 'installed'
      },
      {
        id: DELETE_ID,
        name: DELETE_NAME,
        installPath: deletePath,
        sourceId: 'standalone',
        status: 'installed'
      }
    ]
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (untrackPath) await rm(untrackPath, { recursive: true, force: true })
  if (deletePath) await rm(deletePath, { recursive: true, force: true })
})

test('chooser lists both seeded installs @lifecycle', async () => {
  await ctx.panel.waitForSelector(byTestId(TID.dashboardTile(UNTRACK_ID)), { timeout: 10_000 })
  await ctx.panel.waitForSelector(byTestId(TID.dashboardTile(DELETE_ID)), { timeout: 10_000 })
})

test('Manage drawer Untrack drops the record but preserves the install directory @lifecycle', async () => {
  await ctx.panel.evaluate<boolean>(
    `(() => {
      window.api.openInstancePicker({
        installationId: ${JSON.stringify(UNTRACK_ID)},
        initialTab: 'settings',
      })
      return true
    })()`
  )
  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(byTestId(TID.pickerMoreTrigger), { timeout: 30_000 })
  await popup.clickUntilVisible(
    byTestId(TID.pickerMoreTrigger),
    byTestId(TID.pinBottomAction('remove')),
    { timeout: 30_000 }
  )
  expect(await popup.click(byTestId(TID.pinBottomAction('remove')))).toBe(true)
  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 15_000 })
  expect(await popup.click(byTestId(TID.baseAlertAction)), 'untrack confirm click dispatched').toBe(
    true
  )

  await ctx.panel.waitFor(async () => !(await tileExists(UNTRACK_ID)), {
    timeout: 15_000,
    message: 'untracked tile never disappeared from chooser'
  })
  await closeTitlePopupIfOpen(ctx.app)
  expect(await pathExists(untrackPath), 'untrack must leave the install directory on disk').toBe(
    true
  )
})

test('kebab Delete drops the record AND removes the install directory @lifecycle', async () => {
  test.setTimeout(180_000)
  const activeOps = (): Promise<unknown> => ctx.panel.evaluate('window.api.getActiveOperations()')
  const startedAt = Date.now()
  const opsBeforeKebab = await activeOps()
  await openKebabAndClick(DELETE_ID, 'delete')

  await ctx.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 5_000 })
  const opsBeforeConfirm = await activeOps()
  const confirmed = await ctx.panel.click(byTestId(TID.baseAlertAction))
  expect(confirmed, 'delete confirm click dispatched').toBe(true)
  console.log(
    `[delete-diag] confirm ${Date.now() - startedAt}ms after test start; ops before kebab ${JSON.stringify(opsBeforeKebab)}; ops before confirm ${JSON.stringify(opsBeforeConfirm)}; run-action calls ${JSON.stringify(await getIpcInvocations(ctx.app, 'run-action'))}`
  )

  const errored = (): Promise<boolean> =>
    ctx.panel.evaluate<boolean>(
      `window.__e2eRenderer.hasErrorInstance(${JSON.stringify(DELETE_ID)})`
    )
  await ctx.panel.waitFor(async () => !(await tileExists(DELETE_ID)) || (await errored()), {
    timeout: 30_000,
    message: 'delete neither finished nor failed'
  })
  if (await tileExists(DELETE_ID)) {
    const diag: Record<string, unknown> = {}
    const step = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
      try {
        diag[name] = await fn()
      } catch (err) {
        diag[name] = `threw: ${(err as Error)?.message ?? String(err)}`
      }
    }
    await step('versions', () => ctx.app.evaluate(() => process.versions))
    await step('runActionCalls', () => getIpcInvocations(ctx.app, 'run-action'))
    await step('dirAfterFirstAttempt', () => readdir(deletePath))
    await step('installRecord', () =>
      ctx.panel.evaluate(
        `window.api.getInstallations().then(list => list.filter(i => i.id === ${JSON.stringify(DELETE_ID)}).map(i => ({ status: i.status, statusTag: i.statusTag, installPath: i.installPath })))`
      )
    )
    await step('badgeClicked', () =>
      ctx.panel.click(`${byTestId(TID.dashboardTile(DELETE_ID))} .chooser-tile-error-badge`)
    )
    await step('firstErrorText', async () => {
      await ctx.panel.waitForVisible('.base-alert-message-text', { timeout: 5_000 })
      return ctx.panel.textOf('.base-alert-message-text')
    })
    await new Promise((resolve) => setTimeout(resolve, 11_000))
    await step('errorTextAfterLockProbe', () => ctx.panel.textOf('.base-alert-message-text'))
    await step('renameProbe', async () => {
      const moved = `${deletePath}-moved`
      await rename(deletePath, moved)
      await rename(moved, deletePath)
      return 'rename ok'
    })
    await step('appProcessTree', async () => {
      const rootPid = ctx.app.process().pid
      const json = await new Promise<string>((resolve, reject) => {
        execFile(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'
          ],
          { maxBuffer: 64 * 1024 * 1024 },
          (err, stdout) => (err ? reject(err) : resolve(stdout))
        )
      })
      const all = JSON.parse(json) as {
        ProcessId: number
        ParentProcessId: number
        Name: string
        CommandLine: string | null
      }[]
      const family = new Set<number>([rootPid ?? -1])
      for (let grew = true; grew;) {
        grew = false
        for (const p of all) {
          if (family.has(p.ParentProcessId) && !family.has(p.ProcessId)) {
            family.add(p.ProcessId)
            grew = true
          }
        }
      }
      const mentions = all.filter((p) => (p.CommandLine ?? '').includes(path.basename(deletePath)))
      return {
        rootPid,
        family: all
          .filter((p) => family.has(p.ProcessId))
          .map(
            (p) =>
              `${p.ProcessId} <- ${p.ParentProcessId} ${p.Name} ${(p.CommandLine ?? '').slice(0, 300)}`
          ),
        mentions: mentions.map(
          (p) => `${p.ProcessId} ${p.Name} ${(p.CommandLine ?? '').slice(0, 300)}`
        )
      }
    })
    await step('secondAttemptResult', () =>
      ctx.panel.evaluate(`window.api.runAction(${JSON.stringify(DELETE_ID)}, 'delete')`)
    )
    await step('dirAfterSecondAttempt', () => readdir(deletePath))
    throw new Error(`DELETE-DIAG ${JSON.stringify(diag, null, 2)}`)
  }
  await expect
    .poll(() => pathExists(deletePath), { timeout: 30_000, intervals: [250, 500, 1000] })
    .toBe(false)
})
