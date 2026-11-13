import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { WebContentsPage } from './support/cdpPages'
import { reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'

const INSTALL_NAME = 'Local MCP Fixture'
const NUDGE_CONNECT = '[data-testid="mcp-nudge-connect"]'
const MODAL_CLOSE = '[data-testid="mcp-setup-close"]'
const AGENT_OPTION = '[data-testid="mcp-option-agent"]'
const TERMINAL_OPTION = '[data-testid="mcp-option-terminal"]'
const AGENTS = '[data-testid="mcp-agents"]'

let ctx: AppContext
let comfy: WebContentsPage
let installPath: string
let port = 0

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-mcp-setup-'))
  port = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port })
  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    opsFlags: { desktop_mcp_nudge: { value: true, payload: null, fetchedAt: Date.now() } },
    installations: [
      {
        id: 'inst-mcp-setup',
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
  comfy = new WebContentsPage(ctx.app, `:${port}`)
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

async function panelViewVisible(): Promise<boolean> {
  return await ctx.app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      for (const view of window.contentView.children) {
        const webContents = (view as unknown as { webContents?: Electron.WebContents }).webContents
        if (webContents?.getURL().includes('panel.html')) return view.getVisible()
      }
    }
    return false
  })
}

async function choosePath(label: string): Promise<void> {
  expect(
    await ctx.panel.evaluate<boolean>(`(() => {
      const button = Array.from(document.querySelectorAll('[data-testid="mcp-setup-path"] button'))
        .find((el) => el.textContent.trim() === ${JSON.stringify(label)})
      if (!button) return false
      button.click()
      return true
    })()`)
  ).toBe(true)
}

test('the nudge on the canvas opens the setup modal with both ways to connect @linux', async () => {
  await clickInstallTile(ctx.panel, INSTALL_NAME)
  await expect
    .poll(() => comfy.isVisible(NUDGE_CONNECT).catch(() => false), {
      timeout: 90_000,
      message: 'the MCP nudge never showed on the ComfyUI canvas'
    })
    .toBe(true)
  await expect.poll(panelViewVisible).toBe(false)

  expect(await comfy.click(NUDGE_CONNECT)).toBe(true)
  await ctx.panel.waitForVisible(MODAL_CLOSE)
  await expect.poll(panelViewVisible).toBe(true)
  expect(await comfy.exists(NUDGE_CONNECT)).toBe(false)

  expect(await ctx.panel.isVisible(AGENT_OPTION)).toBe(true)
  expect(await ctx.panel.isVisible(TERMINAL_OPTION)).toBe(true)
  expect(await ctx.panel.textOf(AGENT_OPTION)).toContain(`COMFY_LOCAL_URL=http://127.0.0.1:${port}`)

  await choosePath('I need one')
  await ctx.panel.waitForVisible(AGENTS)
  expect(await ctx.panel.exists(AGENT_OPTION)).toBe(false)
  expect(await ctx.panel.allText(`${AGENTS} li`)).toHaveLength(3)

  await choosePath('I have an agent')
  await ctx.panel.waitForVisible(AGENT_OPTION)

  expect(await ctx.panel.click(MODAL_CLOSE)).toBe(true)
  await expect.poll(panelViewVisible).toBe(false)
  expect(await ctx.panel.exists(MODAL_CLOSE)).toBe(false)
})

test('a dismissed nudge stays away after the canvas reloads @linux', async () => {
  const loadedAt = await comfy.evaluate<number>('performance.timeOrigin')
  await comfy.evaluate('location.reload()').catch(() => {})
  await expect
    .poll(() => comfy.evaluate<number>('performance.timeOrigin').catch(() => loadedAt), {
      timeout: 30_000,
      message: 'the canvas never reloaded'
    })
    .toBeGreaterThan(loadedAt)
  await expect
    .poll(
      () => comfy.evaluate<boolean>('window.__comfyDesktopMcpNudge === true').catch(() => false),
      { timeout: 30_000, message: 'the nudge script never ran after the reload' }
    )
    .toBe(true)
  expect(await comfy.exists(NUDGE_CONNECT)).toBe(false)
})
