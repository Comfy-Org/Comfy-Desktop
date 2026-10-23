import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import type { ChildProcess } from 'child_process'
import * as settings from '../settings'
import { installFilteredRequirementsDetailed, runUvPipDetailed } from './pip'
import type { UvPipResult } from './pip'
import { getActivePythonPath, getActiveUvPath } from './pythonEnv'
import type { InstallationRecord } from '../installations'
import { stripAnsi } from './stderrTail'
import {
  FRONTEND_PACKAGE,
  agentGoBehindAgent,
  coreFrontendVersion,
  effectiveAgentRequirements,
  coreFileInstalled,
  installedConstraints,
  isRevertedFor,
  overrideSignature,
  parseAgentRequirementsOverride,
  pinsOverBareLines
} from './agentRequirementsOverride'
import type {
  AgentOverrideState,
  InstallReport,
  OverrideDecision,
  OverridePins,
  OverrideRefusal,
  PrefetchReport
} from './agentRequirementsOverride'

/** The Core flag that starts ComfyUI with the agent enabled. */
const ENABLE_AGENT_ARG = '--enable-agent'

/** Requirements file Core ships beside `main.py` for the agent. */
const AGENT_REQUIREMENTS = 'agent_requirements.txt'

/** ComfyUI's own requirements, where the frontend is pinned. */
const CORE_REQUIREMENTS = 'requirements.txt'

let attempts = 0

function attemptTag(): string {
  return `${process.pid}-${++attempts}`
}

/** Cap on the force-stop itself, so hard-stopping a uv cannot become the very
 *  open-ended wait the grace period exists to end. */
const FORCE_STOP_TIMEOUT_MS = 5_000

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
 * What the launch row should say about the agent's packages, beyond its own label.
 *
 * Structured rather than translated here so the mapping stays testable and the
 * locale lookup stays with the other launch strings. `deferred` is terminal: the
 * row keeps it once the step is done, so a launch starting without the agent
 * says the agent is on its way rather than completing silently.
 */
export type AgentInstallStatus = { kind: 'deferred' }

/** Run a short-lived helper command and resolve when it exits or the cap hits.
 *  Bounded because this runs with the user waiting at the launcher. */
function runBounded(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: FORCE_STOP_TIMEOUT_MS, windowsHide: true }, () => resolve())
  })
}

/**
 * Hard-stop the uv this launch started, and clear what it left behind.
 *
 * Reached only when the grace period expired, i.e. uv ignored the SIGTERM the
 * shared helper sends. Without this the launch would continue while a live uv
 * kept writing into the environment ComfyUI is booting from, and the helper's
 * filtered copy would stay on disk, because it unlinks only once uv settles.
 *
 * `proc` is the handle the helper delivered for THIS install, so exactly that
 * process tree is killed and nothing is searched for or guessed at. Every step
 * is bounded and every failure swallowed: a force-stop must not become the
 * open-ended wait the grace period exists to end.
 */
async function forceStopAgentInstall(
  proc: ChildProcess | null,
  installPath: string,
  tempName: string
): Promise<void> {
  const pid = proc?.pid
  if (pid) {
    if (process.platform === 'win32') {
      await runBounded('taskkill', ['/F', '/T', '/PID', String(pid)])
    } else {
      // Negated pid: the helper spawns detached, so uv leads its own process
      // group and the group is the tree. Falls back to the bare pid when the
      // group is already gone.
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {}
      }
    }
  }
  try {
    await fs.promises.unlink(path.join(installPath, tempName))
  } catch {}
}

/** Which way the bounded wait ended: uv exited, it threw, or the launch stopped
 *  waiting for a uv that would not stop. */
type InstallOutcome =
  | { kind: 'settled'; result: UvPipResult }
  | { kind: 'failed'; error: unknown }
  | { kind: 'abandoned' }

/** One bounded uv run: whether it installed, how it ended, and what uv printed. */
export interface BoundedResult {
  ok: boolean
  report: InstallReport
  output: string
}

