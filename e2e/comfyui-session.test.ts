import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { waitForAppExit } from './support/electronHarness'
import {
  clickInstallTile,
  expectChooserVisible,
  openPickerViaTitlePill
} from './support/chooserHelpers'
import { WebContentsPage } from './support/cdpPages'
import { byTestId, TID } from './support/testIds'
import {
  isProcessAlive,
  readFakeComfyProcess,
  reserveFreePort,
  writeFakeComfyInstall,
  type FakeComfyProcess
} from './support/fakeComfyInstall'

const INSTALL_NAME = 'Session Journey Install'

let ctx: AppContext | null = null
let installPath = ''
let port = 0
let running: FakeComfyProcess | null = null

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-session-journey-'))
  port = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port })
  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false, hasSeenCentralPillHint: true },
    installations: [
      {
        id: 'inst-session-journey',
        name: INSTALL_NAME,
        sourceId: 'comfybuilder',
        sourceLabel: 'ComfyBuilder',
        installPath,
        status: 'installed',
        launchArgs: `--port ${port}`,
        launchMode: 'window',
        browserPartition: 'unique',
        seen: true
      }
    ]
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  if (running && isProcessAlive(running.pid)) process.kill(running.pid, 'SIGKILL')
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

function desktop(): AppContext {
  if (!ctx) throw new Error('Desktop is not running')
  return ctx
}

function runningComfy(): FakeComfyProcess {
  if (!running) throw new Error('no ComfyUI process was recorded by an earlier step')
  return running
}

async function waitForComfyToBoot(previousPid?: number): Promise<FakeComfyProcess> {
  let booted: FakeComfyProcess | null = null
  await expect
    .poll(
      async () => {
        booted = await readFakeComfyProcess(port)
        return booted !== null && booted.pid !== previousPid
      },
      { timeout: 60_000, message: `no new ComfyUI process answered on port ${port}` }
    )
    .toBe(true)
  return booted!
}

function visibleViewUrls(): Promise<string[]> {
  return desktop().app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().flatMap((window) =>
      window.contentView.children.flatMap((child) => {
        const view = child as unknown as { webContents?: Electron.WebContents }
        return view.webContents && child.getVisible() ? [view.webContents.getURL()] : []
      })
    )
  )
}

function isComfyUrl(url: string): boolean {
  return url.startsWith(`http://127.0.0.1:${port}`)
}

function isPanelUrl(url: string): boolean {
  return url.includes('panel.html')
}

async function expectComfyOnScreen(): Promise<void> {
  await expect
    .poll(visibleViewUrls, { timeout: 30_000, message: 'the ComfyUI page never took the window' })
    .toEqual(expect.arrayContaining([expect.stringContaining(`http://127.0.0.1:${port}`)]))
  await expect
    .poll(async () => (await visibleViewUrls()).some(isPanelUrl), {
      message: 'the dashboard panel still covers ComfyUI'
    })
    .toBe(false)
  const comfyPage = new WebContentsPage(desktop().app, `127.0.0.1:${port}`)
  expect(await comfyPage.evaluate<string>('document.title')).toBe('ComfyUI (e2e stub)')
}

async function expectComfyGone(pid: number): Promise<void> {
  await expect
    .poll(() => isProcessAlive(pid), {
      timeout: 60_000,
      message: `ComfyUI process ${pid} is still alive`
    })
    .toBe(false)
  await expect
    .poll(() => readFakeComfyProcess(port), { message: `port ${port} still answers` })
    .toBeNull()
}

test('clicking an install boots ComfyUI and puts its page in the window @macos @windows @linux', async () => {
  await clickInstallTile(desktop().panel, INSTALL_NAME)

  running = await waitForComfyToBoot()

  expect(running.argv).toEqual(expect.arrayContaining(['--port', String(port)]))
  await expectComfyOnScreen()
})

test('Stop in the install picker ends the ComfyUI process and frees its port @macos @windows @linux', async () => {
  const { app, titleBar, panel } = desktop()
  const popup = await openPickerViaTitlePill(app, titleBar)
  await popup.clickUntilVisible(
    byTestId(TID.pickerMoreTrigger),
    byTestId(TID.pinBottomAction('stop')),
    { timeout: 30_000 }
  )
  expect(await popup.click(byTestId(TID.pinBottomAction('stop')))).toBe(true)
  await popup.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(await popup.click(byTestId(TID.baseAlertAction))).toBe(true)

  await expectComfyGone(runningComfy().pid)
  await panel.waitForVisible(byTestId(TID.lifecycleRelaunch), { timeout: 30_000 })
  expect((await visibleViewUrls()).some(isComfyUrl)).toBe(false)
})

test('Relaunch on the stopped screen boots ComfyUI again on the same port @macos @windows @linux', async () => {
  const stoppedPid = runningComfy().pid
  expect(await desktop().panel.click(byTestId(TID.lifecycleRelaunch))).toBe(true)

  running = await waitForComfyToBoot(stoppedPid)

  await expectComfyOnScreen()
})

test('quitting Desktop stops the running ComfyUI @macos @windows @linux', async () => {
  const { app } = desktop()
  const exited = waitForAppExit(app, 30_000)
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => {})
  await exited
  ctx = null

  await expectComfyGone(runningComfy().pid)
})
