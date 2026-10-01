/**
 * E2E: Desktop cleans up a ComfyUI that an earlier, crashed Desktop left running, and nothing
 * else.
 *
 * With assets on, ComfyUI holds an OS lock on its database, so an orphan left by a Desktop that
 * died makes the next launch fail. This spec creates a real orphan the way users get one — the
 * Desktop main process is SIGKILLed while ComfyUI runs — and then relaunches the app on the SAME
 * profile:
 *
 *   1. the orphan is proven ours (the ownership record, pid + start time) and stopped, the new
 *      boot comes up on the same port, and `prior_process_found` reports it;
 *   2. an orphan that is still running a prompt is left alone until the user chooses to stop it;
 *   3. a ComfyUI Desktop did not start (a manual launch of the same install) is never stopped.
 *
 * Linux only: the ComfyUI stand-in is `fakeComfyInstall`, which is Linux-only (see its header),
 * and profile reuse is not supported on macOS.
 */

import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext, type SeedOptions } from './launchApp'
import { waitForAppExit } from './support/electronHarness'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { getIpcInvocations } from './support/devHooks'
import { byTestId, TID } from './support/testIds'
import { reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'

const INSTALL_ID = 'inst-process-ownership'
const INSTALL_NAME = 'Process Ownership Install'
const PRIOR_EVENT = 'telemetry:comfy.desktop.comfyui.prior_process_found'

let profileDir = ''
let installPath = ''
let port = 0
let ctx: AppContext | null = null
/** Every stub pid this spec has seen, so a failure never leaks one. */
const stubPids = new Set<number>()

interface OwnershipRecord {
  childPid: number
  childStartTime: string | null
  desktopPid: number
  port: number
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

function seed(): SeedOptions {
  return {
    profileDir,
    settings: {
      firstUseCompleted: true,
      telemetryEnabled: false,
      hasSeenCentralPillHint: true
    },
    installations: [
      {
        id: INSTALL_ID,
        name: INSTALL_NAME,
        sourceId: 'comfybuilder',
        sourceLabel: 'ComfyBuilder',
        installPath,
        status: 'installed',
        launchArgs: `--port ${port}`,
        launchMode: 'window',
        browserPartition: 'unique',
        seen: true,
        comfyVersion: {
          commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          baseTag: 'v0.3.99',
          commitsAhead: 0,
          baseTagVerified: true
        }
      }
    ]
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function readRecord(): Promise<OwnershipRecord | null> {
  const file = path.join(
    profileDir,
    '.local',
    'state',
    'comfyui-desktop-2',
    'comfy-procs',
    `${INSTALL_ID}.json`
  )
  try {
    return JSON.parse(await readFile(file, 'utf-8')) as OwnershipRecord
  } catch {
    return null
  }
}

function portAnswers(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1_000 }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function start(): Promise<AppContext> {
  // A fresh CDP port each time: an orphan inherits the previous app's listening socket.
  ctx = await launchApp({ ...seed(), cdpPort: await reserveFreePort() })
  await expectChooserVisible(ctx.panel)
  return ctx
}

/** Launch the install from the chooser and wait until a NEW stub (not `previousPid`) serves
 *  the port and its record carries a start time. */
async function launchInstall(app: AppContext, previousPid?: number): Promise<OwnershipRecord> {
  await clickInstallTile(app.panel, INSTALL_NAME)
  let record: OwnershipRecord | null = null
  await expect
    .poll(
      async () => {
        record = await readRecord()
        return (
          !!record &&
          record.childPid !== previousPid &&
          !!record.childStartTime &&
          isAlive(record.childPid) &&
          (await portAnswers())
        )
      },
      { timeout: 90_000, message: 'the install never booted a new ComfyUI stub' }
    )
    .toBe(true)
  stubPids.add(record!.childPid)
  return record!
}

/** What users hit: the Desktop main process dies with ComfyUI running. Only the main process
 *  is killed; Chromium's own helpers exit once it is gone, and are cleared if they linger so the
 *  next launch starts clean. ComfyUI is in a session of its own, so the group kill cannot reach
 *  it. */
async function crashDesktop(app: AppContext): Promise<void> {
  const pid = app.app.process().pid!
  process.kill(pid, 'SIGKILL')
  await waitForAppExit(app.app, 15_000)
  const groupAlive = (): boolean => {
    try {
      process.kill(-pid, 0)
      return true
    } catch {
      return false
    }
  }
  const deadline = Date.now() + 10_000
  while (groupAlive() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {}
  await expect.poll(groupAlive, { timeout: 10_000 }).toBe(false)
  // No `cleanup()`: a signal-killed process keeps `exitCode === null` (the signal is in
  // `signalCode`), so the harness would try to close an app that is already gone and hang. The
  // profile is ours to keep until afterAll.
  ctx = null
}

async function priorEvents(app: AppContext): Promise<Array<Record<string, unknown>>> {
  return (await getIpcInvocations(app.app, PRIOR_EVENT)) as Array<Record<string, unknown>>
}

test.beforeAll(async () => {
  profileDir = await mkdtemp(path.join(os.tmpdir(), 'comfyui-process-ownership-profile-'))
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-process-ownership-install-'))
  port = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port })
})

test.afterAll(async () => {
  await ctx?.cleanup()
  for (const pid of stubPids) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {}
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
  if (profileDir) await rm(profileDir, { recursive: true, force: true })
  if (installPath) await rm(installPath, { recursive: true, force: true })
})

test('an orphan left by a killed Desktop is stopped, and the install boots on its port again @linux', async () => {
  const first = await launchInstall(await start())
  expect(first.port).toBe(port)

  await crashDesktop(ctx!)
  // The precondition the fix exists for: ComfyUI outlived its Desktop and still holds the port.
  expect(isAlive(first.childPid), 'ComfyUI outlived the killed Desktop').toBe(true)
  expect(await portAnswers()).toBe(true)
  const app = await start()
  const second = await launchInstall(app, first.childPid)

  expect(isAlive(first.childPid), 'the orphan was stopped').toBe(false)
  expect(second.port, 'the new boot did not move to another port').toBe(port)
  expect(second.desktopPid).toBe(app.app.process().pid)
  expect(await priorEvents(app)).toEqual([
    expect.objectContaining({
      installation_id: INSTALL_ID,
      action: 'terminated',
      proof: 'desktop_record',
      exited_in_time: true,
      busy_override: false
    })
  ])
})

test('an orphan still running a prompt is left alone until the user stops it @linux', async () => {
  const busy = await readRecord()
  expect(busy && isAlive(busy.childPid)).toBe(true)
  await writeFile(path.join(installPath, 'queue-busy'), '')
  try {
    await crashDesktop(ctx!)
    const app = await start()
    await clickInstallTile(app.panel, INSTALL_NAME)

    await app.panel.waitForVisible(byTestId(TID.progressPortConflictBanner), { timeout: 60_000 })
    expect(await app.panel.textOf(byTestId(TID.progressPortConflictBanner))).toContain(
      'still running a prompt'
    )
    expect(isAlive(busy!.childPid), 'a busy ComfyUI is not stopped without asking').toBe(true)
    expect(await app.panel.exists(byTestId(TID.progressPortConflictUsePort))).toBe(false)
    expect(await priorEvents(app)).toEqual([
      expect.objectContaining({ action: 'busy_left', proof: 'desktop_record' })
    ])

    expect(await app.panel.click(byTestId(TID.progressPortConflictKill))).toBe(true)
    await app.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 5_000 })
    expect(await app.panel.click(byTestId(TID.baseAlertAction))).toBe(true)

    let replaced: OwnershipRecord | null = null
    await expect
      .poll(
        async () => {
          replaced = await readRecord()
          return (
            !!replaced &&
            replaced.childPid !== busy!.childPid &&
            !!replaced.childStartTime &&
            (await portAnswers())
          )
        },
        { timeout: 90_000, message: 'stopping the busy ComfyUI never led to a new boot' }
      )
      .toBe(true)
    stubPids.add(replaced!.childPid)
    expect(isAlive(busy!.childPid)).toBe(false)
    expect(await priorEvents(app)).toEqual([
      expect.objectContaining({ action: 'busy_left' }),
      expect.objectContaining({ action: 'terminated', busy_override: true })
    ])
  } finally {
    await rm(path.join(installPath, 'queue-busy'), { force: true })
  }
})

test('cancelling from the busy check stops nothing and starts nothing @linux', async () => {
  const before = await readRecord()
  expect(before && isAlive(before.childPid)).toBe(true)
  await writeFile(path.join(installPath, 'queue-hang'), '')
  try {
    await crashDesktop(ctx!)
    const app = await start()
    await clickInstallTile(app.panel, INSTALL_NAME)
    await app.panel.waitFor(
      async () =>
        (await app.panel.allText('.brand-progress__status'))
          .join(' ')
          .includes('Checking an earlier ComfyUI'),
      { timeout: 30_000, message: 'the busy check never started' }
    )

    // The real in-flight footer button, then its confirmation: the cancel only happens once
    // "Cancel operation" is confirmed.
    expect(await app.panel.clickByText('.brand-progress__footer-btn', 'Return to Dashboard')).toBe(
      true
    )
    await app.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 5_000 })
    expect(await app.panel.click(byTestId(TID.baseAlertAction))).toBe(true)

    // Well past the 10 s check: no busy prompt, nothing stopped, nothing spawned.
    await new Promise((r) => setTimeout(r, 12_000))
    expect(await app.panel.exists(byTestId(TID.progressPortConflictBanner))).toBe(false)
    expect(isAlive(before!.childPid), 'the earlier ComfyUI was left running').toBe(true)
    expect((await readRecord())?.childPid).toBe(before!.childPid)
    expect(await priorEvents(app)).toEqual([])
  } finally {
    await rm(path.join(installPath, 'queue-hang'), { force: true })
  }
})

