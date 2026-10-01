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
  readInstalledDists,
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

/**
 * The one record a repair leaves behind, for the packages it could not make
 * satisfied - whether uv failed on them or accepted them and they still read
 * as unsatisfied. A failure is often transient (offline, index outage), so the
 * repair retries on later launches; after MAX_FAILED_ATTEMPTS for the same
 * packages it is suppressed until ComfyUI's requirements or Desktop's version
 * change, and every suppressed launch says so. Cleared once nothing is left.
 */
export interface DepsRepairMarker {
  reqsHash: string
  appVersion: string
  packages: string[]
  attempts: number
}

/** ComfyUI requirements that depend on torch unconditionally (per their
 *  metadata): installing one into a venv with no torch to pin would let uv pull
 *  a default-index (CPU on Windows) torch. */
const TORCH_DEPENDENT = new Set(['torchsde', 'kornia', 'spandrel'])

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
  | 'partial'
  | 'failed'
  | 'torch_missing'
  | 'unverified'
  | 'declined'
  | 'no_uv'
  | 'cancelled'
  | 'site_packages_empty'
  | 'paused'

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

/**
 * A requirement's specifier as a constraint: `==` and `~=` relaxed to `>=`, so a
 * newer install the user chose stays put. Explicit upper bounds (`<`, `<=`,
 * `!=`) are kept, and so is a wildcard pin (`==1.*`): uv rejects `>=` with a
 * wildcard, which would fail every install.
 */
export function relaxSpecifier(specifier: string): string {
  return specifier
    .split(',')
    .map((part) => {
      const m = part.trim().match(/^(?:==(?!=)|~=)\s*([^\s*]+)$/)
      // PEP 440 forbids a local label (`+vendor`) with `>=`: floor on the public version.
      return m ? `>=${m[1]!.split('+')[0]}` : part.trim()
    })
    .join(',')
}

/** Requirements that are unsatisfied only because torch is absent: they are
 *  held back, so they neither join nor lift a suppression. */
function withoutHeldBack(
  unsatisfied: UnsatisfiedRequirement[],
  torchPresent: boolean
): UnsatisfiedRequirement[] {
  return torchPresent ? unsatisfied : unsatisfied.filter((r) => !TORCH_DEPENDENT.has(r.name))
}

function torchPresentIn(installation: InstallationRecord): boolean {
  const sitePackages = findSitePackages(getActiveVenvDir(installation))
  return sitePackages !== null && readInstalledDists(sitePackages).has('torch')
}

function suppressed(
  installation: InstallationRecord,
  drift: RequirementsDrift,
  appVersion: string
): boolean {
  const marker = installation.depsRepairMarker as DepsRepairMarker | null | undefined
  if (
    !marker ||
    marker.reqsHash !== drift.reqsHash ||
    marker.appVersion !== appVersion ||
    marker.attempts < MAX_FAILED_ATTEMPTS ||
    !Array.isArray(marker.packages)
  ) {
    return false
  }
  const relevant = withoutHeldBack(drift.unsatisfied, torchPresentIn(installation))
  return relevant.length > 0 && relevant.every((r) => marker.packages.includes(r.name))
}

/** Launch-log note when drift remains but the repair is suppressed, so it is
 *  never silent. Null otherwise. */
export function pausedRepairNote(
  installation: InstallationRecord,
  appVersion: string = currentAppVersion()
): string | null {
  const drift = detectInstallDrift(installation)
  if (!drift || drift.unsatisfied.length === 0) return null
  if (!suppressed(installation, drift, appVersion)) return null
  return (
    `\nComfyUI requirements not satisfied by this environment: ${describeUnsatisfied(drift.unsatisfied)}\n` +
    `Automatic repair paused after ${MAX_FAILED_ATTEMPTS} failed attempts; it retries when ` +
    `ComfyUI's requirements or Desktop's version change.\n`
  )
}

/** Log a suppressed repair and report it, so the paused population is
 *  measurable. True when suppressed. */
export function reportPausedRepair(
  installation: InstallationRecord,
  sendOutput?: (text: string) => void,
  appVersion: string = currentAppVersion()
): boolean {
  const note = pausedRepairNote(installation, appVersion)
  if (!note) return false
  sendOutput?.(note)
  const marker = installation.depsRepairMarker as DepsRepairMarker
  telemetry.emit('comfy.desktop.deps_repair', {
    outcome: 'paused',
    adopted: installation.adopted === true,
    variant: (installation.variant as string | undefined) ?? null,
    packages: marker.packages,
    attempts: marker.attempts
  })
  return true
}

