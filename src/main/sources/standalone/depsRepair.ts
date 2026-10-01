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
 * The one record a repair leaves behind: per package it could not make
 * satisfied - whether uv failed on it or accepted it and it still reads as
 * unsatisfied - how many attempts it has had. A failure is often transient
 * (offline, index outage), so the repair retries on later launches; once a
 * package has had MAX_FAILED_ATTEMPTS it is skipped, and when every remaining
 * package is skipped the repair is suppressed and every launch says so. A new
 * set of requirement files or a new Desktop version starts the counts afresh.
 * Counted per package, so another package going missing neither resets nor
 * inherits a count. Cleared once nothing is left.
 */
export interface DepsRepairMarker {
  reqsHash: string
  appVersion: string
  attempts: Record<string, number>
}

/** ComfyUI requirements that need part of the torch stack (per their
 *  metadata), and which part: installing one while that part is missing would
 *  let uv pull a default-index (CPU on Windows) build of it. */
const TORCH_DEPENDENT: Record<string, string[]> = {
  torchsde: ['torch'],
  kornia: ['torch'],
  spandrel: ['torch', 'torchvision']
}

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
  | 'prompt_unavailable'
  | 'no_uv'
  | 'cancelled'
  | 'site_packages_empty'
  | 'paused'

export interface DepsRepairTools {
  sendOutput?: (text: string) => void
  update: (data: Record<string, unknown>) => Promise<unknown>
  signal?: AbortSignal
  /** Ask before modifying an adopted install's venv. Resolves true to install,
   *  false when the user skips; rejects when the prompt can't be shown (no
   *  window to show it in, no acknowledgement), which changes nothing either.
   *  Not called for managed installs. */
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
  torchStack: Set<string>
): UnsatisfiedRequirement[] {
  return unsatisfied.filter((r) => (TORCH_DEPENDENT[r.name] ?? []).every((d) => torchStack.has(d)))
}

/** Which of torch / torchvision the environment has. */
function torchStackIn(installation: InstallationRecord): Set<string> {
  const sitePackages = findSitePackages(getActiveVenvDir(installation))
  const dists = sitePackages !== null ? readInstalledDists(sitePackages) : new Map()
  return new Set(['torch', 'torchvision'].filter((name) => dists.has(name)))
}

/** Attempts so far per package, for these requirement files and this Desktop
 *  version; empty when the marker belongs to other ones. */
function priorAttempts(
  installation: InstallationRecord,
  reqsHash: string,
  appVersion: string
): Record<string, number> {
  const marker = installation.depsRepairMarker as DepsRepairMarker | null | undefined
  return marker &&
    marker.reqsHash === reqsHash &&
    marker.appVersion === appVersion &&
    marker.attempts !== null &&
    typeof marker.attempts === 'object'
    ? marker.attempts
    : {}
}

const isSpent = (attempts: Record<string, number>, name: string): boolean =>
  (attempts[name] ?? 0) >= MAX_FAILED_ATTEMPTS

function suppressed(
  installation: InstallationRecord,
  drift: RequirementsDrift,
  appVersion: string
): boolean {
  const attempts = priorAttempts(installation, drift.reqsHash, appVersion)
  const relevant = withoutHeldBack(drift.unsatisfied, torchStackIn(installation))
  return relevant.length > 0 && relevant.every((r) => isSpent(attempts, r.name))
}

/**
 * Drop marker entries for packages that are no longer unsatisfied, so a
 * package that recovers and goes missing again later gets a fresh budget - even
 * while another package keeps the repair suppressed. Returns the record as the
 * rest of the launch should see it.
 */
