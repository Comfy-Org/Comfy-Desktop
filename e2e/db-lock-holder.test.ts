/**
 * E2E: a launch that fails on the database lock names the process holding it and, once the user
 * confirms, stops it and launches.
 *
 * The holder is the field shape: a `main.py` inside the install holding a real flock on its
 * `comfyui.db.lock` (what ComfyUI with assets takes), not on the port and with no Desktop record
 * of it, like a ComfyUI that restarted itself. It writes the holder record beside the lock, as
 * ComfyUI does; Desktop names and stops it from that record alone. The stub refuses to start
 * while the lock is held, as ComfyUI does.
 *
 * Linux only: the ComfyUI stand-in is `fakeComfyInstall` (see its header).
 */

import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { clickInstallTile, expectChooserVisible } from './support/chooserHelpers'
import { byTestId, TID } from './support/testIds'
import { reserveFreePort, writeFakeComfyInstall } from './support/fakeComfyInstall'

const INSTALL_NAME = 'Database Lock Install'

let profileDir = ''
let installPath = ''
let port = 0
let ctx: AppContext | null = null
let holder: ChildProcess | null = null

test.setTimeout(180_000)

const lockFile = (): string => path.join(installPath, 'ComfyUI', 'user', 'comfyui.db.lock')
const lockHeld = (): boolean => spawnSync('flock', ['-n', lockFile(), 'true']).status === 1
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
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

test.beforeAll(async () => {
  profileDir = await mkdtemp(path.join(os.tmpdir(), 'comfyui-db-lock-profile-'))
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-db-lock-install-'))
  port = await reserveFreePort()
  await writeFakeComfyInstall({ installPath, port })
  await mkdir(path.dirname(lockFile()), { recursive: true })
  const script = path.join(installPath, 'ComfyUI', 'restarted', 'main.py')
  await mkdir(path.dirname(script), { recursive: true })
  // What a ComfyUI that writes the holder record does: take the lock, then record itself
  // beside it (Linux start token: boot id and /proc start ticks).
  await writeFile(
    script,
    [
      'import fcntl, json, os, sys, time',
      'lock = sys.argv[1]',
      'fd = os.open(lock, os.O_RDWR | os.O_CREAT)',
      'fcntl.flock(fd, fcntl.LOCK_EX)',
      "boot = open('/proc/sys/kernel/random/boot_id').read().strip()",
      "stat = open('/proc/self/stat').read()",
      "ticks = stat[stat.rindex(')') + 2:].split()[19]",
      "record = {'version': 1, 'pid': os.getpid(), 'started': boot + ':' + ticks,",
      "          'main': os.path.abspath(sys.argv[0]), 'argv': sys.argv, 'port': 0, 'listen': ''}",
      "tmp = lock + '.json.' + str(os.getpid()) + '.tmp'",
      "with open(tmp, 'w') as f:",
      '    json.dump(record, f)',
      "os.replace(tmp, lock + '.json')",
      'time.sleep(600)',
      '',
    ].join('\n'),
  )
  holder = spawn('python3', [script, lockFile()], { detached: true, stdio: 'ignore' })
  await expect.poll(lockHeld, { timeout: 10_000 }).toBe(true)
  await expect.poll(() => existsSync(`${lockFile()}.json`), { timeout: 10_000 }).toBe(true)
})

test.afterAll(async () => {
  await ctx?.cleanup()
  try {
    process.kill(-holder!.pid!, 'SIGKILL')
  } catch {}
  await rm(profileDir, { recursive: true, force: true })
  await rm(installPath, { recursive: true, force: true })
})

test('offers to stop a restarted ComfyUI of this install holding the lock, and launches @linux', async () => {
  test.skip(process.platform !== 'linux', 'fakeComfyInstall is Linux-only')
  ctx = await launchApp({
    profileDir,
    cdpPort: await reserveFreePort(),
    settings: { firstUseCompleted: true, telemetryEnabled: false, hasSeenCentralPillHint: true },
    installations: [
      {
        id: 'inst-db-lock',
        name: INSTALL_NAME,
        sourceId: 'comfybuilder',
        sourceLabel: 'ComfyBuilder',
        installPath,
        status: 'installed',
        launchArgs: `--port ${port} --enable-assets`,
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
  })
  await expectChooserVisible(ctx.panel)
  await clickInstallTile(ctx.panel, INSTALL_NAME)

  // The failure offers the stop; the confirm names the holder (the only process with the lock
  // file open) by its real pid, and nothing is stopped while it waits for the user.
  await ctx.panel.waitForVisible(byTestId(TID.progressDbLockStop), { timeout: 90_000 })
  expect(await ctx.panel.click(byTestId(TID.progressDbLockStop))).toBe(true)
  await ctx.panel.waitForVisible(byTestId(TID.baseAlertAction), { timeout: 30_000 })
  const confirm = await ctx.panel.textOf('.base-alert-message')
  // Proven this install's: the plain confirm, not the "could not confirm" one.
  expect(confirm).toContain(`will forcefully stop ComfyUI (PID ${holder!.pid})`)
  expect(isAlive(holder!.pid!)).toBe(true)
  expect(lockHeld()).toBe(true)

  expect(await ctx.panel.click(byTestId(TID.baseAlertAction))).toBe(true)
  await expect.poll(() => isAlive(holder!.pid!), { timeout: 30_000 }).toBe(false)
  await expect.poll(portAnswers, { timeout: 90_000 }).toBe(true)
})
