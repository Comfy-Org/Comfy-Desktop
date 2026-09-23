import fs from 'fs'
import path from 'path'
import * as settings from '../settings'
import { installFilteredRequirementsDetailed } from './pip'
import type { UvPipResult } from './pip'
import { getActivePythonPath, getActiveUvPath } from './pythonEnv'
import type { InstallationRecord } from '../installations'

/** The Core flag that starts ComfyUI with the agent enabled. */
const ENABLE_AGENT_ARG = '--enable-agent'

/** Requirements file Core ships beside `main.py` for the agent. */
const AGENT_REQUIREMENTS = 'agent_requirements.txt'

/**
 * Ceiling on how long a launch waits for the install.
 *
 * The launch blocks on this so the agent is usable on the run that enables it,
 * but core starts perfectly well without the packages, so holding a user at the
 * launcher indefinitely to acquire them inverts that. Past the ceiling uv is
 * killed and the launch goes ahead with the flag still set: core prints its own
 * install hint and disables the agent. The matching bound one step earlier is
 * the args-schema probe's 15s, which fails open the same way.
 *
 * The ceiling is generous rather than tight because uv streams nothing while a
 * wheel downloads, so a slow transfer is indistinguishable from a stall. A link
 * too slow to finish inside it never gets the agent from this path.
 */
const INSTALL_TIMEOUT_MS = 120_000

/**
 * Grace between asking uv to stop and the launch giving up on it.
 *
 * Killing is best-effort and not awaited: `killProcTree` sends SIGTERM to the
 * process group on POSIX and swallows a failed `taskkill` on Windows, while the
 * install settles only on the child's own exit. A uv that does not take the
 * signal would therefore hold the launch open past the very ceiling that exists
 * to stop that, so the wait is bounded here too and the launch proceeds either
 * way. An abandoned uv may still be writing to the environment, which is worth
 * one warning line and is strictly better than never starting.
 */
const KILL_GRACE_MS = 10_000

/**
 * What the launch row should say while the install runs.
 *
 * Structured rather than translated here so the mapping stays testable and the
 * locale lookup stays with the other launch strings. `failed` is terminal: the
 * row keeps it once the step is done, rather than completing silently on a
 * launch that is starting without the agent.
 */
export type AgentInstallStatus =
  | { kind: 'downloading'; name: string; size: string }
  | { kind: 'installing' }
  | { kind: 'failed' }

/** uv prints one of these per wheel before the bytes move: `Downloading numpy
 *  (15.3MiB)`. The size is taken verbatim, since uv already formats it. */
const UV_DOWNLOADING = /^\s*Downloading\s+(\S+)\s+\(([^)]+)\)\s*$/

/** uv's own handover from fetching to installing. */
const UV_INSTALLING = /^\s*(?:Prepared|Installed)\s+\d+\s+package/

/**
 * Map one line of uv's output to a status, or null to leave the row alone.
 *
 * Null is the common case and deliberately so: uv prints resolution counts,
 * per-package `Downloaded` acknowledgements and warnings that would either
 * flicker the row or say nothing a user can act on.
 */
export function agentInstallStatus(line: string): AgentInstallStatus | null {
  const downloading = line.match(UV_DOWNLOADING)
  if (downloading) return { kind: 'downloading', name: downloading[1]!, size: downloading[2]! }
  if (UV_INSTALLING.test(line)) return { kind: 'installing' }
  return null
}

/** Feed uv's stream through the line matcher. Buffers a partial tail, because
 *  the helper forwards raw chunks and a milestone can straddle two of them. */
function scanForStatus(onStatus: (status: AgentInstallStatus) => void): (text: string) => void {
  let pending = ''
  return (text: string): void => {
    pending += text
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) {
      const status = agentInstallStatus(line)
      if (status) onStatus(status)
    }
  }
}

/** Which way the bounded wait ended: uv exited, it threw, or the launch stopped
 *  waiting for a uv that would not stop. */
type InstallOutcome =
  | { kind: 'settled'; result: UvPipResult }
  | { kind: 'failed'; error: unknown }
  | { kind: 'abandoned' }

export interface AgentRequirementsInstall {
  reqPath: string
  uvPath: string
  pythonPath: string
  installPath: string
}

/**
 * Decide whether this launch installs the agent's Python requirements, and
 * resolve everything the install needs.
 *
 * `args` must be the FINAL spawn args. `--enable-agent` reaches them either
 * from the user's own launch args or from a Core beta grant, so the args are
 * the one place that knows whether the agent is really starting. A core whose
 * schema does not know the flag has normally had it filtered out by then, with
 * one exception: when schema discovery itself failed the launch keeps the raw
 * args, so a hand-typed flag survives to a core that cannot parse it. That
 * launch fails on argparse either way; the cost is one wasted install.
 *
 * The environment test is the one every `manager_requirements.txt` site makes,
 * which is what confines this to the Desktop-managed installs (standalone and
 * adopted). Portable, git and build installs drive a Python environment this
 * helper has no uv binary for; Core's own `pip install -r` hint covers them.
 */
