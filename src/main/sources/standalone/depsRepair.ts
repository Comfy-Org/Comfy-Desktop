import fs from 'fs'
import { app } from 'electron'
import { randomUUID } from 'crypto'
import path from 'path'
import { findSitePackages } from './envPaths'
import { getActivePythonPath, getActiveUvPath, getActiveVenvDir } from '../../lib/pythonEnv'
import { runUvPipDetailed, getPipIndexArgs, pipFreeze } from '../../lib/pip'
import { buildProtectedConstraints } from '../../lib/snapshots/restore'
import {
  detectRequirementsDrift,
  describeUnsatisfied,
  isSitePackagesEmpty,
  normalizeDistName,
  type RequirementsDrift,
  type UnsatisfiedRequirement
} from '../../lib/requirementsDrift'
import { withOutputTail } from '../../lib/logged-process'
import * as settings from '../../settings'
import * as telemetry from '../../lib/telemetry'
import { buildErrorFields } from '../../../shared/errorEvent'
import type { InstallationRecord } from '../../installations'

/**
 * Pre-launch repair for a Desktop-owned venv (managed standalone or adopted)
 * that no longer satisfies ComfyUI's requirements — e.g. ComfyUI's source was
 * moved outside Desktop's update path, an adoption's best-effort requirements
 * install failed, or a custom-node install downgraded a core dependency.
 * Without it, ComfyUI crashes at import (`No module named 'sqlalchemy'`,
 * `'comfy_aimdo.storage'`).
 *
 * Installs ONLY the unsatisfied requirement lines. Never fatal: every failure
 * path logs and returns so the launch proceeds exactly as it would have.
 */

/** Persisted on the record when a repair ran but the venv still didn't satisfy
 *  the same requirements, so the launch doesn't re-run uv every time. Scoped to
 *  the requirement files' hash AND the packages left unsatisfied: new
 *  requirements, or drift in any other package, get a fresh attempt. */
export interface DepsRepairGaveUp {
  reqsHash: string
  packages: string[]
  at: number
}

/** Consecutive failed installs for one set of requirement files. A failure is
 *  usually transient (offline, index outage) and retries next launch, but a
 *  deterministic one (an unresolvable conflict) would otherwise re-run uv on
 *  every launch; after MAX_FAILED_ATTEMPTS it pauses until the requirement
 *  files or Desktop's version change. */
export interface DepsRepairFailures {
  reqsHash: string
  count: number
  /** Desktop version that recorded the failures; a new version resets them. */
  appVersion?: string
}

/** Requirements that depend on torch: installing one into a venv with no torch
 *  to pin would let uv pull a default-index (CPU on Windows) torch. */
const TORCH_DEPENDENT = new Set(['torchsde'])

function currentAppVersion(): string {
  try {
    return app.getVersion()
  } catch {
    return ''
  }
}

export const MAX_FAILED_ATTEMPTS = 3

export type DepsRepairOutcome =
  | 'repaired'
  | 'unverified'
  | 'declined'
  | 'no_uv'
  | 'failed'
  | 'still_unsatisfied'
  | 'partial'
  | 'torch_missing'
  | 'cancelled'
  | 'site_packages_empty'

export interface DepsRepairTools {
  sendOutput?: (text: string) => void
  update: (data: Record<string, unknown>) => Promise<unknown>
  signal?: AbortSignal
  /** Ask before modifying an adopted install's venv. Resolves true to install;
   *  any rejection is treated as "skip". Not called for managed installs. */
  confirmAdoptedRepair: (unsatisfied: UnsatisfiedRequirement[]) => Promise<boolean>
}

export interface DepsRepairDeps {
  runUvPip: typeof runUvPipDetailed
  freeze: typeof pipFreeze
  detect: (installation: InstallationRecord) => RequirementsDrift | null
}