/** Only uv's error, from its first `error:` or `×` line, with local paths scrubbed. */
export function uvErrorTail(output: string, installPath: string): string | null {
  const lines = stripAnsi(output).split(/\r?\n/)
  const start = lines.findIndex((line) => /^error:|^\s*×/.test(line))
  if (start === -1) return null
  let text = lines.slice(start).join('\n').trim()
  for (const [local, label] of [
    [installPath, '<install>'],
    [os.homedir(), '~']
  ] as const) {
    if (!local) continue
    text = text.split(local).join(label).split(local.replace(/\\/g, '/')).join(label)
  }
  return text.slice(0, 500)
}

export interface AgentRequirementsInstall {
  reqPath: string
  uvPath: string
  pythonPath: string
  installPath: string
  /** Names the install in launch-output warnings; the agent's by default. */
  label?: string
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
 * Run one `uv pip install -r`, streaming uv's output into the launch. `ok` when it exited 0.
 *
 * Bounded and fail-open. Never throws: neither a failure nor a timeout here may
 * stop the launch. ComfyUI still starts with the
 * flag, prints its own install hint and disables the agent itself, which beats
 * refusing to start.
 *
 * `signal` is the launch's own, and stays untouched: uv is driven through a
 * controller owned here, so the deadline ends the wait without cancelling the
 * launch. Because killing uv is best-effort, the wait is bounded twice over:
 * the ceiling asks it to stop, and `KILL_GRACE_MS` later the launch stops
 * waiting whether or not it did. Nothing downstream depends on which happened.
 */
async function runBoundedInstall(
  plan: AgentRequirementsInstall,
  reqPath: string,
  tempName: string,
  timeoutMs: number,
  sendOutput: (text: string) => void,
  signal?: AbortSignal,
  { extraArgs, env }: RunOptions = {}
): Promise<BoundedResult> {
  const startedAt = Date.now()
  const result = (
    outcome: InstallReport['outcome'],
    exitCode: number | null,
    output = ''
  ): BoundedResult => ({
    ok: outcome === 'exited' && exitCode === 0,
    output,
    report: {
      outcome,
      exitCode,
      elapsedMs: Date.now() - startedAt,
      budgetMs: timeoutMs,
      errorTail: exitCode === 0 ? null : uvErrorTail(output, plan.installPath)
    }
  })
  const label = plan.label ?? 'agent requirements'
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
  }, timeoutMs)

  // Settled into a value rather than awaited directly: losing the race leaves
  // this pending, and a later rejection with nothing awaiting it would surface
  // as an unhandled rejection.
  // The helper hands back the process it spawned, so the abandon path below can
  // stop exactly this install rather than looking for it.
  let uvProc: ChildProcess | null = null
  const install: Promise<InstallOutcome> = installFilteredRequirementsDetailed(
    reqPath,
    plan.uvPath,
    plan.pythonPath,
    plan.installPath,
    tempName,
    sendOutput,
    uvAbort.signal,
    settings.getMirrorConfig(),
    extraArgs,
    (proc) => {
      uvProc = proc
    },
    env
  ).then(
    (result) => ({ kind: 'settled', result }),
    (error: unknown) => ({ kind: 'failed', error })
  )

  try {
    const outcome = await Promise.race([install, abandoned])
    // A cancelled launch kills uv mid-install, so whatever it reports is the
    // cancellation rather than a failure worth showing.
    if (signal?.aborted) return result('cancelled', null)
    if (outcome.kind === 'abandoned') {
      await forceStopAgentInstall(uvProc, plan.installPath, tempName)
      sendOutput(
        `\n⚠ ${label} install exceeded ${Math.round(timeoutMs / 1000)}s and uv did not stop; hard-stopped it and starting ComfyUI anyway\n`
      )
    } else if (outcome.kind === 'failed') {
      sendOutput(
        `⚠ ${plan.label ?? AGENT_REQUIREMENTS} failed: ${(outcome.error as Error).message}\n`
      )
    } else if (outcome.result.code !== 0) {
      // The exit code decides, not the timer that was racing it: an install
      // that finished inside the grace period succeeded, however close to the
      // ceiling it landed, and must not be reported as skipped.
      //
      // Only the code, never a tail of the captured output: uv streams into
      // this same sink as it runs, so appending what it captured reprints the
      // error a second time in the log.
      sendOutput(
        timedOut
          ? `\n⚠ ${label} install exceeded ${Math.round(timeoutMs / 1000)}s; starting ComfyUI without it\n`
          : `\n⚠ ${label} install exited with code ${outcome.result.code}\n`
      )
    }
    if (outcome.kind === 'abandoned') return result('abandoned', null)
    if (outcome.kind === 'failed') {
      return result('spawn_error', null, `error: ${(outcome.error as Error).message}`)
    }
    const { code, output } = outcome.result
    return result(timedOut && code !== 0 ? 'timed_out' : 'exited', code, output)
  } finally {
    clearTimeout(deadline)
    if (graceTimer !== undefined) clearTimeout(graceTimer)
    signal?.removeEventListener('abort', onLaunchAbort)
  }
}