/** Drift that a repair should act on: unsatisfied, and not suppressed. */
export function pendingDrift(
  installation: InstallationRecord,
  appVersion: string = currentAppVersion()
): RequirementsDrift | null {
  const drift = detectInstallDrift(installation)
  if (!drift || drift.unsatisfied.length === 0) return null
  return suppressed(installation, drift, appVersion) ? null : drift
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

  // Pin the installed torch stack (and the rest of the protected set) so a
  // requirement's transitive dependencies can never swap it - uv would pull a
  // default-index CPU torch on Windows. A conflict fails the install instead.
  // A protected package that is itself unsatisfied is left unpinned, or it
  // would conflict with its own requirement. The requirement files' bounds go
  // in too, so installing one line can't pull another requirement out of range.
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
        .map((r) => `${r.name}${relaxSpecifier(r.specifier)}`)
    ]
  } catch (err) {
    tools.sendOutput?.(`Could not read the installed packages: ${(err as Error).message}\n`)
    report('failed', { ...buildErrorFields(err) })
    return 'failed'
  }

  // With no torch installed there is nothing to pin, so a torch-dependent
  // requirement could pull a CPU torch. Hold it back - never recorded as
  // failed - so it installs on a later launch once torch is back.
  const toInstall = withoutHeldBack(drift.unsatisfied, torchInstalled)
  const heldBack = drift.unsatisfied.filter((r) => !toInstall.includes(r))
  const heldBackNames = new Set(heldBack.map((r) => r.name))
  if (heldBack.length > 0) {
    tools.sendOutput?.(
      `Not installing ${heldBack.map((r) => r.name).join(', ')}: PyTorch is not installed ` +
        `in this environment, so it could pull in the wrong PyTorch build.\n`
    )
  }
  if (toInstall.length === 0) {
    report('torch_missing', { held_back: heldBack.map((r) => r.name) })
    return 'torch_missing'
  }

  // Asked only now, so the prompt never offers a package that won't install.
  if (adopted) {
    const accepted = await tools.confirmAdoptedRepair(toInstall).catch(() => false)
    if (tools.signal?.aborted) return 'cancelled'
    if (!accepted) {
      tools.sendOutput?.('Skipped installing the missing packages; ComfyUI may fail to start.\n')
      report('declined')
      return 'declined'
    }
  }

  // Unique per run: a second launch of the same install must not unlink this
  // file out from under the first one's uv. Passed to uv by bare filename,
  // relative to its cwd (installPath): uv splits a --constraint value on
  // whitespace, so an install path with a space would break an absolute one.
  const constraintName = `.deps-repair-constraints-${randomUUID()}.txt`
  const constraintPath = path.join(installation.installPath, constraintName)

  // One line at a time, so one unresolvable requirement can't block the rest
  // and each package's outcome is known.
  tools.sendOutput?.('Installing the missing Python packages…\n')
  const mirrors = settings.getMirrorConfig()
  let lastFailure: Awaited<ReturnType<typeof runUv>> | null = null
  try {
    if (constraints.length > 0) {
      await fs.promises.writeFile(constraintPath, constraints.join('\n'), 'utf-8')
    }
    for (const req of toInstall) {
      if (tools.signal?.aborted) break
      const result = await runUv(
        uvPath,
        [
          'pip',
          'install',
          req.line,
          '--python',
          pythonPath,
          ...(constraints.length > 0 ? ['--constraint', constraintName] : []),
          ...getPipIndexArgs(mirrors.pypiMirror, mirrors.useChineseMirrors)
        ],
        installation.installPath,
        tools.sendOutput ?? (() => {}),
        tools.signal
      )
      if (result.code !== 0) lastFailure = result
    }
  } finally {
    await fs.promises.unlink(constraintPath).catch(() => {})
  }
  if (tools.signal?.aborted) return 'cancelled'

  const after = detect(installation)
  if (!after) {
    // The environment can't be read back: don't claim a repair nobody
    // verified, and leave the marker as it was.
    tools.sendOutput?.('Installed, but could not verify the environment afterwards.\n')
    report('unverified')
    return 'unverified'
  }
  // Whatever is still unsatisfied - uv failed, or accepted it and it still
  // reads as unsatisfied - is recorded the same way. Held-back packages were
  // never attempted.
  const remaining = after.unsatisfied.filter((r) => !heldBackNames.has(r.name))
  const failure = lastFailure
    ? {
        uv_exit: lastFailure.code,
        ...buildErrorFields(
          withOutputTail(`uv pip install exited with code ${lastFailure.code}`, lastFailure.output)
        )
      }
    : {}

  if (remaining.length === 0) {
    if (installation.depsRepairMarker) await tools.update({ depsRepairMarker: null })
    tools.sendOutput?.(
      heldBack.length > 0
        ? `Installed the missing Python packages except ${heldBack.map((r) => r.name).join(', ')}.\n`
        : 'Missing Python packages installed.\n'
    )
    const outcome = heldBack.length > 0 ? 'partial' : 'repaired'
    report(outcome, heldBack.length > 0 ? { held_back: heldBack.map((r) => r.name) } : {})
    return outcome
  }

  // The count carries on only while the same packages keep failing: a package
  // failing for the first time gets the full budget.
  const names = remaining.map((r) => r.name)
  const prior = installation.depsRepairMarker as DepsRepairMarker | null | undefined
  const sameRun =
    prior?.reqsHash === drift.reqsHash &&
    prior.appVersion === appVersion &&
    Array.isArray(prior.packages) &&
    names.every((name) => prior.packages.includes(name))
  const attempts = (sameRun ? prior.attempts : 0) + 1
  await tools.update({
    depsRepairMarker: {
      reqsHash: drift.reqsHash,
      appVersion,
      packages: names,
      attempts
    } satisfies DepsRepairMarker
  })
  tools.sendOutput?.(
    `Could not install ${describeUnsatisfied(remaining)} (` +
      (attempts < MAX_FAILED_ATTEMPTS
        ? 'will retry on next launch'
        : `failed ${attempts} times; paused until ComfyUI's requirements or Desktop's version change`) +
      `).\n`
  )
  const outcome = remaining.length === toInstall.length ? 'failed' : 'partial'
  report(outcome, {
    remaining: names,
    attempts,
    ...(heldBack.length > 0 ? { held_back: heldBack.map((r) => r.name) } : {}),
    ...failure
  })
  return outcome
}
