import { spawn, type ChildProcess } from 'node:child_process'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createShutdown,
  descendantsOf,
  isPidAlive,
  killProcessTrees,
  ProcessLookupError,
  processStartTime
} from './appShutdown'

const IDLE = 'setInterval(() => {}, 1000)'
const LAUNCHER_THAT_STARTS_THE_APP = `
const { spawn } = require('node:child_process')
const app = spawn(process.execPath, ['-e', ${JSON.stringify(IDLE)}], { stdio: 'ignore' })
process.stdout.write(String(app.pid) + '\\n')
${IDLE}
`

const APP_WITH_A_HELPER = `
const { spawn } = require('node:child_process')
spawn(process.execPath, ['-e', ${JSON.stringify(IDLE)}], { stdio: 'ignore' })
${IDLE}
`
const LAUNCHER_THAT_STARTS_AN_APP_WITH_A_HELPER = `
const { spawn } = require('node:child_process')
const app = spawn(process.execPath, ['-e', ${JSON.stringify(APP_WITH_A_HELPER)}], { stdio: 'ignore' })
process.stdout.write(String(app.pid) + '\\n')
${IDLE}
`

const started: number[] = []

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => child.once('exit', () => resolve()))
}

async function launchShellAndApp(
  script = LAUNCHER_THAT_STARTS_THE_APP
): Promise<{ launcher: ChildProcess; appPid: number }> {
  const launcher = spawn(process.execPath, ['-e', script], {
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

async function withoutProcessTools<T>(run: () => Promise<T>): Promise<T> {
  const path = process.env['PATH']
  process.env['PATH'] = ''
  try {
    return await run()
  } finally {
    process.env['PATH'] = path
  }
}

afterEach(() => {
  killProcessTrees(started.filter(isPidAlive))
  started.length = 0
})

describe('app shutdown', () => {
  it('stops the app itself, not only the launcher, when a graceful close hangs', async () => {
    const { launcher, appPid } = await launchShellAndApp()
    const log = vi.fn()
    const { shutdown } = createShutdown(
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
    }).shutdown()

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
    ).shutdown()

    expect(forceKill).not.toHaveBeenCalled()
    expect(isPidAlive(appPid)).toBe(false)
  })

  it('fails loudly within its deadline when the app survives the forced kill', async () => {
    const { launcher, appPid } = await launchShellAndApp()
    const { shutdown } = createShutdown(
      { launcher, appPid, closeGracefully: never, connectionClosed: () => false },
      { gracefulCloseMs: 50, forcedExitMs: 200, forceKill: () => {}, log: () => {} }
    )

    await expect(shutdown()).rejects.toThrow(String(appPid))
  })

  it('runs one shutdown when cleanup is called twice at once', async () => {
    const { launcher, appPid } = await launchShellAndApp()
    const closeGracefully = vi.fn(never)
    const { shutdown } = createShutdown(
      { launcher, appPid, closeGracefully, connectionClosed: () => false },
      { gracefulCloseMs: 50, log: () => {} }
    )

    await Promise.all([shutdown(), shutdown()])

    expect(closeGracefully).toHaveBeenCalledTimes(1)
    expect(isPidAlive(appPid)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')(
    'stops the helpers the app started, not only the app',
    async () => {
      const { launcher, appPid } = await launchShellAndApp(
        LAUNCHER_THAT_STARTS_AN_APP_WITH_A_HELPER
      )
      await vi.waitFor(() => expect(descendantsOf([appPid]).size).toBe(1))
      const killed: number[] = []
      await createShutdown(
        { launcher, appPid, closeGracefully: never, connectionClosed: () => false },
        {
          gracefulCloseMs: 50,
          log: () => {},
          forceKill: (pids) => {
            killed.push(...pids)
            killProcessTrees(pids)
          }
        }
      ).shutdown()

      const helpers = killed.filter((pid) => pid !== launcher.pid && pid !== appPid)
      started.push(...helpers)
      expect(helpers, 'the helper was part of the forced kill').toHaveLength(1)
      expect(helpers.filter(isPidAlive), 'no helper outlives the shutdown').toEqual([])
    }
  )

  it('leaves alone a process that took over the app pid after the app exited', async () => {
    const { appPid } = await launchShellAndApp()
    const forceKill = vi.fn()

    await createShutdown(
      {
        launcher: undefined,
        appPid,
        appStartTime: 'a start time from an app that is gone',
        closeGracefully: never,
        connectionClosed: () => true
      },
      { forceKill }
    ).shutdown()

    expect(forceKill).not.toHaveBeenCalled()
    expect(isPidAlive(appPid), 'the unrelated process still runs').toBe(true)
    expect(processStartTime(appPid)).toBeDefined()
  })

  it.skipIf(process.platform === 'win32')(
    'stops a helper it saw earlier even after the launcher and the app are gone',
    async () => {
      const { launcher, appPid } = await launchShellAndApp(
        LAUNCHER_THAT_STARTS_AN_APP_WITH_A_HELPER
      )
      await vi.waitFor(() => expect(descendantsOf([appPid]).size).toBe(1))
      const [helperPid] = [...descendantsOf([appPid]).keys()]
      started.push(helperPid!)
      const { shutdown, trackHelpers } = createShutdown({
        launcher,
        appPid,
        closeGracefully: never,
        connectionClosed: () => true
      })
      trackHelpers()

      killProcessTrees([launcher.pid!, appPid])
      await exited(launcher)
      await vi.waitFor(() => expect(isPidAlive(appPid)).toBe(false))
      expect(isPidAlive(helperPid!), 'the helper outlived its parents').toBe(true)

      await shutdown()

      expect(isPidAlive(helperPid!)).toBe(false)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'fails instead of reporting success when it cannot list processes',
    async () => {
      const { launcher, appPid } = await launchShellAndApp()
      const { shutdown } = createShutdown(
        { launcher, appPid, closeGracefully: never, connectionClosed: () => true },
        { log: () => {} }
      )

      await expect(withoutProcessTools(shutdown)).rejects.toBeInstanceOf(ProcessLookupError)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'keeps the app and fails when it cannot check who owns the app pid',
    async () => {
      const { appPid } = await launchShellAndApp()
      const forceKill = vi.fn()
      const { shutdown } = createShutdown(
        {
          launcher: undefined,
          appPid,
          appStartTime: processStartTime(appPid),
          closeGracefully: never,
          connectionClosed: () => true
        },
        { forceKill }
      )

      await expect(withoutProcessTools(shutdown)).rejects.toBeInstanceOf(ProcessLookupError)
      expect(forceKill).not.toHaveBeenCalled()
      expect(isPidAlive(appPid)).toBe(true)
    }
  )

  it('keeps the app and fails when its pid is alive but has no readable start time', async () => {
    const { appPid } = await launchShellAndApp()
    const forceKill = vi.fn()
    const { shutdown } = createShutdown(
      {
        launcher: undefined,
        appPid,
        appStartTime: 'the start time recorded at launch',
        closeGracefully: never,
        connectionClosed: () => true
      },
      { forceKill, readStartTime: () => undefined }
    )

    await expect(shutdown()).rejects.toBeInstanceOf(ProcessLookupError)
    expect(forceKill).not.toHaveBeenCalled()
    expect(isPidAlive(appPid)).toBe(true)
  })
})
