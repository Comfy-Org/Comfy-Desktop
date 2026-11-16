import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { InstallationRecord } from '../src/main/installations'
import { launchApp, type AppContext } from './launchApp'
import { WebContentsPage, waitForWebContents } from './support/cdpPages'
import { getRunningSessionSnapshot } from './support/devHooks'

let ctx: AppContext
let profileDir: string
let appLogPath: string

test.beforeAll(async () => {
  profileDir = await mkdtemp(path.join(os.tmpdir(), 'comfy-first-use-install-'))
  ctx = await launchApp({
    profileDir,
    settings: {
      firstUseCompleted: false,
      language: 'en',
      telemetryEnabled: false,
      installDir: path.join(profileDir, 'builds'),
      cacheDir: path.join(profileDir, 'downloads')
    }
  })
  appLogPath = path.join(await ctx.app.evaluate(({ app }) => app.getPath('logs')), 'app.log')
})

test.afterEach(async () => {
  const testInfo = test.info()
  if (!ctx || testInfo.status === testInfo.expectedStatus) return
  const diagnostics = await ctx.panel
    .evaluate(
      `(async () => {
      const installations = await window.api.getInstallations()
      const logs = await Promise.all(installations.map(async installation => ({
        id: installation.id,
        log: await window.api.logsSnapshot(installation.id)
      })))
      return { installations, logs }
    })()`
    )
    .catch(() => null)
  await testInfo.attach('installation-diagnostics', {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: 'application/json'
  })
  await testInfo
    .attach('desktop-log', { path: appLogPath, contentType: 'text/plain' })
    .catch(() => {})
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (profileDir) await rm(profileDir, { recursive: true, force: true })
})

test('first-use Install completes the recommended setup and opens ComfyUI @lifecycle', async () => {
  test.setTimeout(900_000)

  let recommendedVersion: string
  let installation: InstallationRecord

  const localInstallations = (): Promise<InstallationRecord[]> =>
    ctx.panel.evaluate<InstallationRecord[]>(
      `window.api.getInstallations().then(installs => installs.filter(inst => inst.sourceId === 'standalone'))`
    )

  await test.step('start with the recommended setup and no local installation', async () => {
    await ctx.panel.waitForVisible('[data-testid="setup-screen"]')
    await ctx.panel.waitForSelector('[data-testid="setup-install"]:not([aria-disabled="true"])', {
      timeout: 60_000
    })
    expect(await ctx.panel.textOf('[data-testid="setup-install"]')).toBe('Install')
    expect(await localInstallations()).toEqual([])
    expect(await ctx.panel.evaluate(`window.api.getSetting('firstUseCompleted')`)).toBe(false)

    const summary = await ctx.panel.textOf('[data-testid="setup-row-version"]')
    expect(summary).toMatch(/v?\d+\.\d+\.\d+/)
    recommendedVersion = summary!.match(/v?\d+\.\d+\.\d+/)![0].replace(/^v/, '')
  })

  await test.step('accept the terms and install directly from the setup screen', async () => {
    expect(await ctx.panel.click('[data-testid="setup-consent-tos"] [role="checkbox"]')).toBe(true)
    expect(await ctx.panel.click('[data-testid="setup-install"]')).toBe(true)
    await ctx.panel.waitForVisible('[data-testid="home-view"]', { timeout: 15_000 })
    await ctx.panel.waitForVisible('[data-testid="home-build-installing"]', { timeout: 15_000 })
    expect(await ctx.panel.exists('[data-testid="new-build-modal"]')).toBe(false)
    expect(await ctx.panel.exists('[data-testid="home-open-comfyui"]')).toBe(false)

    const installs = await localInstallations()
    expect(installs).toHaveLength(1)
    installation = installs[0]!
    expect(installation.status).toBe('installing')
    expect(installation.installPath).toBe(path.join(profileDir, 'builds', installation.name))
    expect(installation.comfyVersionTag).toBe(`v${recommendedVersion}`)
    expect(installation.updateChannel).toBe('stable')
    expect(installation.bundledTemplateId).toBeUndefined()
  })

  await test.step('finish the real download and installation on Home', async () => {
    await ctx.panel.waitForVisible('[data-testid="home-open-comfyui"]', { timeout: 720_000 })
    expect(await ctx.panel.exists('[data-testid="home-build-installing"]')).toBe(false)
    expect(await ctx.panel.exists('[data-testid="setup-screen"]')).toBe(false)

    const installs = await localInstallations()
    expect(installs).toHaveLength(1)
    expect(installs[0]).toMatchObject({ id: installation.id, status: 'installed' })
    expect(installs[0]!.comfyVersion).toMatchObject({
      baseTag: `v${recommendedVersion}`,
      commitsAhead: 0
    })
    expect((await stat(path.join(installation.installPath, 'ComfyUI', 'main.py'))).isFile()).toBe(
      true
    )
    expect(await readFile(path.join(installation.installPath, '.comfyui-desktop-2'), 'utf8')).toBe(
      installation.id
    )
    expect(await ctx.panel.evaluate(`window.api.getSetting('firstUseCompleted')`)).toBe(true)
  })

  await test.step('open the installed build and render its workflow editor', async () => {
    expect(await ctx.panel.click('[data-testid="home-open-comfyui"]')).toBe(true)
    await expect
      .poll(() => getRunningSessionSnapshot(ctx.app, installation.id), {
        timeout: 120_000,
        message: 'the installed build starts a real ComfyUI process'
      })
      .toMatchObject({ pid: expect.any(Number), port: expect.any(Number) })

    const session = await getRunningSessionSnapshot(ctx.app, installation.id)
    const origin = `http://127.0.0.1:${session!.port}`
    await waitForWebContents(ctx.app, origin, 180_000)
    const editor = new WebContentsPage(ctx.app, origin)
    await editor.waitForVisible('#graph-canvas', { timeout: 60_000 })
    await editor.waitForVisible('button[aria-label="Close dialog"]', {
      timeout: 30_000
    })
    expect(await editor.click('button[aria-label="Close dialog"]')).toBe(true)
    expect(await editor.click('#graph-canvas')).toBe(true)
    expect(await ctx.panel.isVisible('[data-testid="home-view"]')).toBe(true)
  })
})
