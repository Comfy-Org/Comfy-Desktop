import { spawn, type ChildProcess } from 'node:child_process'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createShutdown,
  descendantsOf,
  EXIT_SETTLE_MS,
  isPidAlive,
  killProcessTrees,
  LATE_RECOVERY_MS,
  listProcesses,
  MIN_PROCESS_QUERY_MS,
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

function blockFor(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

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

  it('keeps a slow forced kill inside the shutdown deadline', async () => {
    const { launcher, appPid } = await launchShellAndApp()
    const gracefulCloseMs = 50
    const forcedExitMs = 200
    const shutdownMs = gracefulCloseMs + EXIT_SETTLE_MS + forcedExitMs
    const killBudgets: number[] = []
    const startedAt = Date.now()
    const { shutdown } = createShutdown(
      { launcher, appPid, closeGracefully: never, connectionClosed: () => false },
      {
        gracefulCloseMs,
        forcedExitMs,
        log: () => {},
        forceKill: (_pids, timeoutMs) => {
          killBudgets.push(timeoutMs)
          blockFor(timeoutMs)
        }
      }
    )

    await expect(shutdown()).rejects.toThrow(String(appPid))

    expect(killBudgets).toHaveLength(1)
    expect(killBudgets[0]!, 'the kill fits in the forced-exit phase').toBeLessThanOrEqual(
      forcedExitMs
    )
    expect(Date.now() - startedAt, 'the shutdown ends near its deadline').toBeLessThan(
      shutdownMs + 1_000
    )
  })

  it('reports the last survivors when a process query fails after the deadline', async () => {
    const { launcher, appPid } = await launchShellAndApp()
    const path = process.env['PATH']
    const { shutdown } = createShutdown(
      { launcher, appPid, closeGracefully: never, connectionClosed: () => false },
      {
        gracefulCloseMs: 50,
        forcedExitMs: 200,
        log: () => {},
        forceKill: (_pids, timeoutMs) => {
          blockFor(timeoutMs)
          process.env['PATH'] = ''
        }
      }
    )

    try {
      const failure = await shutdown().catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(Error)
      expect(failure).not.toBeInstanceOf(ProcessLookupError)
      expect(String(failure)).toContain(String(appPid))
    } finally {
      process.env['PATH'] = path
    }
  })

  it('still checks the app and kills it when the deadline ran out before the forced kill', async () => {
    const { launcher, appPid } = await launchShellAndApp()
    const lookupBudgets: number[] = []
    const killBudgets: number[] = []
    const { shutdown } = createShutdown(
      {
        launcher,
        appPid,
        appStartTime: 'the start time recorded at launch',
        closeGracefully: never,
        connectionClosed: () => false
      },
      {
        gracefulCloseMs: 50,
        forcedExitMs: 200,
        log: () => {},
        readStartTime: (_pid, timeoutMs) => {
          lookupBudgets.push(timeoutMs)
          if (lookupBudgets.length === 1) blockFor(timeoutMs + 50)
          return 'the start time recorded at launch'
        },
        forceKill: (pids, timeoutMs) => {
          killBudgets.push(timeoutMs)
          killProcessTrees(pids, timeoutMs)
        }
      }
    )

    await shutdown()

    expect(lookupBudgets).toHaveLength(2)
    expect(lookupBudgets[1]!, 'the late identity check keeps a usable budget').toBe(
      MIN_PROCESS_QUERY_MS
    )
    expect(
      killBudgets[0]!,
      'the late kill gets no budget, so it signals at once'
    ).toBeLessThanOrEqual(0)
    expect(isPidAlive(appPid)).toBe(false)
  })

  it('gives a slow process query only what is left of the shutdown deadline', async () => {
    const { launcher, appPid } = await launchShellAndApp()
    const queryBudgets: number[] = []
    const startedAt = Date.now()
    const { shutdown } = createShutdown(
      {
        launcher,
        appPid,
        appStartTime: 'the start time recorded at launch',
        closeGracefully: never,
        connectionClosed: () => false
      },
      {
        gracefulCloseMs: 50,
        forcedExitMs: 200,
        log: () => {},
        readStartTime: (_pid, timeoutMs) => {
          queryBudgets.push(timeoutMs)
          blockFor(Math.min(timeoutMs, 300))
          return 'the start time recorded at launch'
        }
      }
    )

    await shutdown()

    expect(queryBudgets).toHaveLength(2)
    expect(queryBudgets[1]!, 'the second lookup gets less time than the first').toBeLessThanOrEqual(
      queryBudgets[0]! - 300
    )
    expect(Date.now() - startedAt).toBeLessThan(50 + EXIT_SETTLE_MS + 200 + 1_000)
    expect(isPidAlive(appPid)).toBe(false)
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
      const discoveredHelpers = [...descendantsOf([appPid]).keys()]
      started.push(...discoveredHelpers)
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
      expect(helpers, 'the helper was part of the forced kill').toEqual(discoveredHelpers)
      expect(helpers.filter(isPidAlive), 'no helper outlives the shutdown').toEqual([])
    }
  )

  it.skipIf(process.platform === 'win32')(
    'stops a helper it only finds after the deadline ran out',
    async () => {
      const { launcher, appPid } = await launchShellAndApp(
        LAUNCHER_THAT_STARTS_AN_APP_WITH_A_HELPER
      )
      await vi.waitFor(() => expect(descendantsOf([appPid]).size).toBe(1))
      const [helperPid] = [...descendantsOf([appPid]).keys()]
      started.push(helperPid!)
      const killed: number[] = []
      let lookups = 0
      await createShutdown(
        {
          launcher,
          appPid,
          appStartTime: 'the start time recorded at launch',
          closeGracefully: never,
          connectionClosed: () => false
        },
        {
          gracefulCloseMs: 50,
          forcedExitMs: 200,
          log: () => {},
          readStartTime: (_pid, timeoutMs) => {
            lookups += 1
            if (lookups === 1) blockFor(timeoutMs + 50)
            return 'the start time recorded at launch'
          },
          forceKill: (pids, timeoutMs) => {
            killed.push(...pids)
            killProcessTrees(pids, timeoutMs)
          }
        }
      ).shutdown()

      expect(killed, 'the late helper was part of the forced kill').toContain(helperPid)
      expect(isPidAlive(helperPid!)).toBe(false)
    }
  )

  it('signals no unverified process when recovery time runs out before the forced kill', async () => {
    const { launcher, appPid } = await launchShellAndApp()
    const killed: number[] = []
    let lookups = 0
    const shutdown = createShutdown(
      {
        launcher,
        appPid,
        appStartTime: 'the start time recorded at launch',
        closeGracefully: never,
        connectionClosed: () => false
      },
      {
        gracefulCloseMs: 50,
        forcedExitMs: 200,
        log: () => {},
        readStartTime: (_pid, timeoutMs) => {
          lookups += 1
          if (lookups === 1) blockFor(timeoutMs + LATE_RECOVERY_MS + 100)
          return 'the start time recorded at launch'
        },
        forceKill: (pids, timeoutMs) => {
          killed.push(...pids)
          killProcessTrees(pids, timeoutMs)
        }
      }
    ).shutdown()

    await expect(shutdown).rejects.toThrow(/ran out of recovery time/)
    expect(killed, 'only the launcher, which this test started, is signalled').toEqual([
      launcher.pid
    ])
    expect(isPidAlive(appPid), 'the unverified app pid is left alone').toBe(true)
  })

  it('keeps late recovery work within LATE_RECOVERY_MS past the deadline', async () => {
    const { launcher, appPid } = await launchShellAndApp()
    const gracefulCloseMs = 50
    const forcedExitMs = 200
    const shutdownMs = gracefulCloseMs + EXIT_SETTLE_MS + forcedExitMs
    const lookupBudgets: number[] = []
    const startedAt = Date.now()
    await createShutdown(
      {
        launcher,
        appPid,
        appStartTime: 'the start time recorded at launch',
        closeGracefully: never,
        connectionClosed: () => false
      },
      {
        gracefulCloseMs,
        forcedExitMs,
        log: () => {},
        readStartTime: (_pid, timeoutMs) => {
          lookupBudgets.push(timeoutMs)
          blockFor(timeoutMs)
          return 'the start time recorded at launch'
        }
      }
    ).shutdown()

    expect(lookupBudgets.slice(1).every((budget) => budget <= LATE_RECOVERY_MS)).toBe(true)
    expect(Date.now() - startedAt, 'late recovery stays inside its bound').toBeLessThan(
      shutdownMs + LATE_RECOVERY_MS + 500
    )
    expect(isPidAlive(appPid)).toBe(false)
  })

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

  it('does not signal a process that took over the app pid while the app was closing', async () => {
    const { appPid } = await launchShellAndApp()
    const startTimes = ['the start time recorded at launch', 'a later process on the same pid']
    const forceKill = vi.fn()

    await createShutdown(
      {
        launcher: undefined,
        appPid,
        appStartTime: startTimes[0],
        closeGracefully: never,
        connectionClosed: () => false
      },
      { gracefulCloseMs: 50, log: () => {}, forceKill, readStartTime: () => startTimes.shift() }
    ).shutdown()

    expect(forceKill).not.toHaveBeenCalledWith(expect.arrayContaining([appPid]), expect.anything())
    expect(isPidAlive(appPid), 'the unrelated process still runs').toBe(true)
  })

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

  it.skipIf(process.platform === 'win32')(
    'stops a helper started after the last look once the app and launcher are gone',
    async () => {
      const profileDir = `/tmp/e2e-profile-${process.pid}-${Date.now()}`
      const appThatHandsOffToAHelper = `
const { spawn } = require('node:child_process')
setTimeout(() => {
  spawn(process.execPath, ['-e', ${JSON.stringify(IDLE)}, '--', '--user-data-dir=${profileDir}'], { stdio: 'ignore' })
  setTimeout(() => process.exit(0), 200)
}, 300)
${IDLE}
`
      const { launcher, appPid } = await launchShellAndApp(`
const { spawn } = require('node:child_process')
const app = spawn(process.execPath, ['-e', ${JSON.stringify(appThatHandsOffToAHelper)}], { stdio: 'ignore' })
process.stdout.write(String(app.pid) + '\\n')
${IDLE}
`)
      const { shutdown, trackHelpers } = createShutdown({
        launcher,
        appPid,
        profileDir,
        closeGracefully: never,
        connectionClosed: () => true
      })
      trackHelpers()

      await vi.waitFor(() => expect(isPidAlive(appPid)).toBe(false), { timeout: 3000 })
      launcher.kill('SIGKILL')
      await exited(launcher)
      const helperPid = [...listProcesses()].find(([, p]) => p.command.includes(profileDir))?.[0]
      expect(helperPid, 'the helper outlived the app and launcher').toBeDefined()
      started.push(helperPid!)

      await shutdown()

      expect(isPidAlive(helperPid!)).toBe(false)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'stops a helper started while the app was closing once both parents are gone',
    async () => {
      const profileDir = `/tmp/e2e-profile-${process.pid}-${Date.now()}`
      const { launcher, appPid } = await launchShellAndApp()
      let helper: ChildProcess | undefined
      const closeGracefully = async (): Promise<void> => {
        helper = spawn(process.execPath, ['-e', IDLE, '--', `--user-data-dir=${profileDir}`], {
          stdio: 'ignore'
        })
        started.push(helper.pid!)
        killProcessTrees([launcher.pid!, appPid])
        await exited(launcher)
        await vi.waitFor(() => expect(isPidAlive(appPid)).toBe(false))
      }
      const { shutdown } = createShutdown(
        { launcher, appPid, profileDir, closeGracefully, connectionClosed: () => false },
        { log: () => {} }
      )

      await shutdown()

      await exited(helper!)
      expect(helper!.signalCode, 'the helper was stopped by the shutdown').toBe('SIGKILL')
    }
  )
})
