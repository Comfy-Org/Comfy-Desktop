
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { closeTitlePopupIfOpen, titlePopupPage, waitForWebContents } from './support/cdpPages'
import { expectChooserVisible } from './support/chooserHelpers'
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'
import { byTestId, TID } from './support/testIds'

let ctx: AppContext
let legacyBasePath: string
let legacyInstallId = ''

const LEGACY_NAME = 'ComfyUI Legacy Desktop'

interface FieldOption {
  value: string
  label: string
  recommended?: boolean
  [key: string]: unknown
}

interface Installation {
  id: string
  name: string
  sourceId: string
  installPath?: string
  [key: string]: unknown
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.skip(process.platform !== 'win32', 'Legacy Desktop detection sandbox only works on Windows (APPDATA-based)')
  if (!process.env['GITHUB_TOKEN']) {
    for (let depth = 2; depth <= 8; depth++) {
      const segments = Array(depth).fill('..')
      const p = resolve(__dirname, ...segments, 'githubtoken.txt')
      try { process.env['GITHUB_TOKEN'] = readFileSync(p, 'utf-8').trim(); break } catch { }
    }
  }

  legacyBasePath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-legacy-desktop-e2e-'))
  await mkdir(path.join(legacyBasePath, 'models'), { recursive: true })
  await mkdir(path.join(legacyBasePath, 'user'), { recursive: true })
  await mkdir(path.join(legacyBasePath, 'input'), { recursive: true })
  await mkdir(path.join(legacyBasePath, 'output'), { recursive: true })
  await mkdir(path.join(legacyBasePath, '.venv'), { recursive: true })

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    async onSetup({ homeDir }) {
      const desktopConfigDir = path.join(homeDir, 'AppData', 'Roaming', 'ComfyUI')
      await mkdir(desktopConfigDir, { recursive: true })
      await writeFile(
        path.join(desktopConfigDir, 'config.json'),
        JSON.stringify({ basePath: legacyBasePath }),
      )
    },
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (legacyBasePath) await rm(legacyBasePath, { recursive: true, force: true })
})

test('auto-tracker registers Legacy Desktop install on boot @lifecycle', async () => {
  await ctx.panel.waitFor(
    async () => {
      const names = await ctx.panel.allText(
        '.chooser-tile:not(.chooser-tile-new):not(.chooser-tile-cloud) .chooser-tile-name',
      )
      return names.includes(LEGACY_NAME)
    },
    { timeout: 15_000, message: 'auto-tracked Legacy Desktop tile never appeared in chooser' },
  )

  const installs = await ctx.panel.evaluate<Installation[]>(`window.api.getInstallations()`)
  const desktop = installs.find((i) => i.sourceId === 'desktop')
  expect(desktop, 'desktop install not present in get-installations result').toBeDefined()
  expect(desktop!.installPath).toBe(legacyBasePath)
  legacyInstallId = desktop!.id
})

test('chooser kebab Migrate opens the real adoption confirm; Cancel backs out cleanly @lifecycle', async () => {
  expect(legacyInstallId, 'legacyInstallId not captured by the prior test').toBeTruthy()
  await resetIpcInvocations(ctx.app, 'run-action')

  expect(
    await ctx.panel.click(byTestId(TID.dashboardTileKebab(legacyInstallId))),
    'kebab click on legacy desktop tile',
  ).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.contextMenuItem('migrate')), { timeout: 5_000 })
  expect(await ctx.panel.click(byTestId(TID.contextMenuItem('migrate')))).toBe(true)

  await waitForWebContents(ctx.app, 'comfyTitlePopup.html')
  const popup = titlePopupPage(ctx.app)
  await popup.waitForVisible(byTestId(TID.modalConfirm), { timeout: 15_000 })
  await popup.waitForVisible(byTestId(TID.modalCancel))

  expect(await popup.click(byTestId(TID.modalCancel))).toBe(true)
  await popup.waitFor(
    async () => !(await popup.exists(byTestId(TID.modalConfirm))),
    { timeout: 10_000, message: 'adoption confirm never dismissed after Cancel' },
  )

  type RunActionCall = { installationId: string; actionId: string }
  const calls = await getIpcInvocations(ctx.app, 'run-action') as RunActionCall[]
  expect(
    calls.some((c) => c.actionId === 'migrate-to-standalone'),
    'cancelled adoption confirm must not dispatch migrate-to-standalone',
  ).toBe(false)
  const installs = await ctx.panel.evaluate<Installation[]>(`window.api.getInstallations()`)
  const desktop = installs.find((i) => i.id === legacyInstallId)
  expect(desktop, 'legacy desktop record must survive a cancelled migrate').toBeDefined()
  expect(desktop!.sourceId).toBe('desktop')

  await closeTitlePopupIfOpen(ctx.app)
})

test('standalone source exposes a CPU variant the migration variant pick can pin @lifecycle', async () => {
  const releaseOptions = await ctx.panel.evaluate<FieldOption[]>(
    `window.api.getFieldOptions('standalone', 'release', {}, { includeLatestStable: true })`,
  )
  expect(releaseOptions.length, 'no standalone releases available').toBeGreaterThan(0)
  const release = releaseOptions.find((r) => r.recommended) ?? releaseOptions[0]!

  const variantOptions = await ctx.panel.evaluate<FieldOption[]>(
    `window.api.getFieldOptions('standalone', 'variant', ${JSON.stringify({ release })})`,
  )
  expect(variantOptions.length, 'no standalone variants available').toBeGreaterThan(0)
  const cpuVariant = variantOptions.find((v) => /cpu/i.test(v.value))
  expect(cpuVariant, `no CPU variant exposed for release ${release.value}: ${JSON.stringify(variantOptions.map((v) => v.value))}`).toBeDefined()
})
