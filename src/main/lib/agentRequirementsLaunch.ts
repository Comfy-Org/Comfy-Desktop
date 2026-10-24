import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import type { ChildProcess } from 'child_process'
import * as settings from '../settings'
import { VALID_PIP_NAME, installFilteredRequirementsDetailed, runUvPipDetailed } from './pip'
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
  normalizePackageName,
  overrideSignature,
  parseInstalled,
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
  await hardStop(proc)
  try {
    await fs.promises.unlink(path.join(installPath, tempName))
  } catch {}
}

async function hardStop(proc: ChildProcess | null): Promise<void> {
  const pid = proc?.pid
  if (!pid) return
  if (process.platform === 'win32') await runBounded('taskkill', ['/F', '/T', '/PID', String(pid)])
  else killGroup(pid)
}

function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), ms)))
  return Promise.race([promise.then(() => true), late]).finally(() => clearTimeout(timer))
}

/** Negated pid: the helper spawns detached, so uv leads its own process group and the group is
 *  the tree. Falls back to the bare pid when the group is already gone. */
function killGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {}
  }
}

const UV_RECORD_PREFIX = '.agent-uv-'
const runningOwnUv = new Set<number>()

/** On POSIX a detached uv outlives a Desktop that is killed: leave a note the next start can
 *  find it by. (Windows ties uv to Desktop's job object.) */
function recordUv(proc: ChildProcess, installPath: string): void {
  const pid = proc.pid
  if (process.platform === 'win32' || !pid) return
  const record = path.join(installPath, `${UV_RECORD_PREFIX}${pid}.json`)
  runningOwnUv.add(pid)
  try {
    fs.writeFileSync(record, JSON.stringify({ pid, startedAt: Date.now() }))
  } catch {}
  proc.once('close', () => {
    runningOwnUv.delete(pid)
    fs.promises.rm(record, { force: true }).catch(() => {})
  })
}

/** No agent uv runs this long (the background download's budget is 30 minutes): its record is
 *  stale, and is removed without asking `ps`. */
const RECORD_MAX_AGE_MS = 60 * 60_000
const PS_TIMEOUT_MS = 2_000

/** Whether `pid` is still the uv a record names: pids recycle, so the name and start time must
 *  match too (`ps` reports the start to the second). `ps` exits 1, silent, for a pid that is gone;
 *  any other failure leaves it unknown, and the record is kept for a later start to retry. */
function recordedUvIdentity(
  pid: number,
  startedAt: number
): Promise<'match' | 'other' | 'unknown'> {
  return new Promise((resolve) => {
    const options = { timeout: PS_TIMEOUT_MS, env: { ...process.env, LC_ALL: 'C' } }
    execFile('ps', ['-p', String(pid), '-o', 'lstart=,comm='], options, (err, stdout) => {
      const output = String(stdout)
      if (err) return resolve(err.code === 1 && !output.trim() ? 'other' : 'unknown')
      const match = /^\s*(\S+ \S+ +\d+ [\d:]+ \d+) +(.+?)\s*$/.exec(output)
      const started = match ? Date.parse(match[1]!) : NaN
      if (Number.isNaN(started)) return resolve('unknown')
      const same = path.basename(match![2]!) === 'uv' && Math.abs(started - startedAt) < 5_000
      resolve(same ? 'match' : 'other')
    })
  })
}

