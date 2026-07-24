/**
 * Lifecycle E2E: launching a ComfyBuilder distribution from the chooser.
 *
 * The renderer resolves launch ONLY from `get-list-actions`
 * (`performChooserLaunch`), so a source plugin without `getListActions`
 * hands it an empty array, which reads as "this install cannot launch" and
 * bounces the tile click into the new-install wizard. This file pins the
 * comfybuilder plugin's `getListActions` end-to-end:
 *
 *   1. an installed distribution tile launches (run-action `launch` plus the
 *      progress takeover) and never mounts the wizard;
 *   2. a not-yet-installed distribution exposes a DISABLED launch action
 *      carrying the not-ready message, and clicking its tile explains itself
 *      instead of bouncing into the wizard.
 *
 * The seeded venv python exits immediately, so the launch is attempted and
 * then fails at the boot wait. Attempted-vs-never-attempted is the whole
 * discriminator here; a real ComfyUI boot is not.
 */

import os from 'node:os'
import path from 'node:path'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import en from '../locales/en.json'
import { launchApp, type AppContext, type SeedInstallation } from './launchApp'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { getIpcInvocations, resetIpcInvocations } from './support/devHooks'
import { byTestId, TID } from './support/testIds'

/** Both steps of the new-install wizard: the surface a missing launch action
 *  used to bounce the user into. */
const NEW_INSTALL_WIZARD = '.config-shell, .template-shell'

interface DistributionCase {
  id: string
  name: string
  status: string
  installPath: string
}

const INSTALLED: DistributionCase = {
  id: 'inst-comfybuilder-installed',
  name: 'desktop-4target-stg-v0190',
  status: 'installed',
  installPath: '',
}

/** `installing` never reaches the chooser (`enrichInstallationsForRenderer`
 *  filters it out), so only the `failed` row also renders as a tile. */
const NOT_READY: DistributionCase[] = [
  { id: 'inst-comfybuilder-installing', name: 'desktop-4target-stg-v0191', status: 'installing', installPath: '' },
  { id: 'inst-comfybuilder-failed', name: 'desktop-4target-stg-v0192', status: 'failed', installPath: '' },
]

const FAILED = NOT_READY[1]!

interface ListActionShape {
  id: string
  enabled: boolean
  disabledMessage?: string
}

let ctx: AppContext
let rootDir: string

test.describe.configure({ mode: 'serial' })

/** Mirrors what `installDistribution` writes for a real distribution install. */
function distributionRecord(dist: DistributionCase): SeedInstallation {
  return {
    id: dist.id,
    name: dist.name,
    sourceId: 'comfybuilder',
    sourceLabel: 'ComfyBuilder',
    installPath: dist.installPath,
    distributionId: `d-${dist.id}`,
    distributionName: dist.name,
    version: '1',
    artifactId: 'a-1',
    artifactOs: 'macos',
    artifactGpu: 'cpu',
    artifactAccelVariant: 'cpu',
    launchArgs: '--enable-manager',
    launchMode: 'window',
    browserPartition: 'unique',
    status: dist.status,
    seen: true,
  }
}

/** `buildLaunchSpec` returns null unless the venv interpreter and
 *  `ComfyUI/main.py` both exist, and a null launch command fails the launch
 *  before it is ever attempted. Written for every case so the disabled-action
 *  assertions prove the gate is the record status, not the disk. */
async function writeDistributionLayout(installPath: string): Promise<void> {
  await mkdir(path.join(installPath, 'ComfyUI'), { recursive: true })
  await writeFile(path.join(installPath, 'ComfyUI', 'main.py'), '')
  if (process.platform === 'win32') {
    await mkdir(path.join(installPath, 'venv'), { recursive: true })
    await writeFile(path.join(installPath, 'venv', 'python.exe'), '')
    return
  }
  await mkdir(path.join(installPath, 'venv', 'bin'), { recursive: true })
  const python = path.join(installPath, 'venv', 'bin', 'python3')
  // Exits straight away so the attempted launch dies at the boot wait rather
  // than leaking a background process.
  await writeFile(python, '#!/bin/sh\nexit 1\n')
  await chmod(python, 0o755)
}

test.beforeAll(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-comfybuilder-e2e-'))
  const cases = [INSTALLED, ...NOT_READY]
  for (const dist of cases) {
    dist.installPath = path.join(rootDir, dist.id)
    await writeDistributionLayout(dist.installPath)
  }

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false },
    installations: cases.map(distributionRecord),
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  if (rootDir) await rm(rootDir, { recursive: true, force: true })
})

for (const dist of NOT_READY) {
  test(`ComfyBuilder distribution in ${dist.status} exposes a disabled launch action @lifecycle`, async () => {
    const actions = await ctx.panel.evaluate<ListActionShape[]>(
      `window.api.getListActions(${JSON.stringify(dist.id)})`,
    )
    expect(actions.map((a) => a.id)).toContain('launch')
    const launch = actions.find((a) => a.id === 'launch')!
    expect(launch.enabled).toBe(false)
    expect(launch.disabledMessage).toBe(en.errors.installNotReady)
  })
}

test('clicking a not-ready ComfyBuilder tile explains itself instead of opening the new-install wizard @lifecycle', async () => {
  await clickInstallTile(ctx.panel, FAILED.name)

  // `useListAction` short-circuits a disabled action into an alert, so the
  // user is told why nothing launched rather than being handed a wizard.
  await ctx.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 10_000 })
  expect(await ctx.panel.textOf('.base-alert-message-text')).toContain(en.errors.installNotReady)
  expect(await ctx.panel.exists(NEW_INSTALL_WIZARD)).toBe(false)

  await ctx.panel.click(byTestId(TID.baseAlertAction))
  await expectChooserVisible(ctx.panel)
})

test('clicking an installed ComfyBuilder tile launches it instead of opening the new-install wizard @lifecycle', async () => {
  await resetIpcInvocations(ctx.app)
  await clickInstallTile(ctx.panel, INSTALLED.name)

  // The whole chain (tile pick -> get-list-actions -> useListAction ->
  // show-progress -> run-action) ends here; with no launch action in the
  // list it never starts and the wizard takes over instead.
  await expect
    .poll(async () => {
      const calls = (await getIpcInvocations(ctx.app, 'run-action')) as
        { installationId?: string; actionId?: string }[]
      return calls.some((c) => c.installationId === INSTALLED.id && c.actionId === 'launch')
    }, { timeout: 20_000, intervals: [200, 500] })
    .toBe(true)

  await ctx.panel.waitForVisible('.brand-progress', { timeout: 10_000 })
  expect(await ctx.panel.exists(NEW_INSTALL_WIZARD)).toBe(false)
})