export async function pruneMarker(
  installation: InstallationRecord,
  update: (data: Record<string, unknown>) => Promise<unknown>
): Promise<InstallationRecord> {
  const marker = installation.depsRepairMarker as DepsRepairMarker | null | undefined
  if (!marker || marker.attempts === null || typeof marker.attempts !== 'object') {
    return installation
  }
  const drift = detectInstallDrift(installation)
  if (!drift) return installation
  const unsatisfied = new Set(drift.unsatisfied.map((r) => r.name))
  const kept = Object.entries(marker.attempts).filter(([name]) => unsatisfied.has(name))
  if (kept.length === Object.keys(marker.attempts).length) return installation
  const next = kept.length > 0 ? { ...marker, attempts: Object.fromEntries(kept) } : null
  await update({ depsRepairMarker: next })
  return { ...installation, depsRepairMarker: next } as InstallationRecord
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
    packages: Object.keys(marker.attempts)
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
  // Only held-back packages left: nothing can install until torch is back.
  if (withoutHeldBack(drift.unsatisfied, torchStackIn(installation)).length === 0) return null
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
  let torchStack: Set<string>
  try {
    const installed = await freeze(uvPath, pythonPath)
    const installedNames = new Set(Object.keys(installed).map(normalizeDistName))
    torchStack = new Set(['torch', 'torchvision'].filter((name) => installedNames.has(name)))
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
  const installable = withoutHeldBack(drift.unsatisfied, torchStack)
  const heldBack = drift.unsatisfied.filter((r) => !installable.includes(r))
  const heldBackNames = new Set(heldBack.map((r) => r.name))
  if (heldBack.length > 0) {
    const needs = (r: UnsatisfiedRequirement): string =>
      `${r.name} (needs ${TORCH_DEPENDENT[r.name]!.filter((d) => !torchStack.has(d)).join(', ')})`
    tools.sendOutput?.(
      `Not installing ${heldBack.map(needs).join(', ')}: that part of PyTorch is not ` +
        `installed in this environment, so it could pull in the wrong PyTorch build.\n`
    )
  }
  if (installable.length === 0) {
    report('torch_missing', { held_back: heldBack.map((r) => r.name) })
    return 'torch_missing'
  }
  // Packages that have had their attempts are skipped, so they can't hold up
  // the rest (or ride along on every launch another package needs repairing).
  const attempts = priorAttempts(installation, drift.reqsHash, appVersion)
  const skipped = installable.filter((r) => isSpent(attempts, r.name))
  const toInstall = installable.filter((r) => !skipped.includes(r))
  const pausedNote = (names: string[]): string =>
    `Automatic repair paused for ${names.join(', ')} after ${MAX_FAILED_ATTEMPTS} failed ` +
    `attempts; it retries when ComfyUI's requirements or Desktop's version change.\n`
  if (skipped.length > 0) tools.sendOutput?.(pausedNote(skipped.map((r) => r.name)))
  if (toInstall.length === 0) {
    report('paused', { skipped: skipped.map((r) => r.name) })
    return 'paused'
  }

  // Asked only now, so the prompt never offers a package that won't install.
  if (adopted) {
    let accepted: boolean
    try {
      accepted = await tools.confirmAdoptedRepair(toInstall)
    } catch {
      if (tools.signal?.aborted) return 'cancelled'
      // Not the user's choice: the prompt never reached them.
      tools.sendOutput?.(
        'Could not show the prompt to install the missing or outdated packages; ' +
          'ComfyUI may fail to start.\n'
      )
      report('prompt_unavailable')
      return 'prompt_unavailable'
    }
    if (tools.signal?.aborted) return 'cancelled'
    if (!accepted) {
      tools.sendOutput?.(
        'Skipped installing the missing or outdated packages; ComfyUI may fail to start.\n'
      )
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
  tools.sendOutput?.('Installing the missing or outdated Python packages…\n')
  const mirrors = settings.getMirrorConfig()
  let lastFailure: Awaited<ReturnType<typeof runUv>> | null = null
  const uvFailed = new Set<string>()
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
      if (result.code !== 0) {
        lastFailure = result
        uvFailed.add(req.name)
      }
    }
  } finally {
    await fs.promises.unlink(constraintPath).catch(() => {})
  }
  if (tools.signal?.aborted) return 'cancelled'

  const failure = lastFailure
    ? {
        uv_exit: lastFailure.code,
        ...buildErrorFields(
          withOutputTail(`uv pip install exited with code ${lastFailure.code}`, lastFailure.output)
        )
      }
    : {}

  const after = detect(installation)
  if (!after) {
    // The environment can't be read back: don't claim a repair nobody
    // verified, and leave the marker as it was.
    tools.sendOutput?.('Could not verify the environment after installing.\n')
    report('unverified', failure)
    return 'unverified'
  }
  // Whatever is still unsatisfied - uv failed, or accepted it and it still
  // reads as unsatisfied - counts an attempt against that package. Held-back
  // and skipped packages weren't attempted, so their counts stand.
  const remaining = after.unsatisfied.filter((r) => !heldBackNames.has(r.name))
  const attempted = new Set(toInstall.map((r) => r.name))
  const nextAttempts: Record<string, number> = {}
  for (const r of remaining) {
    const count = (attempts[r.name] ?? 0) + (attempted.has(r.name) ? 1 : 0)
    if (count > 0) nextAttempts[r.name] = count
  }
  if (Object.keys(nextAttempts).length > 0) {
    await tools.update({
      depsRepairMarker: {
        reqsHash: drift.reqsHash,
        appVersion,
        attempts: nextAttempts
      } satisfies DepsRepairMarker
    })
  } else if (installation.depsRepairMarker) {
    await tools.update({ depsRepairMarker: null })
  }

  const remainingNames = new Set(remaining.map((r) => r.name))
  const failedNow = remaining.filter((r) => uvFailed.has(r.name))
  const stuckNow = remaining.filter((r) => attempted.has(r.name) && !uvFailed.has(r.name))
  if (failedNow.length > 0) {
    tools.sendOutput?.(`Could not install ${describeUnsatisfied(failedNow)}.\n`)
  }
  if (stuckNow.length > 0) {
    tools.sendOutput?.(`Installed, but still not satisfied: ${describeUnsatisfied(stuckNow)}\n`)
  }
  const nowSpent = [...failedNow, ...stuckNow].filter((r) => isSpent(nextAttempts, r.name))
  if (nowSpent.length > 0) tools.sendOutput?.(pausedNote(nowSpent.map((r) => r.name)))
  else if (failedNow.length + stuckNow.length > 0)
    tools.sendOutput?.('Will retry on next launch.\n')

  if (remaining.length === 0 && heldBack.length === 0 && skipped.length === 0) {
    tools.sendOutput?.('Missing or outdated Python packages installed.\n')
    report('repaired')
    return 'repaired'
  }
  if (remaining.length === 0) {
    tools.sendOutput?.(
      `Installed the missing or outdated Python packages except ${[...heldBack, ...skipped].map((r) => r.name).join(', ')}.\n`
    )
  }
  // Partial when at least one attempted package was repaired - judged by
  // membership, since the install can leave a different package unsatisfied.
  const repairedAny = toInstall.some((r) => !remainingNames.has(r.name))
  const outcome = repairedAny || remaining.length === 0 ? 'partial' : 'failed'
  report(outcome, {
    ...(remaining.length > 0 ? { remaining: remaining.map((r) => r.name) } : {}),
    ...(heldBack.length > 0 ? { held_back: heldBack.map((r) => r.name) } : {}),
    ...(skipped.length > 0 ? { skipped: skipped.map((r) => r.name) } : {}),
    ...(remaining.length > 0
      ? { attempts: Math.max(0, ...remaining.map((r) => nextAttempts[r.name] ?? 0)) }
      : {}),
    ...failure
  })
  return outcome
}
