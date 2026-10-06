/**
 * E2E: a Performance Test runs alone. Starting one is refused, naming what is running, while any
 * other local ComfyUI Desktop started is up; once that is stopped, the Performance Test boots on
 * the installation itself (its own configured port), like a normal launch.
 *
 * Users meet this from File > Performance Tests with an installation already running. A second
 * ComfyUI competes for the GPU and memory, and on the same installation fails on its database lock.
 *
 * Two installations, so the refusal is shown for another installation, not only the benchmarked
 * one. The ComfyUI here is `fakeComfyInstall`. Linux only, because the stand-in is (see its header).
 */

import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { expectChooserVisible } from './support/chooserHelpers'
import { getIpcInvocations, getRunningSessionSnapshot } from './support/devHooks'
import { reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'

const BENCH_ID = 'inst-perf-guard-bench'
const OTHER_ID = 'inst-perf-guard-other'
const PERF_SESSION = `performance-test:${BENCH_ID}`

let profileDir = ''
const installPaths: Record<string, string> = {}
const ports: Record<string, number> = {}
let ctx: AppContext | null = null

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

interface LaunchResult {
  ok: boolean
  message?: string
}

async function launch(installationId: string, sessionKey: string): Promise<LaunchResult> {
  const actionData =
    sessionKey === PERF_SESSION
      ? { launchModeOverride: 'console', autoPortOnConflict: true, sessionIdOverride: PERF_SESSION }
      : { launchModeOverride: 'console' }
  return await ctx!.panel.evaluate<LaunchResult>(
    `window.api.runAction(${JSON.stringify(installationId)}, 'launch', ${JSON.stringify(actionData)})`
  )
}

async function stop(sessionKey: string): Promise<void> {
  await ctx!.panel.evaluate(`window.api.stopComfyUI(${JSON.stringify(sessionKey)})`)
  await expect.poll(() => getRunningSessionSnapshot(ctx!.app, sessionKey)).toBeNull()
}

async function events(name: string): Promise<Array<Record<string, unknown>>> {
  return (await getIpcInvocations(ctx!.app, `telemetry:${name}`)) as Array<Record<string, unknown>>
}

const installation = (id: string, name: string) => ({
  id,
  name,
  sourceId: 'comfybuilder',
  sourceLabel: 'ComfyBuilder',
  installPath: installPaths[id],
  status: 'installed',
  launchArgs: `--port ${ports[id]} --enable-assets`,
  launchMode: 'console',
  seen: true
})

test.beforeAll(async () => {
  // The app launches here, not in a test, so the hook needs the test's budget, not the 45s default.
  test.setTimeout(180_000)
  profileDir = await mkdtemp(path.join(os.tmpdir(), 'comfyui-perf-guard-profile-'))
  const taken = new Set<number>()
  const freshPort = async (): Promise<number> => {
    let port = await reserveFreePort()
    while (taken.has(port)) port = await reserveFreePort()
    taken.add(port)
    return port
  }
  for (const id of [BENCH_ID, OTHER_ID]) {
    installPaths[id] = await mkdtemp(path.join(os.tmpdir(), `comfyui-${id}-`))
    ports[id] = await freshPort()
    await writeFakeComfyInstall({ installPath: installPaths[id]!, port: ports[id]! })
  }
  // A CDP port of its own: the default is shared by every e2e run on the machine, and a
  // concurrent run holding it hangs this launch. Never one of the fixtures' ports.
  const cdpPort = await freshPort()
  ctx = await launchApp({
    cdpPort,
    profileDir,
    settings: { firstUseCompleted: true, telemetryEnabled: false, hasSeenCentralPillHint: true },
    installations: [
      installation(BENCH_ID, 'Bench Install'),
      installation(OTHER_ID, 'Other Install')
    ]
  })
  await expectChooserVisible(ctx.panel)
})

test.afterAll(async () => {
  for (const key of [PERF_SESSION, BENCH_ID, OTHER_ID]) {
    await ctx?.panel.evaluate(`window.api.stopComfyUI(${JSON.stringify(key)})`).catch(() => {})
  }
  await ctx?.cleanup()
  if (profileDir) await rm(profileDir, { recursive: true, force: true })
  for (const dir of Object.values(installPaths)) await rm(dir, { recursive: true, force: true })
})

test('a Performance Test is refused while another installation runs, and named @linux', async () => {
  const other = await launch(OTHER_ID, OTHER_ID)
  expect(other, other.message).toMatchObject({ ok: true })

  const perf = await launch(BENCH_ID, PERF_SESSION)

  expect(perf.ok).toBe(false)
  expect(perf.message).toContain('Other Install')
  expect(perf.message).toContain('Stop it in Comfy Desktop')
  expect(await getRunningSessionSnapshot(ctx!.app, PERF_SESSION)).toBeNull()
  expect(
    (await events('comfy.desktop.comfyui.boot_started')).filter(
      (e) => e.session_kind === 'performance_test'
    ),
    'no Performance Test ComfyUI was started'
  ).toEqual([])
  // The installation that was running is untouched.
  expect(await getRunningSessionSnapshot(ctx!.app, OTHER_ID)).not.toBeNull()
})

test('once that is stopped, the Performance Test boots on its installation, on its own port @linux', async () => {
  await stop(OTHER_ID)

  const perf = await launch(BENCH_ID, PERF_SESSION)

  expect(perf, perf.message).toMatchObject({ ok: true })
  expect((await getRunningSessionSnapshot(ctx!.app, PERF_SESSION))?.port).toBe(ports[BENCH_ID])
  expect((await events('comfy.desktop.comfyui.boot_completed')).at(-1)).toMatchObject({
    session_kind: 'performance_test'
  })
})

test('another installation still launches while a Performance Test runs @linux', async () => {
  const other = await launch(OTHER_ID, OTHER_ID)

  expect(other, other.message).toMatchObject({ ok: true })
  expect((await events('comfy.desktop.comfyui.boot_completed')).at(-1)).toMatchObject({
    session_kind: 'normal'
  })
  await stop(OTHER_ID)
  await stop(PERF_SESSION)
})
