import { spawn, type ChildProcess } from 'node:child_process'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createShutdown, isPidAlive, killProcessTrees } from './appShutdown'

const IDLE = 'setInterval(() => {}, 1000)'
const LAUNCHER_THAT_STARTS_THE_APP = `
const { spawn } = require('node:child_process')
const app = spawn(process.execPath, ['-e', ${JSON.stringify(IDLE)}], { stdio: 'ignore' })
process.stdout.write(String(app.pid) + '\\n')
${IDLE}
`

const started: number[] = []

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => child.once('exit', () => resolve()))
}

async function launchShellAndApp(): Promise<{ launcher: ChildProcess; appPid: number }> {
  const launcher = spawn(process.execPath, ['-e', LAUNCHER_THAT_STARTS_THE_APP], {
    stdio: ['ignore', 'pipe', 'ignore']
  })
  const appPid = await new Promise<number>((resolve, reject) => {
    launcher.stdout!.once('data', (chunk: Buffer) => resolve(Number(chunk.toString().trim())))
    launcher.once('error', reject)
  })
  started.push(launcher.pid!, appPid)
  return { launcher, appPid }
}

const never = (): Promise<void> => new Promise(() => {})

afterEach(() => {
  killProcessTrees(started.filter(isPidAlive))
  started.length = 0
})

describe('app shutdown', () => {
  it('stops the app itself, not only the launcher, when a graceful close hangs', async () => {
    const { launcher, appPid } = await launchShellAndApp()
    const log = vi.fn()
    const shutdown = createShutdown(
      { launcher, appPid, closeGracefully: never, connectionClosed: () => false },
      { gracefulCloseMs: 100, log }
    )

    await shutdown()

    expect(isPidAlive(appPid), 'the app process is gone').toBe(false)
    await exited(launcher)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('did not quit within 100ms'))
  })

  it('stops an app left running after its launcher already exited', async () => {
    const { launcher, appPid } = await launchShellAndApp()
    launcher.kill('SIGKILL')
    await exited(launcher)
    expect(isPidAlive(appPid)).toBe(true)

    await createShutdown({
      launcher,
      appPid,
      closeGracefully: never,
      connectionClosed: () => true
    })()

    expect(isPidAlive(appPid)).toBe(false)
  })

  it('does not force anything when the app quits on its own', async () => {
    const { launcher, appPid } = await launchShellAndApp()
    const forceKill = vi.fn()
    const closeGracefully = async (): Promise<void> => {
      killProcessTrees([launcher.pid!, appPid])
      await exited(launcher)
    }

    await createShutdown(
      { launcher, appPid, closeGracefully, connectionClosed: () => false },
      { forceKill }
    )()

    expect(forceKill).not.toHaveBeenCalled()
    expect(isPidAlive(appPid)).toBe(false)
  })

  it('fails loudly within its deadline when the app survives the forced kill', async () => {
    const { launcher, appPid } = await launchShellAndApp()
    const shutdown = createShutdown(
      { launcher, appPid, closeGracefully: never, connectionClosed: () => false },
      { gracefulCloseMs: 50, forcedExitMs: 200, forceKill: () => {}, log: () => {} }
    )

    await expect(shutdown()).rejects.toThrow(String(appPid))
  })

  it('runs one shutdown when cleanup is called twice at once', async () => {
    const { launcher, appPid } = await launchShellAndApp()
    const closeGracefully = vi.fn(never)
    const shutdown = createShutdown(
      { launcher, appPid, closeGracefully, connectionClosed: () => false },
      { gracefulCloseMs: 50, log: () => {} }
    )

    await Promise.all([shutdown(), shutdown()])

    expect(closeGracefully).toHaveBeenCalledTimes(1)
    expect(isPidAlive(appPid)).toBe(false)
  })
})
