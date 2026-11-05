
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
      hasSeenCentralPillHint: true,
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
          baseTagVerified: true,
        },
      },
    ],
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
    `${INSTALL_ID}.json`,
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
  ctx = await launchApp(seed())
  await expectChooserVisible(ctx.panel)
  return ctx
}

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
      { timeout: 90_000, message: 'the install never booted a new ComfyUI stub' },
    )
    .toBe(true)
  stubPids.add(record!.childPid)
  return record!
}

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
      busy_override: false,
    }),
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
      'still running a prompt',
    )
    expect(isAlive(busy!.childPid), 'a busy ComfyUI is not stopped without asking').toBe(true)
    expect(await app.panel.exists(byTestId(TID.progressPortConflictUsePort))).toBe(false)
    expect(await priorEvents(app)).toEqual([
      expect.objectContaining({ action: 'busy_left', proof: 'desktop_record' }),
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
        { timeout: 90_000, message: 'stopping the busy ComfyUI never led to a new boot' },
      )
      .toBe(true)
    stubPids.add(replaced!.childPid)
    expect(isAlive(busy!.childPid)).toBe(false)
    expect(await priorEvents(app)).toEqual([
      expect.objectContaining({ action: 'busy_left' }),
      expect.objectContaining({ action: 'terminated', busy_override: true }),
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
      { timeout: 30_000, message: 'the busy check never started' },
    )

    expect(await app.panel.clickByText('.brand-progress__footer-btn', 'Return to Dashboard')).toBe(true)
    await app.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 5_000 })
    expect(await app.panel.click(byTestId(TID.baseAlertAction))).toBe(true)

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
  const previous = await readRecord()
  await crashDesktop(ctx!)
  if (previous) {
    try {
      process.kill(-previous.childPid, 'SIGKILL')
    } catch {}
    await expect.poll(() => isAlive(previous.childPid), { timeout: 10_000 }).toBe(false)
  }

  const manual = spawn(
    path.join(installPath, 'venv', 'bin', 'python3'),
    ['-s', path.join('ComfyUI', 'main.py'), '--port', String(port)],
    { cwd: installPath, detached: true, stdio: 'ignore' },
  )
  manual.unref()
  stubPids.add(manual.pid!)
  await expect.poll(portAnswers, { timeout: 30_000 }).toBe(true)

  const app = await start()
  await clickInstallTile(app.panel, INSTALL_NAME)
  await app.panel.waitForVisible(byTestId(TID.progressPortConflictBanner), { timeout: 60_000 })

  expect(isAlive(manual.pid!), 'a process Desktop did not start was left running').toBe(true)
  expect(await portAnswers()).toBe(true)
  expect(await priorEvents(app)).toEqual([])
})