/** Drift for a standalone (managed or adopted) install's active venv. */
export function detectInstallDrift(installation: InstallationRecord): RequirementsDrift | null {
  return detectRequirementsDrift(
    path.join(installation.installPath, 'ComfyUI'),
    findSitePackages(getActiveVenvDir(installation))
  )
}

/**
 * The drift check reports nothing for a readable but empty site-packages, since
 * it can't tell a gutted venv from a misread path. Don't repair that, but make
 * it visible: a launch-log warning and a telemetry outcome. True when warned.
 */
export function warnIfSitePackagesEmpty(
  installation: InstallationRecord,
  sendOutput?: (text: string) => void
): boolean {
  const sitePackages = findSitePackages(getActiveVenvDir(installation))
  if (!isSitePackagesEmpty(sitePackages)) return false
  sendOutput?.(
    `\nWARNING: no installed Python packages found in ${sitePackages}; ` +
      `skipped the requirements check. ComfyUI may fail to start.\n`
  )
  telemetry.emit('comfy.desktop.deps_repair', {
    outcome: 'site_packages_empty',
    adopted: installation.adopted === true,
    variant: (installation.variant as string | undefined) ?? null
  })
  return true
}

function failureBudgetSpent(
  installation: InstallationRecord,
  drift: RequirementsDrift,
  appVersion: string
): boolean {
  const failures = installation.depsRepairFailures as DepsRepairFailures | null | undefined
  return (
    failures?.reqsHash === drift.reqsHash &&
    failures.count >= MAX_FAILED_ATTEMPTS &&
    (failures.appVersion ?? '') === appVersion
  )
}

/** Launch-log note when drift remains but the failure budget is spent, so a
 *  paused repair is never silent. Null otherwise. */
export function pausedRepairNote(
  installation: InstallationRecord,
  appVersion: string = currentAppVersion()
): string | null {
  const drift = detectInstallDrift(installation)
  if (!drift || drift.unsatisfied.length === 0) return null
  if (!failureBudgetSpent(installation, drift, appVersion)) return null
  return (
    `\nComfyUI requirements not satisfied by this environment: ${describeUnsatisfied(drift.unsatisfied)}\n` +
    `Automatic repair paused after ${MAX_FAILED_ATTEMPTS} failed attempts; it retries when ` +
    `ComfyUI's requirements or Desktop's version change.\n`
  )
}

/** Drift that a repair should act on: unsatisfied, and not already given up on. */
export function pendingDrift(
  installation: InstallationRecord,
  appVersion: string = currentAppVersion()
): RequirementsDrift | null {
  const drift = detectInstallDrift(installation)
  if (!drift || drift.unsatisfied.length === 0) return null
  const gaveUp = installation.depsRepairGaveUp as DepsRepairGaveUp | null | undefined
  if (
    gaveUp?.reqsHash === drift.reqsHash &&
    Array.isArray(gaveUp.packages) &&
    drift.unsatisfied.every((r) => gaveUp.packages.includes(r.name))
  ) {
    return null
  }
  if (failureBudgetSpent(installation, drift, appVersion)) return null
  return drift
}