test('a ComfyUI of the same install that Desktop did not start is never stopped @linux', async () => {
  // End the previous run completely, including its ComfyUI, so what holds the port next is
  // provably not something Desktop spawned.
  const previous = await readRecord()
  await crashDesktop(ctx!)
  if (previous) {
    try {
      process.kill(-previous.childPid, 'SIGKILL')
    } catch {}
    await expect.poll(() => isAlive(previous.childPid), { timeout: 10_000 }).toBe(false)
  }

  // A manual launch of the same install: same interpreter, same main.py, same port.
  const manual = spawn(
    path.join(installPath, 'venv', 'bin', 'python3'),
    ['-s', path.join('ComfyUI', 'main.py'), '--port', String(port)],
    { cwd: installPath, detached: true, stdio: 'ignore' }
  )
  manual.unref()
  stubPids.add(manual.pid!)
  await expect.poll(portAnswers, { timeout: 30_000 }).toBe(true)

  const app = await start()
  await clickInstallTile(app.panel, INSTALL_NAME)
  await app.panel.waitForVisible(byTestId(TID.progressPortConflictBanner), { timeout: 60_000 })

  expect(isAlive(manual.pid!), 'a process Desktop did not start was left running').toBe(true)
  expect(await portAnswers()).toBe(true)
  // The stale record of the ComfyUI stopped above proves nothing and is dropped silently.
  expect(await priorEvents(app)).toEqual([])
})