interface RunOptions {
  extraArgs?: string[]
  env?: Record<string, string>
}

/**
 * How long a launch waits on downloading the agent's packages, shared by every download on the
 * launch. Each install tries uv's cache first, then the network for what is left of this; what
 * does not land inside it goes to `prefetchAgentRequirements`, which no one waits on, and the
 * agent starts on the launch after it lands. About a Windows ComfyUI boot (median 24 s), and
 * above the 13 s the whole agent payload took on a fast link, so a fast link still gets the agent
 * on the launch that enables it.
 */
const ONLINE_BUDGET_MS = 20_000

/** A cache-only install downloads nothing; this only stops a stuck uv holding the launch. */
const OFFLINE_TIMEOUT_MS = 30_000

/** One download at a time: a stopped uv keeps every wheel it finished, where in parallel a slow
 *  link finishes none of the large ones and every attempt starts over. */
const SERIAL_DOWNLOADS = { UV_CONCURRENT_DOWNLOADS: '1' }

const OFFLINE = '--offline'

/** What a launch could not install from uv's cache, for the background download to fetch. */
export interface PrefetchRequest {
  plan: AgentRequirementsInstall
  text: string
  constraints?: string
  /** `core`, or the override's signature: attempts are counted per signature. */
  signature: string
  /** Ahead of any launch: skipped, unreported, when the cache already holds everything. */
  eager?: boolean
}

type CachedRun = (reqPath: string, tempName: string, extraArgs?: string[]) => Promise<BoundedResult>

/**
 * Install the planned requirements. Bounded and fail-open, never throws. An `override` that
 * validates and passes its check goes in first; otherwise, or when it is not cached yet, core's own
 * file. On a fresh install the override waits for core's file and then goes in on the same launch.
 * What is not cached is handed to `onDeferred` for a background download.
 * Returns the decision to report, if any.
 */
export async function installAgentRequirements(
  plan: AgentRequirementsInstall,
  sendOutput: (text: string) => void,
  signal?: AbortSignal,
  onStatus?: (status: AgentInstallStatus) => void,
  override?: unknown,
  overrideState: AgentOverrideState | null = null,
  onDeferred?: (request: PrefetchRequest) => void
): Promise<OverrideDecision | undefined> {
  sendOutput('\nInstalling agent requirements…\n')
  let onlineLeft = ONLINE_BUDGET_MS
  const run: CachedRun = async (reqPath, tempName, extraArgs = []) => {
    // Quiet: a cache miss is the expected case on a cold cache; the network try speaks for it.
    const cached = await runBoundedInstall(
      plan,
      reqPath,
      tempName,
      OFFLINE_TIMEOUT_MS,
      () => {},
      signal,
      {
        extraArgs: [OFFLINE, ...extraArgs]
      }
    )
    if (cached.ok || signal?.aborted || onlineLeft <= 0) return cached
    const online = await runBoundedInstall(
      plan,
      reqPath,
      tempName,
      onlineLeft,
      sendOutput,
      signal,
      {
        extraArgs,
        env: SERIAL_DOWNLOADS
      }
    )
    onlineLeft -= online.report.elapsedMs
    return online
  }
  let prepared: PrefetchRequest | undefined
  const prepare = (text: string, constraints: string, pins: OverridePins): void => {
    prepared = { plan, text, constraints, signature: overrideSignature(pins) }
  }
  let deferred = false
  // The override's text when there is one: it is core's file with the pins on, so it covers both.
  const defer = async (): Promise<void> => {
    if (deferred || signal?.aborted || !onDeferred) return
    deferred = true
    const text =
      prepared?.text ?? (await fs.promises.readFile(plan.reqPath, 'utf-8').catch(() => null))
    if (text === null) return
    onStatus?.({ kind: 'deferred' })
    sendOutput('Downloading the agent in the background; it starts on the next launch\n')
    onDeferred(prepared ?? { plan, text, signature: 'core' })
  }
  const decision = await tryOverride(
    plan,
    override,
    overrideState,
    run,
    sendOutput,
    signal,
    prepare
  )
  if (signal?.aborted || decision?.decision === 'applied') return decision
  if (decision?.decision === 'deferred') await defer()
  const core = await run(plan.reqPath, `.launch-agent-reqs-${attemptTag()}.txt`)
  if (signal?.aborted) return decision
  if (!core.ok) await defer()
  if (!core.ok || decision?.decision !== 'refused' || decision.reason !== 'core_first') {
    return decision
  }
  // Core's packages are in now, so the override goes in on this same launch, its constraints
  // built from what core's file installed.
  const retried = await tryOverride(plan, override, overrideState, run, sendOutput, signal, prepare)
  if (signal?.aborted) return retried
  if (retried?.decision === 'deferred') await defer()
  return retried
}

