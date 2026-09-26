import fs from 'fs'
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
 *  every launch; after MAX_FAILED_ATTEMPTS it waits for the files to change. */
export interface DepsRepairFailures {
  reqsHash: string
  count: number
}

export const MAX_FAILED_ATTEMPTS = 3

export type DepsRepairOutcome =
  | 'repaired'
  | 'unverified'
  | 'declined'
  | 'no_uv'
  | 'failed'
  | 'still_unsatisfied'
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

/** Drift that a repair should act on: unsatisfied, and not already given up on. */
export function pendingDrift(installation: InstallationRecord): RequirementsDrift | null {
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
  const failures = installation.depsRepairFailures as DepsRepairFailures | null | undefined
  if (failures?.reqsHash === drift.reqsHash && failures.count >= MAX_FAILED_ATTEMPTS) return null
  return drift
}

export async function repairDeps(
  installation: InstallationRecord,
  drift: RequirementsDrift,
  tools: DepsRepairTools,
  deps: Partial<DepsRepairDeps> = {}
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
  try {
    const unsatisfiedNames = new Set(drift.unsatisfied.map((r) => r.name))
    constraints = [
      ...buildProtectedConstraints(await freeze(uvPath, pythonPath)).filter(
        (pin) => !unsatisfiedNames.has(normalizeDistName(pin.split('==')[0]!))
      ),
      ...drift.requirements
        .filter((r) => r.specifier)
        // `==` relaxed to `>=`: a newer install the user chose stays put.
        .map((r) => `${r.name}${r.specifier.replace(/(^|,)\s*==(?!=)/g, '$1>=')}`)
    ]
  } catch (err) {
    tools.sendOutput?.(`Could not read the installed packages: ${(err as Error).message}\n`)
    report('failed', { ...buildErrorFields(err) })
    return 'failed'
  }
  // Unique per run: a second launch of the same install must not unlink this
  // file out from under the first one's uv.
  const constraintPath = path.join(
    installation.installPath,
    `.deps-repair-constraints-${randomUUID()}.txt`
  )

  tools.sendOutput?.('Installing the missing Python packages…\n')
  const mirrors = settings.getMirrorConfig()
  let result: Awaited<ReturnType<typeof runUv>>
  try {
    if (constraints.length > 0) {
      await fs.promises.writeFile(constraintPath, constraints.join('\n'), 'utf-8')
    }
    result = await runUv(
      uvPath,
      [
        'pip',
        'install',
        ...drift.unsatisfied.map((r) => r.line),
        '--python',
        pythonPath,
        ...(constraints.length > 0 ? ['--constraint', constraintPath] : []),
        ...getPipIndexArgs(mirrors.pypiMirror, mirrors.useChineseMirrors)
      ],
      installation.installPath,
      tools.sendOutput ?? (() => {}),
      tools.signal
    )
  } finally {
    await fs.promises.unlink(constraintPath).catch(() => {})
  }
  if (tools.signal?.aborted) return 'cancelled'

  if (result.code !== 0) {
    const prior = installation.depsRepairFailures as DepsRepairFailures | null | undefined
    const count = (prior?.reqsHash === drift.reqsHash ? prior.count : 0) + 1
    await tools.update({
      depsRepairFailures: { reqsHash: drift.reqsHash, count } satisfies DepsRepairFailures
    })
    const message = withOutputTail(`uv pip install exited with code ${result.code}`, result.output)
    tools.sendOutput?.(
      count < MAX_FAILED_ATTEMPTS
        ? `Installing the missing packages failed (will retry on next launch).\n`
        : `Installing the missing packages failed ${count} times; not retrying until ComfyUI's requirements change.\n`
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
  if (after.unsatisfied.length > 0) {
    await tools.update({
      depsRepairGaveUp: {
        reqsHash: drift.reqsHash,
        packages: after.unsatisfied.map((r) => r.name),
        at: Date.now()
      } satisfies DepsRepairGaveUp
    })
    tools.sendOutput?.(
      `Still not satisfied after install: ${describeUnsatisfied(after.unsatisfied)}\n`
    )
    report('still_unsatisfied', { remaining: after.unsatisfied.map((r) => r.name) })
    return 'still_unsatisfied'
  }

  if (installation.depsRepairGaveUp) await tools.update({ depsRepairGaveUp: null })
  tools.sendOutput?.('Missing Python packages installed.\n')
  report('repaired')
  return 'repaired'
}
