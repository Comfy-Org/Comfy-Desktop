/**
 * E2E: a Performance Test runs ComfyUI on an in-memory database, so it boots beside the
 * install's own session instead of failing on the database lock, and never writes into the
 * install's catalogue.
 *
 * Users hit this by opening File > Performance Tests while the install is running (or by
 * launching the install mid-benchmark). With assets on, Core holds `<db>.lock` for its whole
 * life, so whichever of the two booted second used to exit with "database is locked".
 *
 * Both orders are covered, and the Performance Test runs to its results so the results file is
 * checked too. The ComfyUI here is `fakeComfyInstall` with `coreDb`, which models Core's lock
 * contract (exclusive `<db>.lock`, a boot write into the database, Core's own refusal lines);
 * that the real Core honours `sqlite:///:memory:` is checked against a real Core outside this
 * suite. Linux only, because the stand-in is (see its header).
 */

import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { getIpcInvocations, getRunningSessionSnapshot } from './support/devHooks'
import { reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'

const INSTALL_ID = 'inst-perf-memory-db'
const PERF_SESSION = `performance-test:${INSTALL_ID}`

let profileDir = ''
let installPath = ''
let port = 0
let ctx: AppContext | null = null

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

interface LaunchResult {
  ok: boolean
  message?: string
}

interface PerfRunResult {
  ok: boolean
  message?: string
  resultsSummary?: { instance: { databaseMode?: string } }
}

const dbPath = (): string => path.join(installPath, 'ComfyUI', 'user', 'comfyui.db')

async function dbBytes(): Promise<string | null> {
  try {
    return await readFile(dbPath(), 'utf-8')
  } catch {
    return null
  }
}

async function launch(sessionKey: string): Promise<LaunchResult> {
  const actionData =
    sessionKey === PERF_SESSION
      ? { launchModeOverride: 'console', autoPortOnConflict: true, sessionIdOverride: PERF_SESSION }
      : { launchModeOverride: 'console' }
  return await ctx!.panel.evaluate<LaunchResult>(
    `window.api.runAction(${JSON.stringify(INSTALL_ID)}, 'launch', ${JSON.stringify(actionData)})`,
  )
}

async function stop(sessionKey: string): Promise<void> {
  await ctx!.panel.evaluate(`window.api.stopComfyUI(${JSON.stringify(sessionKey)})`)
  await expect.poll(() => getRunningSessionSnapshot(ctx!.app, sessionKey)).toBeNull()
}

/** A one-node API workflow in a managed benchmarks session directory, where the view's own
 *  import puts one. */
async function writeWorkflow(): Promise<string> {
  const home = await ctx!.app.evaluate(({ app }) => app.getPath('home'))
  const dir = path.join(home, 'ComfyUI-Shared', 'benchmarks', '20261003000000')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'workflow.json')
  await writeFile(file, JSON.stringify({ '1': { class_type: 'KSampler', inputs: { seed: 1 } } }))
  return file
}

async function events(name: string): Promise<Array<Record<string, unknown>>> {
  return (await getIpcInvocations(ctx!.app, `telemetry:${name}`)) as Array<Record<string, unknown>>
}