async function tryOverride(
  plan: AgentRequirementsInstall,
  raw: unknown,
  state: AgentOverrideState | null,
  run: CachedRun,
  sendOutput: (text: string) => void,
  signal: AbortSignal | undefined,
  prepare: (text: string, constraints: string, pins: OverridePins) => void
): Promise<OverrideDecision | undefined> {
  const parsed = parseAgentRequirementsOverride(raw)
  if (parsed.kind === 'none') return undefined
  if (parsed.kind === 'refused') return refuse(sendOutput, parsed.reason)
  const { pins } = parsed
  if (isRevertedFor(state, pins)) {
    // Core's file can't take back a pin over a line it leaves unversioned.
    const coreText = await fs.promises.readFile(plan.reqPath, 'utf-8').catch(() => '')
    const stuck = pinsOverBareLines(coreText, pins)
    sendOutput(
      `agent version override ${overrideSignature(pins)} failed before; ` +
        (stuck.size
          ? `ComfyUI's requirements don't pin ${[...stuck.keys()].join(', ')}, so they can't take ${overrideSignature(stuck)} back if it went in\n`
          : "using ComfyUI's versions\n")
    )
    return {
      decision: 'reverted',
      reason: 'previously_failed',
      pins,
      ...(stuck.size ? { staysInstalled: stuck } : {})
    }
  }
  const ready = await prepareOverride(plan, pins, signal)
  if (ready.kind === 'refused') return refuse(sendOutput, ready.reason, pins)
  const { coreText, text, constraints, listed } = ready
  prepare(text, constraints, pins)
  // Per attempt: two sessions of one install can run at once, and must not share these files.
  const tag = attemptTag()
  const constraintsName = `.launch-agent-reqs-override-${tag}-constraints.txt`
  const overridePath = path.join(plan.installPath, `.launch-agent-reqs-override-${tag}-src.txt`)
  const constraintsPath = path.join(plan.installPath, constraintsName)
  let install: InstallReport
  try {
    // Not counted toward retiring the override: it applies on a later launch, once core's are in.
    if (!coreFileInstalled(coreText, listed)) return refuse(sendOutput, 'core_first', pins)
    await fs.promises.writeFile(overridePath, text, 'utf-8')
    await fs.promises.writeFile(constraintsPath, constraints, 'utf-8')
    sendOutput(`Applying agent version override ${overrideSignature(pins)}\n`)
    // Relative to uv's cwd (the install dir): uv splits an absolute --constraint path on spaces.
    const installed = await run(overridePath, `.launch-agent-reqs-override-${tag}.txt`, [
      '--constraint',
      constraintsName
    ])
    if (signal?.aborted) return { decision: 'reverted', reason: 'install_failed', pins }
    if (!installed.ok) return deferOverride(sendOutput, pins, installed.report)
    install = installed.report
  } catch {
    return revertOnInstall(sendOutput, pins)
  } finally {
    void fs.promises.unlink(overridePath).catch(() => {})
    void fs.promises.unlink(constraintsPath).catch(() => {})
  }
  const behind = agentGoBehindAgent(pins, coreText, listed)
  if (behind)
    sendOutput(
      `⚠ comfy-agent-go ${behind.go} is older than ${behind.name} ${behind.agent}; the agent will run its bundled agent, not the Go one\n`
    )
  return { decision: 'applied', pins, install }
}