/** Whether `pid` is gone within `ms`: only ESRCH says so, not a pid we may not signal. */
async function goneWithin(pid: number, ms: number): Promise<boolean> {
  for (const until = Date.now() + ms; Date.now() < until; ) {
    try {
      process.kill(pid, 0)
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'ESRCH'
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

/**
 * Stop a uv a killed Desktop left running from `installPath`: it holds the environment's lock,
 * so a launch would wait on it, and it writes into files a new start clears. Skips the uv this
 * process runs; a record whose process is gone, or is not that uv, is just removed, and one
 * that can't be told is kept. Every record is checked at once. Never throws.
 */
export async function reapOrphanedAgentUv(installPath: string): Promise<void> {
  if (process.platform === 'win32') return
  const names = await fs.promises.readdir(installPath).catch((): string[] => [])
  await Promise.all(
    names
      .filter((entry) => entry.startsWith(UV_RECORD_PREFIX))
      .map((name) => reapRecord(path.join(installPath, name)))
  )
}

async function reapRecord(record: string): Promise<void> {
  let keep = false
  try {
    const { pid, startedAt } = JSON.parse(await fs.promises.readFile(record, 'utf-8'))
    const valid = Number.isInteger(pid) && pid > 1 && Number.isFinite(startedAt)
    if (valid && runningOwnUv.has(pid)) return
    const fresh = valid && Date.now() - startedAt < RECORD_MAX_AGE_MS
    const identity = fresh ? await recordedUvIdentity(pid, startedAt) : 'other'
    keep = identity === 'unknown'
    if (identity === 'match') {
      killGroup(pid)
      keep = !(await goneWithin(pid, FORCE_STOP_TIMEOUT_MS))
    }
  } catch {}
  if (!keep) await fs.promises.rm(record, { force: true }).catch(() => {})
}

/** Which way the bounded wait ended: uv exited, it threw, or the launch stopped
 *  waiting for a uv that would not stop. */
type InstallOutcome =
  | { kind: 'settled'; result: UvPipResult }
  | { kind: 'failed'; error: unknown }
  | { kind: 'abandoned' }

export interface BoundedResult {
  ok: boolean
  report: InstallReport
  output: string
}

/** Only uv's error, from its first `error:` or `×` line, with local paths and URLs scrubbed: a
 *  custom index's URL would name it, and the index kind is reported on its own. */
export function uvErrorTail(output: string, installPath: string): string | null {
  let text = uvErrorSection(output)
  if (text === null) return null
  for (const [local, label] of [
    [installPath, '<install>'],
    [os.homedir(), '~']
  ] as const) {
    if (!local) continue
    text = text.split(local).join(label).split(local.replace(/\\/g, '/')).join(label)
  }
  return text.replace(/\bhttps?:\/\/\S+/g, '<url>').slice(0, 500)
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
  if (typeof installation.installPath !== 'string') return null
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
  { extraArgs, env, subcommand }: RunOptions = {}
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
      recordUv(proc, plan.installPath)
    },
    env,
    subcommand
  ).then(
    (result) => ({ kind: 'settled', result }),
    (error: unknown) => ({ kind: 'failed', error })
  )

  try {
    const outcome = await Promise.race([install, abandoned])
    // A uv that ignored the stop is hard-stopped whoever asked for it: a caller that waits for
    // the stop (removing the install) must not go on with uv still running from inside it.
    if (outcome.kind === 'abandoned')
      await forceStopAgentInstall(uvProc, plan.installPath, tempName)
    // A cancelled launch kills uv mid-install, so whatever it reports is the
    // cancellation rather than a failure worth showing.
    if (signal?.aborted) return result('cancelled', null)
    if (outcome.kind === 'abandoned') {
      sendOutput(
        `\n⚠ ${label} install exceeded ${Math.round(timeoutMs / 1000)}s and uv did not stop; hard-stopped it and continuing without it\n`
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
          ? `\n⚠ ${label} install exceeded ${Math.round(timeoutMs / 1000)}s; continuing without it\n`
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
  subcommand?: 'install' | 'compile'
}

/**
 * How long a launch waits on downloading the agent's packages, shared by every download on the
 * launch. Each install tries uv's cache first; what is missing is then downloaded into the cache,
 * in parallel and outside the environment, for what is left of this, and installed from the
 * cache. Only the download is held to this: stopping uv part-way through an install would leave
 * the environment half-changed. What does not land in time goes to `prefetchAgentRequirements`,
 * which no one waits on, and the agent starts on the launch after it lands. About a Windows
 * ComfyUI boot (median 24 s), and above the 13 s the whole agent payload took on a fast link.
 */
const ONLINE_BUDGET_MS = 20_000

/** A cache-only install downloads nothing but still writes the whole agent into the
 *  environment, which a cross-drive copy and a virus scan can make slow: sized for that, as the
 *  launch's install was before it moved downloads to the background. */
const OFFLINE_TIMEOUT_MS = 120_000

/** The cache-only check (`--dry-run`, so it writes nothing) before every install from the cache: an
 *  install waits on the lock of a wheel another install's download is fetching, which a check does
 *  not take, and a check is safe to stop where an install into the environment is not. */
const CACHE_CHECK_TIMEOUT_MS = 30_000

/** One download at a time: a stopped uv keeps every wheel it finished, where in parallel a slow
 *  link finishes none of the large ones and every attempt starts over. */
const SERIAL_DOWNLOADS = { UV_CONCURRENT_DOWNLOADS: '1' }

const OFFLINE = '--offline'

export interface PrefetchStep {
  text: string
  constraints?: string
}

export interface PrefetchRequest {
  plan: AgentRequirementsInstall
  /** In order: core's own file first when it is not in yet, since a launch installs it first. */
  steps: PrefetchStep[]
  signature: string
  /** Ahead of any launch: unreported when the cache already holds everything. It still resolves
   *  online first, so an index it can't reach is reported as `unreachable`, cache or not. When
   *  the compile would move an installed version no index serves, its replacement is not fetched,
   *  and the run is `not_served` if nothing is fetched; when a constraint pins such a version
   *  that is not a local build, the compile finds no solution and the step is `resolve_failed`. */
  eager?: boolean
}

interface CachedResult extends BoundedResult {
  online: boolean
}

type CachedRun = (
  reqPath: string,
  tempName: string,
  constraints?: { name: string; text: string },
  network?: boolean
) => Promise<CachedResult>

/** uv's words for a resolve it proved impossible, in every version Desktop ships (0.11, 0.13). */
const NO_SOLUTION = /No solution found when resolving/
/** uv's words for a download or index that failed: a later download can fix those. Exit codes
 *  can't tell them apart: uv 0.11 exits 1 for a download cut short, as for no solution. */
const DOWNLOAD_FAILED =
  /Failed to (?:download|fetch)|error sending request|Request failed|\btimed out\b|\b(?:re|dis)?connect(?:s|ed|ing|ion|ions)?\b|dns error|certificate|HTTP status/i

/** uv's error, from its first `error:` or `×` line: whole, for deciding what failed. */
function uvErrorSection(output: string): string | null {
  const lines = stripAnsi(output).split(/\r?\n/)
  const start = lines.findIndex((line) => /^error:|^\s*×/.test(line))
  return start === -1 ? null : lines.slice(start).join('\n').trim()
}

/**
 * A failure no download can fix, from a try that had the network: uv proved there is no solution,
 * or failed on something it names that is not a download (a permission error, a locked file). A
 * cache-only try proves nothing, since a cache miss reads as no solution.
 */
function cannotDownload(result: CachedResult): boolean {
  if (!result.online || result.report.outcome !== 'exited') return false
  const error = uvErrorSection(result.output)
  return (
    NO_SOLUTION.test(stripAnsi(result.output)) || (error !== null && !DOWNLOAD_FAILED.test(error))
  )
}

export type Deferral = 'agent' | 'update'

/**
 * Install the planned requirements. Bounded and fail-open, never throws. An `override` that
 * validates and passes its check goes in first; otherwise, or when it is not downloaded in time,
 * core's own file. On a fresh install the override waits for core's file and then goes in on the
 * same launch. What does not download in time is handed to `onDeferred` for a background download;
 * a failure of core's file no download can fix goes to `onCoreFailed` instead. Returns the decision
 * to report, if any.
 */
export async function installAgentRequirements(
  plan: AgentRequirementsInstall,
  sendOutput: (text: string) => void,
  signal?: AbortSignal,
  override?: unknown,
  overrideState: AgentOverrideState | null = null,
  onDeferred?: (request: PrefetchRequest, deferral: Deferral) => void,
  onCoreFailed?: (report: InstallReport) => void
): Promise<OverrideDecision | undefined> {
  sendOutput('\nInstalling agent requirements…\n')
  let onlineLeft = ONLINE_BUDGET_MS
  const run: CachedRun = async (reqPath, tempName, constraints, network = true) => {
    const extraArgs = constraints ? ['--constraint', constraints.name] : []
    const cacheHoldsAll = (): Promise<BoundedResult> =>
      checkCache(plan, reqPath, tempName, CACHE_CHECK_TIMEOUT_MS, () => {}, signal, extraArgs)
    const fromCache = (output = sendOutput): Promise<BoundedResult> =>
      runBoundedInstall(plan, reqPath, tempName, OFFLINE_TIMEOUT_MS, output, signal, {
        extraArgs: [OFFLINE, ...extraArgs]
      })
    // Quiet: a cache miss is the expected case on a cold cache; the network try speaks for it.
    const checked = await cacheHoldsAll()
    const cached = checked.ok ? await fromCache(() => {}) : checked
    if (cached.ok || signal?.aborted || !network || onlineLeft <= 0) {
      return { ...cached, online: false }
    }
    const startedAt = Date.now()
    const fetched = await fetchForLaunch(
      plan,
      reqPath,
      constraints?.text,
      onlineLeft,
      sendOutput,
      signal
    )
    onlineLeft -= Date.now() - startedAt
    if (fetched.kind === 'failed') {
      // uv writes the scratch target only after the wheels are in its cache, and on a slow disk
      // that writing alone can outlast the budget: the cache may already hold everything.
      const late =
        fetched.stage === 'fetch' && fetched.run.report.outcome === 'timed_out' && !signal?.aborted
      const retried = late && (await cacheHoldsAll()).ok ? await fromCache() : null
      return retried?.ok ? { ...retried, online: true } : { ...fetched.run, online: true }
    }
    if (fetched.kind !== 'fetched') {
      const cacheMiss = NO_SOLUTION.test(stripAnsi(cached.output))
      return { ...cached, online: !cacheMiss }
    }
    return { ...(await fromCache()), online: true }
  }
  let overrideStep: PrefetchStep | undefined
  let signature = 'core'
  const prepare = (text: string, constraints: string, pins: OverridePins): void => {
    overrideStep = { text, constraints }
    signature = overrideSignature(pins)
  }
  let deferred = false
  // Everything not in yet, in the order a launch installs it: core's file, then the override.
  const defer = async (coreMissing: boolean): Promise<void> => {
    if (deferred || !onDeferred) return
    deferred = true
    const coreText = coreMissing
      ? await fs.promises.readFile(plan.reqPath, 'utf-8').catch(() => null)
      : null
    if (signal?.aborted || (coreMissing && coreText === null)) return
    const steps = [
      ...(coreText === null ? [] : [{ text: coreText }]),
      ...(overrideStep ? [overrideStep] : [])
    ]
    // Core's file in means the agent starts now, on core's versions, and only the override waits:
    // unless core pins only the placeholder, which is no agent at all.
    const placeholder = PLACEHOLDER_AGENT.test(
      coreText ?? (await fs.promises.readFile(plan.reqPath, 'utf-8').catch(() => ''))
    )
    const deferral: Deferral = coreMissing || placeholder ? 'agent' : 'update'
    sendOutput(
      deferral === 'agent'
        ? 'Downloading the agent in the background; it starts on the next launch\n'
        : "Downloading the agent's newer version in the background; it applies on the next launch\n"
    )
    onDeferred({ plan, steps, signature }, deferral)
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
  if (decision?.decision === 'deferred') await defer(false)
  const core = await run(plan.reqPath, `.launch-agent-reqs-${attemptTag()}.txt`)
  if (signal?.aborted) return decision
  if (!core.ok) {
    if (cannotDownload(core)) onCoreFailed?.(core.report)
    else await defer(true)
    return decision
  }
  if (decision?.decision !== 'refused' || decision.reason !== 'core_first') return decision
  // Core's packages are in now, so the override goes in on this same launch, its constraints
  // built from what core's file installed.
  const retried = await tryOverride(plan, override, overrideState, run, sendOutput, signal, prepare)
  if (signal?.aborted) return retried
  if (retried?.decision === 'deferred') await defer(false)
  if (retried?.decision === 'deferred' || retried?.decision === 'reverted') {
    // A failed install may have moved packages; core's file puts them back from the cache.
    await run(plan.reqPath, `.launch-agent-reqs-${attemptTag()}.txt`, undefined, false)
  }
  return retried
}

async function checkCache(
  plan: AgentRequirementsInstall,
  reqPath: string,
  tempName: string,
  timeoutMs: number,
  output: (text: string) => void,
  signal: AbortSignal | undefined,
  extraArgs: string[]
): Promise<BoundedResult> {
  const check = await runBoundedInstall(plan, reqPath, tempName, timeoutMs, output, signal, {
    extraArgs: [OFFLINE, '--dry-run', ...extraArgs]
  })
  return { ...check, ok: check.ok && !WOULD_DOWNLOAD.test(check.output) }
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
  try {
    // Not counted toward retiring the override: it applies on a later launch, once core's are in.
    if (!coreFileInstalled(coreText, listed)) return refuse(sendOutput, 'core_first', pins)
    await fs.promises.writeFile(overridePath, text, 'utf-8')
    await fs.promises.writeFile(constraintsPath, constraints, 'utf-8')
    sendOutput(`Applying agent version override ${overrideSignature(pins)}\n`)
    // Relative to uv's cwd (the install dir): uv splits an absolute --constraint path on spaces.
    const installed = await run(overridePath, `.launch-agent-reqs-override-${tag}.txt`, {
      name: constraintsName,
      text: constraints
    })
    if (signal?.aborted) return { decision: 'reverted', reason: 'install_failed', pins }
    if (!installed.ok) {
      return cannotDownload(installed)
        ? revertOnInstall(sendOutput, pins, installed.report)
        : deferOverride(sendOutput, pins, installed.report)
    }
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
  return { decision: 'applied', pins }
}

/** A `uv pip list` is local and fast; this only stops a stuck one holding the launch. */
const LIST_TIMEOUT_MS = 30_000

/** `untilExit`: a stop still waits for uv to exit, for a hold that must not return with it alive,
 *  bounded as an install's stop is: the grace, then a hard stop. */
async function listInstalled(
  plan: AgentRequirementsInstall,
  signal: AbortSignal | undefined,
  untilExit = false
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
    let proc: ChildProcess | null = null
    const listed = runUvPipDetailed(
      plan.uvPath,
      ['pip', 'list', '--format', 'json', '--python', plan.pythonPath],
      plan.installPath,
      () => {},
      stop.signal,
      (spawned) => (proc = spawned)
    ).then((result) => (result.code === 0 ? result.output : null))
    const first = await Promise.race([listed, stopped])
    if (!untilExit || !stop.signal.aborted) return first
    if (!(await settledWithin(listed, KILL_GRACE_MS))) {
      await hardStop(proc)
      await settledWithin(listed, FORCE_STOP_TIMEOUT_MS)
    }
    return null
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

async function prepareOverride(
  plan: AgentRequirementsInstall,
  pins: OverridePins,
  signal: AbortSignal | undefined,
  untilExit = false
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
  const listed = await listInstalled(plan, signal, untilExit)
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
  const key = plan.installPath
  if (quit.signal.aborted || held.has(key)) return null
  const stop = new AbortController()
  const onQuit = (): void => stop.abort()
  quit.signal.addEventListener('abort', onQuit, { once: true })
  const done = preparePrefetch(plan, raw, state, stop.signal)
  preparing.set(key, { stop, done })
  try {
    const request = await done
    return stop.signal.aborted ? null : request
  } finally {
    quit.signal.removeEventListener('abort', onQuit)
    preparing.delete(key)
  }
}

async function preparePrefetch(
  plan: AgentRequirementsInstall,
  raw: unknown,
  state: AgentOverrideState | null,
  signal: AbortSignal
): Promise<PrefetchRequest | null> {
  try {
    const parsed = parseAgentRequirementsOverride(raw)
    if (parsed.kind === 'pins' && !isRevertedFor(state, parsed.pins)) {
      const ready = await prepareOverride(plan, parsed.pins, signal, true)
      if (ready.kind === 'ready') {
        const { coreText, text, constraints, listed } = ready
        const core = coreFileInstalled(coreText, listed) ? [] : [{ text: coreText }]
        return {
          plan,
          steps: [...core, { text, constraints }],
          signature: overrideSignature(parsed.pins),
          eager: true
        }
      }
    }
    const text = await fs.promises.readFile(plan.reqPath, 'utf-8')
    return { plan, steps: [{ text }], signature: 'core', eager: true }
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

function revertOnInstall(
  sendOutput: (text: string) => void,
  pins: OverridePins,
  install?: InstallReport
): OverrideDecision {
  sendOutput(
    `agent version override ${overrideSignature(pins)} did not install; using ComfyUI's versions\n`
  )
  return { decision: 'reverted', reason: 'install_failed', pins, ...(install ? { install } : {}) }
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

interface RunningPrefetch {
  stop: AbortController
  done: Promise<void>
  signature: string
}

const prefetches = new Map<string, RunningPrefetch>()
const preparing = new Map<string, { stop: AbortController; done: Promise<unknown> }>()
const held = new Map<string, number>()
/** Aborted on quit: nothing starts after, and preparation ahead of a launch stops too. */
let quit = new AbortController()

/**
 * Fetch what a launch could not install into uv's cache without touching the environment ComfyUI
 * runs from: resolve (`uv pip compile`, preferring what is installed), then install exactly the
 * pins it lacks into a scratch target, deleted after. The next launch's cache-only install takes
 * them from there.
 *
 * One runs per install: another request while it runs is refused (false), and a different one
 * gets `onDone(null)` at once, so no caller waits on it. False after quit or while the install is
 * held. `onDone` gets nothing for a run that did nothing (everything cached). Never throws.
 */
export function prefetchAgentRequirements(
  request: PrefetchRequest,
  onDone: (report: PrefetchReport | null) => void
): boolean {
  const key = request.plan.installPath
  if (quit.signal.aborted || held.has(key)) return false
  const running = prefetches.get(key)
  if (running) {
    if (running.signature !== request.signature) onDone(null)
    return false
  }
  const entry: RunningPrefetch = {
    stop: new AbortController(),
    done: Promise.resolve(),
    signature: request.signature
  }
  entry.done = runPrefetch(request, entry.stop.signal)
    .then(onDone, () => onDone(null))
    .finally(() => prefetches.delete(key))
  prefetches.set(key, entry)
  return true
}

/** For quit: on POSIX uv leads its own process group, so it would outlive Desktop. */
export function stopAgentPrefetches(): void {
  quit.abort()
  for (const { stop } of prefetches.values()) stop.abort()
}

export function agentPrefetchesStopped(): boolean {
  return quit.signal.aborted
}

/**
 * For foreground work on an install's environment (a launch, an update, a copy, a delete), which a
 * background uv would contend with or hold open (on Windows, blocking a delete or a rename): stops
 * its download and any preparation for one, waits for uv to exit, and starts none for it until
 * `release` is called.
 */
export async function holdAgentPrefetch(installPath: string): Promise<() => void> {
  held.set(installPath, (held.get(installPath) ?? 0) + 1)
  const preparation = preparing.get(installPath)
  preparation?.stop.abort()
  const running = prefetches.get(installPath)
  running?.stop.abort()
  await Promise.all([preparation?.done, running?.done])
  await reapOrphanedAgentUv(installPath)
  let released = false
  return () => {
    if (released) return
    released = true
    const count = (held.get(installPath) ?? 1) - 1
    if (count > 0) held.set(installPath, count)
    else held.delete(installPath)
  }
}

/** uv names only the large wheels as they download; the counts cover those. */
const UV_DOWNLOADING_LINE = /^\s*Downloading\s/
const UV_DOWNLOADED_LINE = /^\s*Downloaded\s/
const DRY_RUN_ADDED = /^ \+ (\S+==\S+)$/
const COMPILED_PIN = /^([A-Za-z0-9][\w.-]*)==(\S+)$/
const WOULD_DOWNLOAD = /^Would download /m

async function runPrefetch(
  request: PrefetchRequest,
  signal: AbortSignal
): Promise<PrefetchReport | null> {
  const { plan } = request
  const startedAt = Date.now()
  let uvVersion: string | null = null
  const fetches: BoundedResult[] = []
  const lines = (pattern: RegExp): number =>
    fetches.flatMap((run) => run.output.split(/\r?\n/)).filter((line) => pattern.test(line)).length
  const done = (outcome: PrefetchReport['outcome'], run?: BoundedResult): PrefetchReport => ({
    outcome,
    exitCode: run?.report.exitCode ?? null,
    elapsedMs: Date.now() - startedAt,
    downloadsStarted: lines(UV_DOWNLOADING_LINE),
    downloadsFinished: lines(UV_DOWNLOADED_LINE),
    errorTail: run?.report.errorTail ?? null,
    uvVersion
  })
  try {
    uvVersion = await readUvVersion(plan, signal)
    await removePrefetchFiles(plan.installPath)
    let cachedSteps = 0
    let declined = false
    for (const [index, step] of request.steps.entries()) {
      const left = (): number => Math.max(0, PREFETCH_TIMEOUT_MS - (Date.now() - startedAt))
      const fetched = await fetchStep(plan, step, `${PREFETCH_PREFIX}${attemptTag()}-${index}`, {
        eager: request.eager === true,
        signal,
        left,
        mode: 'prefetch'
      })
      if (fetched.kind === 'unlisted') return done(signal.aborted ? 'cancelled' : 'list_failed')
      if (fetched.kind === 'cached') cachedSteps++
      if (fetched.kind === 'declined') declined = true
      if (fetched.kind === 'fetched') fetches.push(fetched.run)
      if (fetched.kind === 'failed') {
        if (fetched.stage === 'fetch') fetches.push(fetched.run)
        const { outcome } = fetched.run.report
        const exited = FAILED_OUTCOME[fetched.stage]
        return done(outcome === 'exited' ? exited : outcome, fetched.run)
      }
    }
    if (cachedSteps === request.steps.length) return null
    // No tail for a decline: it names the installed version, which may carry a private label.
    const nothing = declined ? 'not_served' : 'nothing_missing'
    return done(fetches.length ? 'completed' : nothing, fetches.at(-1))
  } catch {
    return done('spawn_error')
  } finally {
    // Also clears what a run that Desktop's exit cut short left behind.
    await removePrefetchFiles(plan.installPath)
  }
}

interface Resolved {
  run: BoundedResult
  pins: string[]
  notServed?: boolean
}

const FAILED_OUTCOME = {
  resolve: 'resolve_failed',
  fetch: 'download_failed',
  unreachable: 'unreachable'
} as const

type StepResult =
  | { kind: 'cached' | 'nothing' | 'unlisted' | 'declined' }
  | { kind: 'fetched'; run: BoundedResult }
  | { kind: 'failed'; stage: keyof typeof FAILED_OUTCOME; run: BoundedResult }

async function fetchStep(
  plan: AgentRequirementsInstall,
  step: PrefetchStep,
  tag: string,
  {
    eager,
    signal,
    left,
    mode,
    output = () => {}
  }: {
    eager: boolean
    signal: AbortSignal
    left: () => number
    /** A launch waits on its download, so it fetches in parallel and may take the lock. */
    mode: 'launch' | 'prefetch'
    output?: (text: string) => void
  }
): Promise<StepResult> {
  const srcPath = path.join(plan.installPath, `${tag}-src.txt`)
  const pinsPath = path.join(plan.installPath, `${tag}-pins.txt`)
  // Relative to uv's cwd (the install dir): uv splits an absolute path on spaces.
  const constraintsName = `${tag}-constraints.txt`
  await fs.promises.writeFile(srcPath, step.text, 'utf-8')
  const constraintArgs: string[] = []
  if (step.constraints !== undefined) {
    await fs.promises.writeFile(
      path.join(plan.installPath, constraintsName),
      // A compile can't see installed versions, so pinning a local build leaves no solution; the
      // seed and the probe keep it installed instead.
      mode === 'prefetch' ? step.constraints.replace(/^.*==\S*\+.*$\n?/gm, '') : step.constraints,
      'utf-8'
    )
    constraintArgs.push('--constraint', constraintsName)
  }
  const dryRun = async (): Promise<Resolved> => {
    const run = await runBoundedInstall(
      plan,
      srcPath,
      `${tag}-src-filtered.txt`,
      left(),
      output,
      signal,
      { extraArgs: ['--dry-run', ...constraintArgs] }
    )
    return {
      run,
      pins: run.output.split(/\r?\n/).flatMap((line) => line.match(DRY_RUN_ADDED)?.[1] ?? [])
    }
  }
  // Not a dry-run: that takes the environment's lock, and a ComfyUI-Manager install into the
  // running ComfyUI would wait behind it.
  const compile = async (): Promise<Resolved | null> => {
    const parsed = parseInstalled((await listInstalled(plan, signal, true)) ?? '')
    // Unseeded, the compile would move every installed version, local builds included.
    if (parsed === null) return null
    const listed = parsed.filter((p) => VALID_PIP_NAME.test(p.name) && PIP_VERSION.test(p.version))
    // uv prints compiled names normalised; `uv pip list` prints them as the package spells them.
    const installed = new Map(listed.map((p) => [normalizePackageName(p.name), p.version]))
    const compiledName = `${tag}-compiled.txt`
    const compiledPath = path.join(plan.installPath, compiledName)
    // uv keeps a version already in its output file where the requirements allow and an index
    // serves it. One no index serves (a local build) is not kept: uv picks the newest it finds,
    // or, under a constraint that pins it, finds no solution.
    const freeze = listed.map(({ name, version }) => `${name}==${version}\n`).join('')
    await fs.promises.writeFile(compiledPath, freeze, 'utf-8')
    const run = await runBoundedInstall(
      plan,
      srcPath,
      `${tag}-src-filtered.txt`,
      left(),
      output,
      signal,
      {
        extraArgs: ['-o', compiledName, '--no-header', '--no-annotate', ...constraintArgs],
        subcommand: 'compile'
      }
    )
    const compiled = run.ok ? await fs.promises.readFile(compiledPath, 'utf-8') : ''
    const pins = compiled.split(/\r?\n/).flatMap((line) => {
      const pin = line.trim().match(COMPILED_PIN)
      return pin && installed.get(pin[1]!) !== pin[2] ? [{ name: pin[1]!, line: pin[0] }] : []
    })
    // A launch keeps an installed version that still satisfies, unless offline it can't: then it
    // replaces one no index serves (a local build) with what this compile chose, once that is
    // cached. So the replacement for such a version is not fetched; the rest is.
    const unserved = new Set<string>()
    for (const { name } of pins.filter(({ name }) => installed.has(name))) {
      const probePath = path.join(plan.installPath, `${tag}-installed.txt`)
      await fs.promises.writeFile(probePath, `${name}==${installed.get(name)}\n`, 'utf-8')
      const served = await runBoundedInstall(
        plan,
        probePath,
        `${tag}-installed-filtered.txt`,
        left(),
        output,
        signal,
        { extraArgs: ['--no-deps', '--no-header', '--no-annotate'], subcommand: 'compile' }
      )
      if (served.ok) continue
      if (!NO_SOLUTION.test(stripAnsi(served.output))) return { run: served, pins: [] }
      unserved.add(name)
    }
    const kept = pins.filter(({ name }) => !unserved.has(name)).map(({ line }) => line)
    if (unserved.size && kept.length === 0) return { run, pins: [], notServed: true }
    return { run, pins: kept }
  }
  const resolution = await (mode === 'launch' ? dryRun() : compile())
  if (resolution === null) return { kind: 'unlisted' }
  const { run: resolved, pins, notServed } = resolution
  if (notServed) return { kind: 'declined' }
  if (!resolved.ok) {
    const error = uvErrorSection(resolved.output) ?? ''
    const unreachable = eager && !NO_SOLUTION.test(error) && DOWNLOAD_FAILED.test(error)
    return { kind: 'failed', stage: unreachable ? 'unreachable' : 'resolve', run: resolved }
  }
  if (pins.length === 0) return { kind: eager ? 'cached' : 'nothing' }
  await fs.promises.writeFile(pinsPath, pins.join('\n') + '\n', 'utf-8')
  if (eager) {
    // Asked of the scratch target: asking the environment takes its lock.
    const check = await checkCache(
      plan,
      pinsPath,
      `${tag}-pins-filtered.txt`,
      left(),
      output,
      signal,
      ['--no-deps', '--target', tag]
    )
    if (check.ok) return { kind: 'cached' }
  }
  const fetched = await runBoundedInstall(
    plan,
    pinsPath,
    `${tag}-pins-filtered.txt`,
    left(),
    output,
    signal,
    {
      extraArgs: ['--no-deps', '--target', tag],
      ...(mode === 'prefetch' ? { env: SERIAL_DOWNLOADS } : {})
    }
  )
  return fetched.ok
    ? { kind: 'fetched', run: fetched }
    : { kind: 'failed', stage: 'fetch', run: fetched }
}

const PIP_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+!_-]*$/
const PLACEHOLDER_AGENT = /^\s*comfy-agent(?:\[[^\]]*\])?\s*==\s*0\.0\.0/m

/**
 * A launch's network try: download what `reqPath` is missing into uv's cache, in parallel and into
 * a scratch target, so stopping it at the budget leaves the environment as it was. Never throws.
 */
async function fetchForLaunch(
  plan: AgentRequirementsInstall,
  reqPath: string,
  constraints: string | undefined,
  budgetMs: number,
  output: (text: string) => void,
  signal: AbortSignal | undefined
): Promise<StepResult> {
  const prefix = '.launch-agent-fetch-'
  const tag = `${prefix}${attemptTag()}`
  const staleBefore = Date.now() - 60 * 60_000
  // Not awaited: deleting a large leftover tree must not spend the download's budget.
  void removeScratch(
    plan.installPath,
    async (name, at) =>
      name.startsWith(prefix) &&
      (await fs.promises.lstat(at).catch(() => ({ mtimeMs: Infinity }))).mtimeMs < staleBefore
  )
  const stop = new AbortController()
  const onAbort = (): void => stop.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const deadline = Date.now() + budgetMs
  try {
    const text = await fs.promises.readFile(reqPath, 'utf-8')
    return await fetchStep(plan, { text, constraints }, tag, {
      eager: false,
      signal: stop.signal,
      left: () => Math.max(0, deadline - Date.now()),
      mode: 'launch',
      output
    })
  } catch {
    return { kind: 'nothing' }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await removeScratch(plan.installPath, (name) => name === tag || name.startsWith(`${tag}-`))
  }
}

async function removeScratch(
  installPath: string,
  owns: (name: string, at: string) => boolean | Promise<boolean>
): Promise<void> {
  const names = await fs.promises.readdir(installPath).catch((): string[] => [])
  await Promise.allSettled(
    names.map(async (name) => {
      const at = path.join(installPath, name)
      if (await owns(name, at)) await fs.promises.rm(at, { recursive: true, force: true })
    })
  )
}

function removePrefetchFiles(installPath: string): Promise<void> {
  return removeScratch(installPath, (name) => name.startsWith(PREFETCH_PREFIX))
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

export function _resetAgentPrefetchesForTest(): void {
  quit = new AbortController()
  held.clear()
  prefetches.clear()
}