export async function repairDeps(
  installation: InstallationRecord,
  drift: RequirementsDrift,
  tools: DepsRepairTools,
  deps: Partial<DepsRepairDeps> = {},
  appVersion: string = currentAppVersion()
): Promise<DepsRepairOutcome> {
  const runUv = deps.runUvPip ?? runUvPipDetailed
  const freeze = deps.freeze ?? pipFreeze
  const detect = deps.detect ?? detectInstallDrift
  const adopted = installation.adopted === true
  const summary = describeUnsatisfied(drift.unsatisfied)
  const report = (outcome: DepsRepairOutcome, extra: Record<string, unknown> = {}): void => {
    telemetry.emit('comfy.desktop.deps_repair', {
      outcome,
      adopted,
      variant: (installation.variant as string | undefined) ?? null,
      packages: drift.unsatisfied.map((r) => r.name),
      missing_count: drift.unsatisfied.filter((r) => r.reason === 'missing').length,
      outdated_count: drift.unsatisfied.filter((r) => r.reason === 'outdated').length,
      ...extra
    })
  }

  tools.sendOutput?.(`\nComfyUI requirements not satisfied by this environment: ${summary}\n`)

  const uvPath = getActiveUvPath(installation)
  const pythonPath = getActivePythonPath(installation)
  if (!pythonPath || !fs.existsSync(uvPath)) {
    tools.sendOutput?.(
      adopted
        ? `Cannot install them automatically: uv was not found at ${uvPath}. ` +
            `Use "Copy & Update" to rebuild this install as a fully managed one.\n`
        : `Cannot install them automatically: the Python environment or uv is missing.\n`
    )
    report('no_uv')
    return 'no_uv'
  }

  if (adopted) {
    const accepted = await tools.confirmAdoptedRepair(drift.unsatisfied).catch(() => false)
    if (tools.signal?.aborted) return 'cancelled'
    if (!accepted) {
      tools.sendOutput?.('Skipped installing the missing packages; ComfyUI may fail to start.\n')
      report('declined')
      return 'declined'
    }
  }

  // Pin the installed torch stack (and the rest of the protected set) so a
  // requirement's transitive dependencies can never swap it - uv would pull a
  // default-index CPU torch on Windows. A conflict fails the install instead.
  // A protected package that is itself unsatisfied is left unpinned, or it
  // would conflict with its own requirement. The requirement files' bounds go
  // in too, so installing the subset can't pull another requirement out of range.
  let constraints: string[]
  let torchInstalled: boolean
  try {
    const installed = await freeze(uvPath, pythonPath)
    torchInstalled = Object.keys(installed).some((name) => normalizeDistName(name) === 'torch')
    const unsatisfiedNames = new Set(drift.unsatisfied.map((r) => r.name))
    constraints = [
      ...buildProtectedConstraints(installed).filter(
        (pin) => !unsatisfiedNames.has(normalizeDistName(pin.split('==')[0]!))
      ),
      ...drift.requirements
        .filter((r) => r.specifier)
        // `==` and `~=` relaxed to `>=`: a newer install the user chose stays
        // put. Explicit upper bounds (`<`, `<=`, `!=`) are kept.
        .map((r) => `${r.name}${r.specifier.replace(/(^|,)\s*(?:==(?!=)|~=)/g, '$1>=')}`)
    ]
  } catch (err) {
    tools.sendOutput?.(`Could not read the installed packages: ${(err as Error).message}\n`)
    report('failed', { ...buildErrorFields(err) })
    return 'failed'
  }

  // With no torch installed there is nothing to pin, so a torch-dependent
  // requirement could pull a CPU torch. Leave it to the torch repair.
  const heldBack = torchInstalled
    ? []
    : drift.unsatisfied.filter((r) => TORCH_DEPENDENT.has(r.name))
  const toInstall = drift.unsatisfied.filter((r) => !heldBack.includes(r))
  if (heldBack.length > 0) {
    tools.sendOutput?.(
      `Not installing ${heldBack.map((r) => r.name).join(', ')}: PyTorch is not installed ` +
        `in this environment, so it could pull in the wrong PyTorch build.\n`
    )
  }
  if (toInstall.length === 0) {
    report('torch_missing')
    return 'torch_missing'
  }

  // Unique per run: a second launch of the same install must not unlink this
  // file out from under the first one's uv. Passed to uv by bare filename,
  // relative to its cwd (installPath): uv splits a --constraint value on
  // whitespace, so an install path with a space would break an absolute one.
  const constraintName = `.deps-repair-constraints-${randomUUID()}.txt`
  const constraintPath = path.join(installation.installPath, constraintName)

  tools.sendOutput?.('Installing the missing Python packages…\n')
  const mirrors = settings.getMirrorConfig()
  const install = (lines: string[]): ReturnType<typeof runUv> =>
    runUv(
      uvPath,
      [
        'pip',
        'install',
        ...lines,
        '--python',
        pythonPath,
        ...(constraints.length > 0 ? ['--constraint', constraintName] : []),
        ...getPipIndexArgs(mirrors.pypiMirror, mirrors.useChineseMirrors)
      ],
      installation.installPath,
      tools.sendOutput ?? (() => {}),
      tools.signal
    )

  let result: Awaited<ReturnType<typeof runUv>>
  // Lines that installed on their own after the batch failed; null when the
  // batch itself succeeded (or there was nothing to retry).
  let installedAlone: string[] | null = null
  try {
    if (constraints.length > 0) {
      await fs.promises.writeFile(constraintPath, constraints.join('\n'), 'utf-8')
    }
    result = await install(toInstall.map((r) => r.line))
    // One unresolvable requirement must not block the rest: retry each line
    // on its own, so whatever can install does.
    if (result.code !== 0 && toInstall.length > 1 && !tools.signal?.aborted) {
      tools.sendOutput?.('Retrying the packages one at a time…\n')
      installedAlone = []
      for (const req of toInstall) {
        if (tools.signal?.aborted) break
        if ((await install([req.line])).code === 0) installedAlone.push(req.name)
      }
    }
  } finally {
    await fs.promises.unlink(constraintPath).catch(() => {})
  }
  if (tools.signal?.aborted) return 'cancelled'

  if (result.code !== 0 && !installedAlone?.length) {
    const prior = installation.depsRepairFailures as DepsRepairFailures | null | undefined
    const sameRun = prior?.reqsHash === drift.reqsHash && (prior.appVersion ?? '') === appVersion
    const count = (sameRun ? prior.count : 0) + 1
    await tools.update({
      depsRepairFailures: {
        reqsHash: drift.reqsHash,
        count,
        appVersion
      } satisfies DepsRepairFailures
    })
    const message = withOutputTail(`uv pip install exited with code ${result.code}`, result.output)
    tools.sendOutput?.(
      count < MAX_FAILED_ATTEMPTS
        ? `Installing the missing packages failed (will retry on next launch).\n`
        : `Installing the missing packages failed ${count} times; paused until ComfyUI's requirements or Desktop's version change.\n`
    )
    report('failed', { uv_exit: result.code, attempts: count, ...buildErrorFields(message) })
    return 'failed'
  }
  if (installation.depsRepairFailures) await tools.update({ depsRepairFailures: null })

  // Loop guard: uv succeeded, so if the same requirements still read as
  // unsatisfied (e.g. a metadata-name mismatch this check can't see through),
  // re-running uv each launch would never converge. Stop until the
  // requirements change or other packages drift.
  const after = detect(installation)
  if (!after) {
    // uv succeeded but the environment can't be read back: don't claim a
    // repair nobody verified, and leave any give-up marker as it was.
    tools.sendOutput?.('Installed, but could not verify the environment afterwards.\n')
    report('unverified')
    return 'unverified'
  }
  // Held-back packages were never attempted: they must not be given up on,
  // so they install once the torch repair has put torch back.
  const remaining = after.unsatisfied.filter((r) => !heldBack.some((h) => h.name === r.name))
  if (remaining.length > 0) {
    await tools.update({
      depsRepairGaveUp: {
        reqsHash: drift.reqsHash,
        packages: remaining.map((r) => r.name),
        at: Date.now()
      } satisfies DepsRepairGaveUp
    })
    tools.sendOutput?.(`Still not satisfied after install: ${describeUnsatisfied(remaining)}\n`)
    const outcome = installedAlone ? 'partial' : 'still_unsatisfied'
    report(outcome, {
      remaining: remaining.map((r) => r.name),
      ...(installedAlone ? { installed: installedAlone } : {})
    })
    return outcome
  }

  if (installation.depsRepairGaveUp) await tools.update({ depsRepairGaveUp: null })
  tools.sendOutput?.('Missing Python packages installed.\n')
  report('repaired')
  return 'repaired'
}