/** A `uv pip list` is local and fast; this only stops a stuck one holding the launch. */
const LIST_TIMEOUT_MS = 30_000

async function listInstalled(
  plan: AgentRequirementsInstall,
  signal: AbortSignal | undefined
): Promise<string | null> {
  if (signal?.aborted) return null
  const stop = new AbortController()
  const onStop = (): void => stop.abort()
  const timer = setTimeout(onStop, LIST_TIMEOUT_MS)
  signal?.addEventListener('abort', onStop, { once: true })
  const stopped = new Promise<null>((resolve) =>
    stop.signal.addEventListener('abort', () => resolve(null), { once: true })
  )
  try {
    const listed = runUvPipDetailed(
      plan.uvPath,
      ['pip', 'list', '--format', 'json', '--python', plan.pythonPath],
      plan.installPath,
      () => {},
      stop.signal
    ).then((result) => (result.code === 0 ? result.output : null))
    return await Promise.race([listed, stopped])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onStop)
  }
}

function refuse(
  sendOutput: (text: string) => void,
  reason: OverrideRefusal,
  pins?: OverridePins
): OverrideDecision {
  sendOutput(`agent version override refused (${reason}); using ComfyUI's versions\n`)
  return { decision: 'refused', reason, ...(pins ? { pins } : {}) }
}

type PreparedOverride =
  | { kind: 'refused'; reason: OverrideRefusal }
  | { kind: 'ready'; coreText: string; text: string; constraints: string; listed: string }

/** The override's requirement text and the constraints that hold everything else in place. */
async function prepareOverride(
  plan: AgentRequirementsInstall,
  pins: OverridePins,
  signal: AbortSignal | undefined
): Promise<PreparedOverride> {
  let coreText: string
  try {
    coreText = await fs.promises.readFile(plan.reqPath, 'utf-8')
  } catch {
    return { kind: 'refused', reason: 'check_failed' }
  }
  const mainText = await fs.promises
    .readFile(path.join(path.dirname(plan.reqPath), CORE_REQUIREMENTS), 'utf-8')
    .catch(() => '')
  const effective = effectiveAgentRequirements(coreText, pins, mainText)
  if (effective.kind === 'refused') return effective
  const listed = await listInstalled(plan, signal)
  const constraints = listed === null ? null : installedConstraints(listed, pins, coreText)
  if (listed === null || constraints === null) return { kind: 'refused', reason: 'check_failed' }
  return { kind: 'ready', coreText, text: effective.text, constraints, listed }
}

/**
 * What a launch with the agent would install, for a background download ahead of that launch: the
 * override's text when it validates and has not been given up on, else core's own file. Null when
 * core's file can't be read. Never throws.
 */
export async function prepareAgentPrefetch(
  plan: AgentRequirementsInstall,
  raw: unknown,
  state: AgentOverrideState | null
): Promise<PrefetchRequest | null> {
  try {
    const parsed = parseAgentRequirementsOverride(raw)
    if (parsed.kind === 'pins' && !isRevertedFor(state, parsed.pins)) {
      const ready = await prepareOverride(plan, parsed.pins, undefined)
      if (ready.kind === 'ready') {
        const { text, constraints } = ready
        return { plan, text, constraints, signature: overrideSignature(parsed.pins), eager: true }
      }
    }
    const text = await fs.promises.readFile(plan.reqPath, 'utf-8')
    return { plan, text, signature: 'core', eager: true }
  } catch {
    return null
  }
}

/** Never counted toward retiring the override: an install that is not done yet costs no launch time. */
function deferOverride(
  sendOutput: (text: string) => void,
  pins: OverridePins,
  install: InstallReport
): OverrideDecision {
  sendOutput(
    `agent version override ${overrideSignature(pins)} is not downloaded yet; using ComfyUI's versions\n`
  )
  return { decision: 'deferred', reason: 'not_cached', pins, install }
}

