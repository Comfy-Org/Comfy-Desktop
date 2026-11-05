import os from 'node:os'
import path from 'node:path'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import en from '../locales/en.json'
import { launchApp, type AppContext, type SeedInstallation } from './launchApp'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { getIpcInvocations, hasActiveLaunch, resetIpcInvocations } from './support/devHooks'
import { byTestId, TID } from './support/testIds'

const NEW_INSTALL_WIZARD = '.config-shell, .template-shell'

interface BuildCase {
  id: string
  name: string
  status: string
  installPath: string
}

const INSTALLED: BuildCase = {
  id: 'inst-comfybuilder-installed',
  name: 'desktop-4target-stg-v0190',
  status: 'installed',
  installPath: ''
}

const FAILED: BuildCase = {
  id: 'inst-comfybuilder-failed',
  name: 'desktop-4target-stg-v0192',
  status: 'failed',
  installPath: ''
}

let ctx: AppContext
let rootDir: string

test.describe.configure({ mode: 'serial' })

function buildRecord(build: BuildCase): SeedInstallation {
  return {
    id: build.id,
    name: build.name,
    sourceId: 'comfybuilder',
    sourceLabel: 'ComfyBuilder',
    installPath: build.installPath,
    distributionId: `d-${build.id}`,
    distributionName: build.name,
    version: '1',
    artifactId: 'a-1',
    artifactOs: process.platform === 'win32' ? 'windows' : 'mac',
    artifactGpu: 'cpu',
    artifactAccelVariant: 'cpu',
    launchArgs: '--enable-manager',
    launchMode: 'window',
    browserPartition: 'unique',
    status: build.status,
    seen: true
  }
}

async function writeBuildLayout(installPath: string): Promise<void> {
  await mkdir(path.join(installPath, 'ComfyUI'), { recursive: true })
  await writeFile(path.join(installPath, 'ComfyUI', 'main.py'), '')
  if (process.platform === 'win32') {
    await mkdir(path.join(installPath, 'venv'), { recursive: true })
    await writeFile(path.join(installPath, 'venv', 'python.exe'), '')
    return
  }
  await mkdir(path.join(installPath, 'venv', 'bin'), { recursive: true })
  const python = path.join(installPath, 'venv', 'bin', 'python3')
  await writeFile(python, '#!/bin/sh\nexit 1\n')
  await chmod(python, 0o755)
}

test.beforeAll(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-comfybuilder-e2e-'))
  const cases = [INSTALLED, FAILED]
  for (const build of cases) {
    build.installPath = path.join(rootDir, build.id)
    await writeBuildLayout(build.installPath)
  }

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: cases.map(buildRecord)
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (rootDir) await rm(rootDir, { recursive: true, force: true })
})

test('clicking an installed ComfyBuilder tile launches it instead of opening the new-install wizard @windows @macos', async () => {
  await resetIpcInvocations(ctx.app)
  await clickInstallTile(ctx.panel, INSTALLED.name)

  await expect
    .poll(
      async () => {
        const calls = (await getIpcInvocations(ctx.app, 'run-action')) as {
          installationId?: string
          actionId?: string
        }[]
        return calls.some((c) => c.installationId === INSTALLED.id && c.actionId === 'launch')
      },
      { timeout: 20_000, intervals: [200, 500] }
    )
    .toBe(true)

  await ctx.panel.waitForVisible('.brand-progress', { timeout: 10_000 })
  expect(await ctx.panel.exists(NEW_INSTALL_WIZARD)).toBe(false)

  await expect
    .poll(() => hasActiveLaunch(ctx.app, INSTALLED.id), {
      timeout: 30_000,
      intervals: [250, 500]
    })
    .toBe(false)
  await ctx.panel.waitForVisible(byTestId(TID.progressErrorMessage), { timeout: 10_000 })
  expect(await ctx.panel.click(byTestId(TID.progressBack))).toBe(true)
  await expectChooserVisible(ctx.panel)
})

test('clicking a not-ready ComfyBuilder tile explains itself instead of opening the new-install wizard @windows @macos', async () => {
  await clickInstallTile(ctx.panel, FAILED.name)

  await ctx.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(await ctx.panel.textOf('.base-alert-message-text')).toContain(en.errors.installNotReady)
  expect(await ctx.panel.exists(NEW_INSTALL_WIZARD)).toBe(false)

  await ctx.panel.click(byTestId(TID.baseAlertAction))
  await expectChooserVisible(ctx.panel)
})