test.beforeAll(async () => {
  profileDir = await mkdtemp(path.join(os.tmpdir(), 'comfyui-perf-memory-db-profile-'))
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-perf-memory-db-install-'))
  port = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port, coreDb: true })
  ctx = await launchApp({
    profileDir,
    settings: { firstUseCompleted: true, telemetryEnabled: false, hasSeenCentralPillHint: true },
    installations: [
      {
        id: INSTALL_ID,
        name: 'Perf Memory DB Install',
        sourceId: 'comfybuilder',
        sourceLabel: 'ComfyBuilder',
        installPath,
        status: 'installed',
        launchArgs: `--port ${port} --enable-assets`,
        launchMode: 'console',
        seen: true,
        comfyVersion: {
          commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          baseTag: 'v0.17.0',
          commitsAhead: 0,
          baseTagVerified: true,
        },
      },
    ],
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  for (const key of [PERF_SESSION, INSTALL_ID]) {
    await ctx?.panel.evaluate(`window.api.stopComfyUI(${JSON.stringify(key)})`).catch(() => {})
  }
  await ctx?.cleanup()
  if (profileDir) await rm(profileDir, { recursive: true, force: true })
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

test('a Performance Test boots beside the running install and leaves its database untouched @linux', async () => {
  const first = await launch(INSTALL_ID)
  expect(first, first.message).toMatchObject({ ok: true })
  const install = await getRunningSessionSnapshot(ctx!.app, INSTALL_ID)
  // The precondition: the install's own session holds the database and has written to it.
  const before = await dbBytes()
  expect(before, 'the install session wrote its catalogue').toContain('scan by')

  const perf = await launch(PERF_SESSION)
  expect(perf, perf.message).toMatchObject({ ok: true })
  const run = await ctx!.panel.evaluate<PerfRunResult>(
    `window.api.runPerformanceTestWorkflow(${JSON.stringify(PERF_SESSION)}, ${JSON.stringify(
      await writeWorkflow(),
    )}, 1, 0)`,
  )
  expect(run, run.message).toMatchObject({ ok: true })
  expect(run.resultsSummary?.instance.databaseMode).toBe('memory')

  expect(await getRunningSessionSnapshot(ctx!.app, INSTALL_ID)).toMatchObject({ pid: install!.pid })
  expect(await dbBytes(), "the install's database is byte-for-byte unchanged").toBe(before)
  expect(await events('comfy.desktop.comfyui.boot_failed')).toEqual([])
  expect(await events('comfy.desktop.comfyui.boot_completed')).toEqual([
    expect.objectContaining({ session_kind: 'normal', db_mode: 'file' }),
    expect.objectContaining({ session_kind: 'performance_test', db_mode: 'memory' }),
  ])
  await stop(PERF_SESSION)
  expect(await dbBytes()).toBe(before)
})

test('the install boots while a Performance Test is running @linux', async () => {
  await stop(INSTALL_ID)
  const before = await dbBytes()

  const perf = await launch(PERF_SESSION)
  expect(perf, perf.message).toMatchObject({ ok: true })
  const perfSession = await getRunningSessionSnapshot(ctx!.app, PERF_SESSION)
  expect(await dbBytes(), 'the Performance Test did not open the database').toBe(before)
  const second = await launch(INSTALL_ID)
  expect(second, second.message).toMatchObject({ ok: true })

  // The install booted on its own database (its boot wrote to it), on a port of its own...
  expect((await dbBytes())?.split('scan by').length).toBe((before?.split('scan by').length ?? 1) + 1)
  const install = await getRunningSessionSnapshot(ctx!.app, INSTALL_ID)
  expect(install!.port).not.toBe(perfSession!.port)
  // ...and the same Performance Test ComfyUI still runs its benchmark to results.
  expect(await getRunningSessionSnapshot(ctx!.app, PERF_SESSION)).toMatchObject({
    pid: perfSession!.pid,
  })
  const run = await ctx!.panel.evaluate<PerfRunResult>(
    `window.api.runPerformanceTestWorkflow(${JSON.stringify(PERF_SESSION)}, ${JSON.stringify(
      await writeWorkflow(),
    )}, 1, 0)`,
  )
  expect(run, run.message).toMatchObject({ ok: true })
  expect(run.resultsSummary?.instance.databaseMode).toBe('memory')
  expect(await events('comfy.desktop.comfyui.boot_failed')).toEqual([])
  expect((await events('comfy.desktop.comfyui.boot_completed')).slice(-2)).toEqual([
    expect.objectContaining({ session_kind: 'performance_test', db_mode: 'memory' }),
    expect.objectContaining({ session_kind: 'normal', db_mode: 'file' }),
  ])
  await stop(PERF_SESSION)
  await stop(INSTALL_ID)
})