function revertOnInstall(sendOutput: (text: string) => void, pins: OverridePins): OverrideDecision {
  sendOutput(
    `agent version override ${overrideSignature(pins)} did not install; using ComfyUI's versions\n`
  )
  return { decision: 'reverted', reason: 'install_failed', pins }
}

/** Its own bound: the wheel is about 25 MB, and a launch that runs out of time tries again next. */
const FRONTEND_RESTORE_TIMEOUT_MS = 60_000

/**
 * Put ComfyUI's own `comfyui-frontend-package==X` back after an override moved it, with nothing
 * else installed (`--no-deps`; the package has no dependencies). Runs whether or not the agent
 * starts, since the launch after a campaign pulls its pin may not enable it. Bounded and fail-open,
 * never throws; true once ComfyUI's version is in, or when there is nothing to put back (no uv, or
 * no exact frontend pin in a readable `requirements.txt`), so the record is dropped either way.
 */
export async function restoreCoreFrontend(
  installation: InstallationRecord,
  sendOutput: (text: string) => void,
  signal?: AbortSignal
): Promise<boolean> {
  const uvPath = getActiveUvPath(installation)
  const pythonPath = getActivePythonPath(installation)
  if (!pythonPath || !fs.existsSync(uvPath)) return true
  const comfyDir = path.join(installation.installPath, 'ComfyUI')
  const mainText = await fs.promises
    .readFile(path.join(comfyDir, CORE_REQUIREMENTS), 'utf-8')
    .catch(() => '')
  const version = coreFrontendVersion(mainText)
  if (version === null) return true
  const tag = attemptTag()
  const reqPath = path.join(installation.installPath, `.launch-frontend-restore-${tag}-src.txt`)
  try {
    await fs.promises.writeFile(reqPath, `${FRONTEND_PACKAGE}==${version}\n`, 'utf-8')
    sendOutput(`\nPutting ComfyUI's ${FRONTEND_PACKAGE}==${version} back…\n`)
    const restored = await runBoundedInstall(
      {
        reqPath,
        uvPath,
        pythonPath,
        installPath: installation.installPath,
        label: 'frontend restore'
      },
      reqPath,
      `.launch-frontend-restore-${tag}.txt`,
      FRONTEND_RESTORE_TIMEOUT_MS,
      sendOutput,
      signal,
      { extraArgs: ['--no-deps'] }
    )
    return restored.ok
  } catch {
    return false
  } finally {
    void fs.promises.unlink(reqPath).catch(() => {})
  }
}

/** Generous: no one waits on it, and a stopped one resumes from the wheels it finished. */
const PREFETCH_TIMEOUT_MS = 30 * 60_000

const PREFETCH_PREFIX = '.agent-prefetch-'

/** One background download per install, so a relaunch while it runs does not start another. */
const prefetches = new Map<string, AbortController>()

/**
 * Fetch what a launch could not install into uv's cache without touching the environment ComfyUI
 * runs from: resolve against it (`--dry-run`), then install exactly the missing pins into a scratch
 * target, deleted after. The next launch's cache-only install takes them from there. False when one
 * is already running for this install. `onDone` gets nothing for an eager run that had nothing to
 * do. Never throws.
 */
export function prefetchAgentRequirements(
  request: PrefetchRequest,
  onDone: (report: PrefetchReport | null) => void
): boolean {
  const key = request.plan.installPath
  if (prefetches.has(key)) return false
  const stop = new AbortController()
  prefetches.set(key, stop)
  void runPrefetch(request, stop.signal)
    .then(onDone)
    .catch(() => {})
    .finally(() => prefetches.delete(key))
  return true
}

/** For quit: on POSIX uv leads its own process group, so it would outlive Desktop. */
export function stopAgentPrefetches(): void {
  for (const stop of prefetches.values()) stop.abort()
}

/** uv names only the large wheels as they download; the counts cover those. */
const UV_DOWNLOADING_LINE = /^\s*Downloading\s/
const UV_DOWNLOADED_LINE = /^\s*Downloaded\s/
const DRY_RUN_ADDED = /^ \+ (\S+==\S+)$/
const WOULD_DOWNLOAD = /^Would download /m