export function planAgentRequirementsInstall(
  installation: InstallationRecord,
  args: readonly string[]
): AgentRequirementsInstall | null {
  if (!args.includes(ENABLE_AGENT_ARG)) return null
  const reqPath = path.join(installation.installPath, 'ComfyUI', AGENT_REQUIREMENTS)
  if (!fs.existsSync(reqPath)) return null
  const uvPath = getActiveUvPath(installation)
  const pythonPath = getActivePythonPath(installation)
  if (!pythonPath || !fs.existsSync(uvPath)) return null
  return { reqPath, uvPath, pythonPath, installPath: installation.installPath }
}

/**
 * Install the planned requirements, streaming uv's output into the launch.
 *
 * Bounded and fail-open. Never throws and reports nothing back: neither a
 * failure nor a timeout here may stop the launch. ComfyUI still starts with the
 * flag, prints its own install hint and disables the agent itself, which beats
 * refusing to start.
 *
 * `signal` is the launch's own, and stays untouched: uv is driven through a
 * controller owned here, so the deadline ends the wait without cancelling the
 * launch. Because killing uv is best-effort, the wait is bounded twice over:
 * the ceiling asks it to stop, and `KILL_GRACE_MS` later the launch stops
 * waiting whether or not it did. Nothing downstream depends on which happened.
 */
export async function installAgentRequirements(
  plan: AgentRequirementsInstall,
  sendOutput: (text: string) => void,
  signal?: AbortSignal,
  onStatus?: (status: AgentInstallStatus) => void
): Promise<void> {
  sendOutput('\nInstalling agent requirements…\n')
  // uv's own output is the only progress signal available: the download is a
  // single opaque stretch otherwise, and the row would sit on one caption for
  // its whole duration.
  const scan = onStatus ? scanForStatus(onStatus) : undefined
  const stream = scan
    ? (text: string): void => {
        scan(text)
        sendOutput(text)
      }
    : sendOutput
  const uvAbort = new AbortController()
  const onLaunchAbort = (): void => uvAbort.abort()
  let timedOut = false
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let abandon = (): void => {}
  const abandoned = new Promise<InstallOutcome>((resolve) => {
    abandon = () => resolve({ kind: 'abandoned' })
  })
  // Armed on whichever side raised the abort, so neither the ceiling nor a user
  // cancel can be held open by a uv that never takes the signal.
  uvAbort.signal.addEventListener(
    'abort',
    () => {
      graceTimer = setTimeout(abandon, KILL_GRACE_MS)
    },
    { once: true }
  )
  if (signal?.aborted) uvAbort.abort()
  else signal?.addEventListener('abort', onLaunchAbort, { once: true })
  const deadline = setTimeout(() => {
    timedOut = true
    uvAbort.abort()
  }, INSTALL_TIMEOUT_MS)

  // Settled into a value rather than awaited directly: losing the race leaves
  // this pending, and a later rejection with nothing awaiting it would surface
  // as an unhandled rejection.
  const install: Promise<InstallOutcome> = installFilteredRequirementsDetailed(
    plan.reqPath,
    plan.uvPath,
    plan.pythonPath,
    plan.installPath,
    '.launch-agent-reqs.txt',
    stream,
    uvAbort.signal,
    settings.getMirrorConfig()
  ).then(
    (result) => ({ kind: 'settled', result }),
    (error: unknown) => ({ kind: 'failed', error })
  )

  try {
    const outcome = await Promise.race([install, abandoned])
    // A cancelled launch kills uv mid-install, so whatever it reports is the
    // cancellation rather than a failure worth showing.
    if (signal?.aborted) return
    if (outcome.kind === 'abandoned') {
      onStatus?.({ kind: 'failed' })
      sendOutput(
        `\n⚠ agent requirements install exceeded ${INSTALL_TIMEOUT_MS / 1000}s and uv did not stop; starting ComfyUI anyway\n`
      )
    } else if (outcome.kind === 'failed') {
      onStatus?.({ kind: 'failed' })
      sendOutput(`⚠ ${AGENT_REQUIREMENTS} failed: ${(outcome.error as Error).message}\n`)
    } else if (outcome.result.code !== 0) {
      onStatus?.({ kind: 'failed' })
      // The exit code decides, not the timer that was racing it: an install
      // that finished inside the grace period succeeded, however close to the
      // ceiling it landed, and must not be reported as skipped.
      //
      // Only the code, never a tail of the captured output: uv streams into
      // this same sink as it runs, so appending what it captured reprints the
      // error a second time in the log.
      sendOutput(
        timedOut
          ? `\n⚠ agent requirements install exceeded ${INSTALL_TIMEOUT_MS / 1000}s; starting ComfyUI without it\n`
          : `\n⚠ agent requirements install exited with code ${outcome.result.code}\n`
      )
    }
  } finally {
    clearTimeout(deadline)
    if (graceTimer !== undefined) clearTimeout(graceTimer)
    signal?.removeEventListener('abort', onLaunchAbort)
  }
}