// On Linux the SIGKILL teardown and its bookkeeping finish before Electron completes a quit, so
// this passes with or without the quit's wait (checked by disabling it). It pins the outcome end
// to end; the wait itself is proven by `quitWait.test.ts`. On Windows, where termination is
// asynchronous, the wait is what makes it hold.
test('a quit leaves nothing behind, and an immediate relaunch finds nothing to handle @linux', async () => {
  // Start clean: nothing of this install running, no record.
  if (ctx) await crashDesktop(ctx)
  for (const pid of stubPids) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {}
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
  await expect.poll(portAnswers, { timeout: 15_000 }).toBe(false)
  await rm(
    path.join(
      profileDir,
      '.local',
      'state',
      'comfyui-desktop-2',
      'comfy-procs',
      `${INSTALL_ID}.json`
    ),
    { force: true }
  )

  const running = await launchInstall(await start())
  const app = ctx!
  await app.app.evaluate(({ app }) => app.quit())
  await waitForAppExit(app.app, 30_000)
  ctx = null

  // By the time Desktop is gone, so is its ComfyUI, and its exit has been recorded.
  expect(isAlive(running.childPid), 'ComfyUI outlived the quit').toBe(false)
  expect(await readRecord(), 'the exit was recorded before Desktop exited').toBeNull()

  const next = await start()
  const relaunched = await launchInstall(next, running.childPid)
  expect(relaunched.port, 'the relaunch boots on the same port').toBe(port)
  expect(await priorEvents(next), 'nothing was left for the relaunch to handle').toEqual([])
})