async function runPrefetch(
  request: PrefetchRequest,
  signal: AbortSignal
): Promise<PrefetchReport | null> {
  const { plan } = request
  const tag = `${PREFETCH_PREFIX}${attemptTag()}`
  const srcPath = path.join(plan.installPath, `${tag}-src.txt`)
  const pinsPath = path.join(plan.installPath, `${tag}-pins.txt`)
  // Relative to uv's cwd (the install dir): uv splits an absolute path on spaces.
  const constraintsName = `${tag}-constraints.txt`
  const startedAt = Date.now()
  const uvVersion = await readUvVersion(plan, signal)
  const done = (outcome: PrefetchReport['outcome'], run?: BoundedResult): PrefetchReport => {
    const lines = run?.output.split(/\r?\n/) ?? []
    return {
      outcome,
      exitCode: run?.report.exitCode ?? null,
      elapsedMs: Date.now() - startedAt,
      budgetMs: PREFETCH_TIMEOUT_MS,
      downloadsStarted: lines.filter((line) => UV_DOWNLOADING_LINE.test(line)).length,
      downloadsFinished: lines.filter((line) => UV_DOWNLOADED_LINE.test(line)).length,
      errorTail: run?.report.errorTail ?? null,
      uvVersion
    }
  }
  const failed = (
    run: BoundedResult,
    exited: 'resolve_failed' | 'download_failed'
  ): PrefetchReport => done(run.report.outcome === 'exited' ? exited : run.report.outcome, run)
  try {
    await removePrefetchFiles(plan.installPath)
    await fs.promises.writeFile(srcPath, request.text, 'utf-8')
    const constraintArgs: string[] = []
    if (request.constraints !== undefined) {
      await fs.promises.writeFile(
        path.join(plan.installPath, constraintsName),
        request.constraints,
        'utf-8'
      )
      constraintArgs.push('--constraint', constraintsName)
    }
    const dryRun = (extra: string[]): Promise<BoundedResult> =>
      runBoundedInstall(
        plan,
        srcPath,
        `${tag}-src-filtered.txt`,
        PREFETCH_TIMEOUT_MS,
        () => {},
        signal,
        {
          extraArgs: [...extra, '--dry-run', ...constraintArgs]
        }
      )
    // From the cache alone: a resolve passes on cached metadata, so only "Would download" says a
    // wheel is still missing.
    if (request.eager) {
      const cached = await dryRun([OFFLINE])
      if (cached.ok && !WOULD_DOWNLOAD.test(cached.output)) return null
    }
    const resolved = await dryRun([])
    if (!resolved.ok) return failed(resolved, 'resolve_failed')
    const pins = resolved.output
      .split(/\r?\n/)
      .flatMap((line) => line.match(DRY_RUN_ADDED)?.[1] ?? [])
    // Nothing to fetch: the launch's cache-only install failed for another reason.
    if (pins.length === 0) return done('nothing_missing', resolved)
    await fs.promises.writeFile(pinsPath, pins.join('\n') + '\n', 'utf-8')
    const fetched = await runBoundedInstall(
      plan,
      pinsPath,
      `${tag}-pins-filtered.txt`,
      Math.max(0, PREFETCH_TIMEOUT_MS - (Date.now() - startedAt)),
      () => {},
      signal,
      { extraArgs: ['--no-deps', '--target', tag], env: SERIAL_DOWNLOADS }
    )
    return fetched.ok ? done('completed', fetched) : failed(fetched, 'download_failed')
  } catch {
    return done('spawn_error')
  } finally {
    // Also clears what a run that Desktop's exit cut short left behind.
    await removePrefetchFiles(plan.installPath)
  }
}

async function removePrefetchFiles(installPath: string): Promise<void> {
  const names = await fs.promises.readdir(installPath).catch((): string[] => [])
  await Promise.all(
    names
      .filter((name) => name.startsWith(PREFETCH_PREFIX))
      .map((name) =>
        fs.promises
          .rm(path.join(installPath, name), { recursive: true, force: true })
          .catch(() => {})
      )
  )
}

async function readUvVersion(
  plan: AgentRequirementsInstall,
  signal: AbortSignal
): Promise<string | null> {
  const { code, output } = await runUvPipDetailed(
    plan.uvPath,
    ['--version'],
    plan.installPath,
    () => {},
    signal
  )
  return code === 0 ? (output.match(/^uv (\S+)/m)?.[1] ?? null) : null
}
