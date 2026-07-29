import fs from 'fs'
import path from 'path'
import { fetchLatestRelease } from '../../lib/comfyui-releases'
import * as releaseCache from '../../lib/release-cache'
import { formatComfyVersion } from '../../lib/version'
import type { ComfyVersion } from '../../lib/version'
import { resolveLocalVersion } from '../../lib/version-resolve'
import { readGitHead, rollbackComfySource } from '../../lib/git'
import { writeOpMarker, completeOpMarker } from '../../lib/opMarker'
import { installFilteredRequirementsDetailed } from '../../lib/pip'
import { withOutputTail } from '../../lib/logged-process'
import { copyDirWithProgress } from '../../lib/copy'
import { listCustomNodes, findComfyUIDir, backupDir, mergeDirFlat } from '../../lib/migrate'
import { t } from '../../lib/i18n'
import { MSG_CANCELLED } from '../../../shared/operationStatus'
import * as installations from '../../installations'
import * as settings from '../../settings'
import * as snapshots from '../../lib/snapshots'
import { getActivePythonPath, getActiveUvPath, getInstalledTorchTuple, getMasterPythonPath } from './envPaths'
import { stackVersionMatches, torchTupleMatches, torchTupleReacquirable, observedTuple, hasFullObservedTuple, stackAppliesViaPip, parseAnyIndexStackId } from './torchStackTypes'
import type { TorchStackPackages } from './torchStackTypes'
import { COMFYUI_REPO, getEffectiveChannel } from './updateSections'
import { runComfyUIUpdate } from './updateOrchestrator'
import { resolveTorchStack, resolveSnapshotManagedTarget, refreshTorchStackCatalog } from './torchStackCatalog'
import type { TorchStackEntry } from './torchStackCatalog'
import {
  preflightDiskSpace, prepareBundleStack, preparePipStack, applyTorchStackTransaction,
  recoverTorchStackTransaction, DiskSpaceError,
} from './torchStackTransaction'
import type { PreparedStack, TorchStackTools } from './torchStackTransaction'
import { releaseInstallTerminalForFsOp } from '../../lib/popoutWindows'
import type { InstallationRecord } from '../../installations'
import type { ActionResult, ActionTools } from '../../types/sources'

/** Actions that mutate the venv (adopted installs included — their legacy
 *  venv goes through the same journaled torch transaction). Each must first
 *  resolve any PyTorch change that died mid-transaction — mutating a venv
 *  that recovery is about to roll back (or failing to roll back and mutating
 *  debris) would corrupt it. */
const VENV_MUTATING_ACTIONS = new Set(['snapshot-restore', 'change-pytorch', 'update-comfyui', 'migrate-from'])

/** Download + stage a torch bundle, then re-check disk (`staged: true` — the
 *  bundle already occupies its staging space, only the venv copy still needs
 *  room). Owns staging-dir cleanup on every failure path and maps errors to
 *  action results, so the restore and change-pytorch flows cannot diverge. */
async function acquireTorchBundle(
  installation: InstallationRecord,
  entry: TorchStackEntry,
  tools: TorchStackTools,
): Promise<{ prepared: PreparedStack; failure?: never } | { prepared?: never; failure: ActionResult }> {
  // Pip-applied stacks skip bundle staging entirely: adopted (pip-managed)
  // installs always pip-apply, and index-served entries have no bundle
  // artifact on any install type — the exact tuple is pip-installed from
  // the trusted index inside the transaction.
  if (stackAppliesViaPip(entry.source, installation.adopted === true)) {
    return { prepared: preparePipStack(entry.packages, entry) }
  }
  let prepared: PreparedStack | undefined
  try {
    prepared = await prepareBundleStack(installation, entry, tools)
    if (tools.signal?.aborted) throw new Error('Cancelled')
    await preflightDiskSpace(installation, entry, tools.signal, { staged: true })
    return { prepared }
  } catch (err) {
    if (prepared && prepared.kind === 'bundle') {
      await fs.promises.rm(prepared.stagingDir, { recursive: true, force: true }).catch(() => {})
    }
    if (tools.signal?.aborted) return { failure: { ok: false, message: 'Cancelled' } }
    if (err instanceof DiskSpaceError) return { failure: { ok: false, message: err.message } }
    return { failure: { ok: false, message: t('standalone.pytorchDownloadFailed', { message: (err as Error).message }) } }
  }
}

export async function handleAction(
  actionId: string,
  installation: InstallationRecord,
  actionData: Record<string, unknown> | undefined,
  { update, sendProgress, sendOutput, signal }: ActionTools
): Promise<ActionResult> {
  if (VENV_MUTATING_ACTIONS.has(actionId)) {
    try {
      await recoverTorchStackTransaction(installation)
    } catch (err) {
      // Fail closed: the venv is in an unknown state and must not be mutated.
      return { ok: false, message: t('errors.recoveryFailed', { message: (err as Error).message }) }
    }
  }

  if (actionId === 'snapshot-save') {
    const label = (actionData?.label as string | undefined) || undefined
    const filename = await snapshots.saveSnapshot(installation.installPath, installation, 'manual', label)
    const snapshotCount = await snapshots.getSnapshotCount(installation.installPath)
    await update({ lastSnapshot: filename, snapshotCount })
    return { ok: true, navigate: 'detail' }
  }

  if (actionId === 'snapshot-restore') {
    // Restore target is either a snapshot already in this install's history
    // (`file`) or a freshly imported envelope staged outside history
    // (`restoreToken`). A staged import is only committed to history once the
    // restore succeeds, so a failed restore leaves the timeline untouched.
    const file = actionData?.file as string | undefined
    const restoreToken = actionData?.restoreToken as string | undefined
    if (!file && !restoreToken) return { ok: false, message: t('standalone.snapshotNoFile') }

    // Restore mode: in-history snapshots of THIS install default to exact
    // reproduction; imported envelopes default to the closest working state
    // on this machine (they may come from different hardware). Unknown values
    // fall back to the default rather than being trusted.
    const modeRaw = actionData?.mode
    const mode: snapshots.RestoreMode =
      modeRaw === 'exact' || modeRaw === 'compatible'
        ? modeRaw
        : restoreToken ? 'compatible' : 'exact'

    // Drop the shared shell + pop-outs first: on Windows a live shell holds a
    // handle on the install dir and any running python locks venv DLLs, which
    // breaks the site-packages removals/upgrades this restore performs.
    releaseInstallTerminalForFsOp(installation.id)

    sendOutput('Loading snapshot…\n')
    const stagedEnvelope = restoreToken
      ? await snapshots.loadStagedSnapshotEnvelope(restoreToken, installation.id)
      : undefined
    const targetSnapshot = stagedEnvelope
      ? stagedEnvelope.snapshots[0]!
      : await snapshots.loadSnapshot(installation.installPath, file!)

    // v2 snapshots carry the exact PyTorch stack identity. Resolve and
    // disk-preflight it up front so an unavailable stack or a full disk aborts
    // before anything is mutated — never silently restore onto the wrong
    // stack. The swap itself is applied LAST, after pip, so nothing later in
    // the restore can override the final stack.
    const snapTorch = targetSnapshot.torchStack
    const installedTorch = getInstalledTorchTuple(installation)
    const torchBefore = installedTorch.torch
    const adopted = installation.adopted === true
    let torchTarget: Awaited<ReturnType<typeof resolveTorchStack>> = null
    // Observed tuple to pip-restore (adopted installs only): exact versions
    // with local tags, re-acquirable from the derived index.
    let torchObservedTuple: TorchStackPackages | null = null
    let torchNote: string | null = null
    // Skip the torch phase only on a FULL tuple match — torch version alone
    // can't distinguish stacks that differ in torchvision/torchaudio.
    if (snapTorch?.kind === 'managed' && !torchTupleMatches(snapTorch.ref.packages, installedTorch)) {
      try {
        // Applicability (resolve + metadata-drift guard) is shared with the
        // import-confirm disclosure via resolveSnapshotManagedTarget.
        torchTarget = await resolveSnapshotManagedTarget(installation, snapTorch.ref)
      } catch (err) {
        if (mode === 'exact') {
          return { ok: false, message: t('standalone.pytorchCatalogError', { message: (err as Error).message }) }
        }
        torchTarget = null
      }
      if (!torchTarget) {
        // Exact mode promises the recorded stack; compatible mode keeps the
        // local stack and discloses the substitution instead of aborting
        // (the snapshot may come from different hardware).
        if (mode === 'exact') {
          return { ok: false, message: t('standalone.pytorchSnapshotStackUnavailable', { version: snapTorch.ref.packages.torch }) }
        }
        torchNote = t('standalone.pytorchSnapshotStackKeptLocal', { version: snapTorch.ref.packages.torch })
      }
      if (torchTarget) {
        try {
          // Pip-applied stacks (adopted installs, index-served entries) have
          // no bundle download pending — charge the pip staging estimate
          // (source-aware: AMD multi-arch stages more), not the bundle size.
          const viaPip = stackAppliesViaPip(torchTarget.source, adopted)
          await preflightDiskSpace(installation, viaPip ? null : torchTarget, signal,
            viaPip ? { pipSource: torchTarget.source } : undefined)
        } catch (err) {
          if (err instanceof DiskSpaceError) return { ok: false, message: err.message }
          throw err
        }
      }
    } else if (snapTorch?.kind === 'observed' && snapTorch.torchVersion) {
      // Older snapshots record torch alone; only full-tuple records can be
      // compared (and restored) as a stack. The partial comparison is
      // tag-aware (2.4.1+cu121 vs 2.4.1+cpu differ) - but when torch itself
      // matches, a partial record proceeds even in exact mode: the snapshot
      // recorded nothing else to verify, and rejecting would make every
      // legacy snapshot unrestorable in the default mode. Any accompanying
      // torchvision/torchaudio drift from the snapshot's freeze is still
      // measured and disclosed after the pip sync below.
      const full = hasFullObservedTuple(snapTorch)
      const tuple = observedTuple(snapTorch)
      const differs = full
        ? !torchTupleMatches(tuple, installedTorch)
        : (!torchBefore || !stackVersionMatches(torchBefore, snapTorch.torchVersion))
      if (differs) {
        // An observed tuple can be re-acquired from the index its local tag
        // names — the snapshot IS the recipe — on any install type: the
        // journaled whole-venv transaction backs up and restores the venv
        // either way. Requires the full-tuple record: restoring torch
        // without its matching torchvision/torchaudio would break the stack.
        if (full && torchTupleReacquirable(tuple)) {
          torchObservedTuple = tuple
          try {
            await preflightDiskSpace(installation, null, signal)
          } catch (err) {
            if (err instanceof DiskSpaceError) return { ok: false, message: err.message }
            throw err
          }
        } else if (mode === 'exact') {
          // Exact mode promises the recorded stack: an unrestorable observed
          // tuple (partial record, or no trusted index serves it) aborts
          // before anything is mutated, same as an unavailable managed stack.
          return { ok: false, message: t('standalone.pytorchSnapshotStackUnavailable', { version: snapTorch.torchVersion }) }
        } else {
          // Not re-acquirable — reported instead of silently skipped.
          torchNote = t('standalone.pytorchSnapshotObservedSkip', { version: snapTorch.torchVersion })
        }
      }
    }

    sendProgress('steps', { steps: [
      { phase: 'restore-comfyui', label: t('standalone.snapshotRestoreComfyUIPhase') },
      { phase: 'restore-nodes', label: t('standalone.snapshotRestoreNodesPhase') },
      { phase: 'restore-pip', label: t('standalone.snapshotRestorePipPhase') },
      ...(torchTarget || torchObservedTuple
        ? [{ phase: 'restore-torch', label: t('standalone.snapshotRestoreTorchPhase') }] : []),
    ] })
    sendProgress('restore-comfyui', { percent: 0, status: 'Loading snapshot…' })

    // Acquire the torch payload before any mutation, so a failed or cancelled
    // download aborts the restore with nothing touched. (pip payloads carry
    // no download — wheels are fetched inside the transaction.)
    const torchProgress = (phase: string, data: Record<string, unknown>): void =>
      sendProgress(
        phase === 'download' || phase === 'extract' || phase === 'torch-swap' ? 'restore-torch' : phase,
        data
      )
    let torchPrepared: PreparedStack | null = null
    if (torchTarget) {
      // Pip-applied stacks prepare a pip payload — nothing downloads here.
      if (!stackAppliesViaPip(torchTarget.source, adopted)) sendOutput('\n── Download PyTorch Bundle ──\n')
      const acquired = await acquireTorchBundle(installation, torchTarget, { sendProgress: torchProgress, sendOutput, update, signal })
      if (acquired.failure) return acquired.failure
      torchPrepared = acquired.prepared
    } else if (torchObservedTuple) {
      torchPrepared = preparePipStack(torchObservedTuple, null)
    }
    const cleanupTorchStaging = async (): Promise<void> => {
      if (torchPrepared?.kind === 'bundle') {
        await fs.promises.rm(torchPrepared.stagingDir, { recursive: true, force: true }).catch(() => {})
      }
    }

    try {
      // Capture HEAD before the git checkout so a failed/cancelled restore can roll
      // the source back, keeping source + packages consistent (all-or-nothing).
      const comfyuiDir = path.join(installation.installPath, 'ComfyUI')
      const preRestoreHead = readGitHead(comfyuiDir)

      // Mark the source-moving window so a hard process kill mid-restore is
      // recovered on the next launch (see recoverInterruptedComfyOp). Cleared once
      // source + packages are consistent below.
      if (preRestoreHead) {
        await writeOpMarker(installation.installPath, { op: 'restore', preHead: preRestoreHead, startedAt: Date.now() })
      }

      // Safety net for failed/cancelled+rolled-back exits below. A staged import
      // is not committed to history on failure, so the previous snapshot is
      // normally already the newest and represents the live state (no-op here).
      // This only writes a fresh current-state snapshot in the genuine edge cases
      // — no previous snapshot at all, or a partial rollback the previous snapshot
      // no longer matches. Best-effort: it must never turn a restore failure into
      // a different failure.
      const ensureLiveStateOnTop = async (): Promise<void> => {
        try {
          const currentInstallation = (await installations.get(installation.id)) || installation
          const { filename } = await snapshots.ensureCurrentSnapshotOnTop(
            installation.installPath, currentInstallation
          )
          if (filename) {
            const snapshotCount = await snapshots.getSnapshotCount(installation.installPath)
            await update({ lastSnapshot: filename, snapshotCount })
          }
        } catch (err) {
          console.warn('Failed to record rolled-back restore state:', err)
        }
      }

      // A cancel is only "clean" if the source is back at the pre-restore commit.
      // A failed rollback leaves a hybrid state (snapshot source + reverted
      // packages) the user could launch straight into, so it surfaces as an error
      // instead of a quietly dismissed cancel. The op marker stays behind either
      // way, so recoverInterruptedComfyOp retries a failed rollback on next launch.
      // rollbackComfySource no-ops (returns true) when HEAD is already at the
      // pre-restore commit, so callers don't need their own moved-HEAD check.
      const revertSourceIfMoved = async (): Promise<boolean> =>
        preRestoreHead ? rollbackComfySource(comfyuiDir, preRestoreHead, sendOutput) : true

      const cancelledResult = async (note?: string): Promise<ActionResult> => {
        const rolledBack = await revertSourceIfMoved()
        await ensureLiveStateOnTop()
        if (rolledBack) {
          sendOutput(`\nCancelled; ComfyUI source was rolled back.${note ? ` ${note}` : ''}\n`)
          return { ok: false, cancelled: true, message: MSG_CANCELLED }
        }
        const message = `Cancelled, but ComfyUI source rollback failed — it will be retried on the next launch.${note ? ` ${note}` : ''}`
        sendOutput(`\n${message}\n`)
        return { ok: false, message }
      }

      sendOutput('\n── Restore ComfyUI Version ──\n')
      const comfyResult = await snapshots.restoreComfyUIVersion(
        installation.installPath, targetSnapshot, sendOutput, signal
      )
      sendProgress('restore-comfyui', { percent: 100, status: comfyResult.changed ? 'Restored' : 'Up to date' })

      // Check cancellation before the error: an abort mid-checkout surfaces as a
      // non-zero git result (comfyResult.error), and cancelledResult rolls the
      // source back if the checkout got far enough to move HEAD.
      if (signal?.aborted) {
        return await cancelledResult()
      }

      // The source checkout itself failed (not cancelled): a failed checkout
      // doesn't move HEAD and nodes/pip were never touched, so just report it.
      if (comfyResult.error) {
        await ensureLiveStateOnTop()
        return { ok: false, message: `ComfyUI restore failed: ${comfyResult.error}` }
      }

      // Restore custom nodes before pip — node installs may add pip dependencies.
      sendOutput('\n── Restore Nodes ──\n')
      const nodeResult = await snapshots.restoreCustomNodes(
        installation.installPath, installation, targetSnapshot, sendProgress, sendOutput, signal,
        settings.getMirrorConfig()
      )

      if (signal?.aborted) {
        return await cancelledResult('Custom node changes may be partial.')
      }

      let pipResult: snapshots.RestoreResult = {
        installed: [], removed: [], changed: [],
        protectedSkipped: [], failed: [], errors: [],
      }
      let pipError: string | null = null
      if (targetSnapshot.skipPipSync) {
        sendOutput('\n── Restore Packages (skipped: snapshot has skipPipSync) ──\n')
        sendProgress('restore-pip', { percent: 100, status: 'Skipped' })
      } else {
        sendOutput('\n── Restore Packages ──\n')
        try {
          pipResult = await snapshots.restorePipPackages(
            installation.installPath, installation, targetSnapshot,
            (phase, data) => sendProgress(phase === 'restore' ? 'restore-pip' : phase, data),
            sendOutput, signal, settings.getMirrorConfig()
          )
        } catch (err) {
          pipError = (err as Error).message
        }
      }

      // Transactional guard: restorePipPackages reverts its own package changes on
      // failure/abort, but never the git checkout done above. If the package phase
      // failed, was cancelled, or threw, roll the source back to the pre-restore
      // commit so we land on the consistent pre-restore state instead of
      // snapshot-source + original-packages.
      if (pipError || pipResult.failed.length > 0 || signal?.aborted) {
        // Leave the op marker so recoverInterruptedComfyOp retries on next launch
        // if the in-process rollback failed; a successful rollback makes it a no-op.
        if (signal?.aborted) {
          return await cancelledResult('Package changes were reverted where possible.')
        }
        const rolledBack = await revertSourceIfMoved()
        const headline = pipError ? `Snapshot package restore failed: ${pipError}` : 'Snapshot package restore failed.'
        const tail = rolledBack
          ? 'ComfyUI source was rolled back to the pre-restore version; package changes were reverted where possible.'
          : 'Package changes were reverted where possible, but ComfyUI source rollback failed.'
        // Surface which packages failed (the full pip output streams to the logs panel)
        // so the error explains WHY instead of a bare "restore failed". Cap the list so
        // a large restore can't produce a wall-of-text dialog.
        const shownErrors = pipResult.errors.slice(0, 20)
        const omittedErrors = pipResult.errors.length - shownErrors.length
        const pkgDetail = shownErrors.length > 0
          ? `\n\n${shownErrors.join('\n')}${omittedErrors > 0 ? `\n…and ${omittedErrors} more. See logs for full output.` : ''}`
          : ''
        await ensureLiveStateOnTop()
        return { ok: false, message: `${headline}${pkgDetail}\n\n${tail}` }
      }

      // Source + packages are consistent — the restore succeeded. Stamp the marker
      // completed and clear it so the next launch doesn't roll a good restore back.
      await completeOpMarker(installation.installPath)

      // Compatible mode: additive repair pass after the exact sync, so its
      // remove-extras step can never leave core or nodes missing dependencies
      // the snapshot's freeze didn't record (e.g. platform-specific transitive
      // deps resolved differently on this machine). Runs before the torch swap
      // so nothing can override the final stack.
      let repairResult: snapshots.RequirementsRepairResult = { changed: [], errors: [] }
      if (mode === 'compatible' && !targetSnapshot.skipPipSync && !signal?.aborted) {
        sendOutput('\n── Repair Requirements ──\n')
        sendProgress('restore-pip', { percent: -1, status: t('standalone.snapshotRepairPhase') })
        try {
          repairResult = await snapshots.repairNodeRequirements(
            installation.installPath, installation, sendOutput, signal, settings.getMirrorConfig()
          )
        } catch (err) {
          // A rejected repair pass (freeze/constraints IO failure) must flow
          // into the normal partial-restore reporting and history
          // reconciliation below, not escape past them.
          repairResult = { changed: [], errors: [`Requirements repair failed: ${(err as Error).message}`] }
        }
        if (repairResult.changed.length > 0) {
          sendOutput(`Requirements repair adjusted ${repairResult.changed.length} package(s)\n`)
        }
        if (signal?.aborted) {
          // Cancelled mid-repair: the exact sync already completed and the op
          // marker is cleared, so nothing rolls back — the live state is
          // post-sync plus whatever repair installs finished. Record it on top
          // and report cancelled; the staged envelope stays for a retry.
          await ensureLiveStateOnTop()
          sendOutput('\nCancelled during requirements repair; completed changes stand.\n')
          return { ok: false, cancelled: true, message: MSG_CANCELLED }
        }
      }

      // Apply the PyTorch stack last so nothing later in the restore can
      // override it. Failure rolls back torch only (the transaction restores the
      // previous venv); the source/node/pip changes above stand and the restore
      // reports partial — global atomicity across all phases is not promised.
      let torchApplied = false
      let torchFailure: string | null = null
      if (torchPrepared) {
        sendOutput('\n── Restore PyTorch ──\n')
        try {
          const torchResult = await applyTorchStackTransaction(installation, torchPrepared, {
            sendProgress: torchProgress, sendOutput, update, signal,
          })
          if (torchResult.ok) torchApplied = true
          else torchFailure = torchResult.message
        } catch (err) {
          // An unexpected rejection (e.g. journal write failure before mutation)
          // must classify as a torch failure, not skip the partial-restore
          // reporting and history reconciliation below.
          torchFailure = (err as Error).message
        }
      }

      // The exact pip sync never mutates protected packages, and the torch
      // transaction only reconciles the stack the snapshot names — so protected
      // packages can still differ from the snapshot's freeze afterwards (e.g. a
      // v1 snapshot recording a different torchvision, which has no stack
      // record to reconcile it). Measure the drift so exact mode can report it
      // and no imported envelope commits a state that was never reached.
      // Measured unconditionally after any pip sync: even with nothing
      // protected-skipped, the unconstrained bulk install can pull a protected
      // package along as a dependency, so "no skips" does not prove no drift.
      let protectedDrift: snapshots.ProtectedDriftEntry[] = []
      let protectedDriftUnknown = false
      if (!targetSnapshot.skipPipSync && !signal?.aborted && !torchFailure) {
        try {
          protectedDrift = await snapshots.protectedPackageDrift(installation, targetSnapshot.pipPackages)
        } catch (err) {
          // Unknown drift must not commit an envelope, but is not a failure.
          protectedDriftUnknown = true
          console.warn('Protected package drift check failed:', err)
        }
      }

      const summary: string[] = []

      if (comfyResult.changed) {
        summary.push(`ComfyUI: checked out ${(comfyResult.commit || targetSnapshot.comfyui.commit || '').slice(0, 7)}`)
      }
      const nodeActions = nodeResult.installed.length + nodeResult.switched.length +
        nodeResult.enabled.length + nodeResult.disabled.length + nodeResult.removed.length
      if (nodeActions > 0) {
        const parts: string[] = []
        if (nodeResult.installed.length > 0) parts.push(`${nodeResult.installed.length} installed`)
        if (nodeResult.switched.length > 0) parts.push(`${nodeResult.switched.length} switched`)
        if (nodeResult.enabled.length > 0) parts.push(`${nodeResult.enabled.length} enabled`)
        if (nodeResult.removed.length > 0) parts.push(`${nodeResult.removed.length} removed`)
        if (nodeResult.disabled.length > 0) parts.push(`${nodeResult.disabled.length} disabled`)
        summary.push(`Nodes: ${parts.join(', ')}`)
      }
      if (nodeResult.failed.length > 0) summary.push(`${nodeResult.failed.length} node(s) failed`)
      if (nodeResult.unreportable.length > 0) summary.push(`${nodeResult.unreportable.length} standalone .py file(s) not restorable`)

      if (pipResult.installed.length > 0 || pipResult.changed.length > 0 || pipResult.removed.length > 0) {
        const parts: string[] = []
        if (pipResult.installed.length > 0) parts.push(`${pipResult.installed.length} installed`)
        if (pipResult.changed.length > 0) parts.push(`${pipResult.changed.length} changed`)
        if (pipResult.removed.length > 0) parts.push(`${pipResult.removed.length} removed`)
        summary.push(`Packages: ${parts.join(', ')}`)
      }
      if (pipResult.protectedSkipped.length > 0) summary.push(`${pipResult.protectedSkipped.length} protected (skipped)`)
      if (pipResult.failed.length > 0) summary.push(`${pipResult.failed.length} package(s) failed`)
      if (repairResult.changed.length > 0) summary.push(`Requirements repair: ${repairResult.changed.length} package(s) adjusted`)
      if (repairResult.errors.length > 0) summary.push(`${repairResult.errors.length} requirements repair warning(s)`)

      if (torchApplied) {
        const torchAfter = torchTarget?.packages.torch ?? torchObservedTuple?.torch
        if (torchAfter) summary.push(`PyTorch: ${torchBefore ?? '?'} → ${torchAfter}`)
      }
      if (torchFailure) summary.push('PyTorch restore failed (previous PyTorch kept)')
      if (torchNote) {
        sendOutput(`\n${torchNote}\n`)
        summary.push(torchNote)
      }

      let protectedDriftNote: string | null = null
      if (protectedDrift.length > 0) {
        protectedDriftNote = t('standalone.snapshotProtectedDrift', { count: protectedDrift.length })
        const detail = protectedDrift
          .map((d) => `  ${d.name}: ${d.live ?? '(absent)'} (snapshot: ${d.target ?? '(absent)'})`)
          .join('\n')
        sendOutput(`\n${protectedDriftNote}\n${detail}\n`)
        summary.push(protectedDriftNote)
      } else if (protectedDriftUnknown) {
        // Unknown drift blocks staged-envelope commits below; in-history and
        // compatible restores must disclose WHY the check produced nothing
        // instead of staying silent.
        protectedDriftNote = t('standalone.snapshotProtectedDriftUnknown')
        sendOutput(`\n${protectedDriftNote}\n`)
        summary.push(protectedDriftNote)
      }

      // comfyResult.error and pip/abort failures already returned above; only
      // best-effort custom-node failures and a rolled-back torch swap can reach
      // here. A skipped/kept-local torch stack can only happen in compatible
      // mode (exact mode aborts before mutating anything) and is a disclosed
      // adaptation, not a failure — but it still disqualifies the envelope
      // from being committed, via `reachedTarget` below.
      // A staged import in exact mode whose protected packages still differ
      // from the snapshot's freeze — or could not be verified — did not
      // provably reach its recorded state. Like a skipped torch stack, that is
      // a failure and the envelope must not be committed (#1137). In-history
      // exact restores and compatible mode disclose the drift instead:
      // protected packages are skipped by design, so failing them would make
      // e.g. v1 snapshots permanently unrestorable.
      const protectedDriftForImport = Boolean(stagedEnvelope && mode === 'exact' &&
        (protectedDrift.length > 0 || protectedDriftUnknown))
      const totalFailures = nodeResult.failed.length + nodeResult.unreportable.length +
        (torchFailure ? 1 : 0) + (protectedDriftForImport ? 1 : 0)

      // Collect specific failures so the error surface explains WHY a restore
      // failed instead of a bare "N operation(s) failed".
      const failureDetails: string[] = []
      for (const f of nodeResult.failed) failureDetails.push(`Node ${f.id}: ${f.error}`)
      for (const id of nodeResult.unreportable) failureDetails.push(`Standalone node ${id}: source file is unavailable`)
      for (const e of pipResult.errors) failureDetails.push(e)
      if (torchFailure) failureDetails.push(`PyTorch: ${torchFailure}`)
      if (protectedDriftForImport) {
        if (protectedDriftUnknown) {
          failureDetails.push(t('standalone.snapshotProtectedDriftUnknown'))
        }
        for (const d of protectedDrift) {
          failureDetails.push(`${d.name}: installed ${d.live ?? '(absent)'}, snapshot records ${d.target ?? '(absent)'}`)
        }
      }
      const failMessage = (headline: string): string =>
        failureDetails.length > 0 ? `${headline}\n\n${failureDetails.join('\n')}` : headline

      const nothingToDo = summary.length === 0
      if (nothingToDo) {
        sendOutput(`\n✓ ${t('standalone.snapshotRestoreNothingToDo')}\n`)
      } else {
        sendOutput(`\n${totalFailures > 0 ? '⚠' : '✓'} ${t('standalone.snapshotRestoreComplete')}: ${summary.join('; ')}\n`)
      }

      // Restore channel + version/lastRollback state so the release cache sees
      // accurate state for the restored channel. (Package-restore failures already
      // returned above after rolling the source back.)
      const restoredHead = comfyResult.commit || readGitHead(comfyuiDir)
      const restoreState = snapshots.buildPostRestoreState(
        targetSnapshot, comfyResult,
        installation.updateInfoByChannel as Record<string, Record<string, unknown>> | undefined,
        installation.comfyVersion as ComfyVersion | undefined
      )
      if (restoredHead) {
        const resolved = await resolveLocalVersion(comfyuiDir, restoredHead)
        restoreState.comfyVersion = resolved
        const tag = formatComfyVersion(resolved, 'short')
        const channelInfo = restoreState.updateInfoByChannel as Record<string, Record<string, unknown>>
        const ch = targetSnapshot.updateChannel || 'stable'
        channelInfo[ch] = { ...channelInfo[ch], installedTag: tag }
      }
      await update(restoreState)

      // Reload the record first: the torch transaction persisted
      // `lastVerifiedTorchStack` through `update`, and classifying the
      // post-restore snapshot from the stale local object would record the
      // freshly applied managed stack as merely observed.
      const freshInst = (await installations.get(installation.id)) || installation

      // An abort landing anywhere after the last explicit check - during the
      // non-cancellable torch swap, the drift measurement, or the record
      // reload above - must neither commit a staged envelope to history nor
      // release it (the retry target stays staged for a retry). Sampled AFTER
      // the last await above so a late abort cannot slip past a stale reading.
      if (signal?.aborted) {
        await ensureLiveStateOnTop()
        sendOutput('\nCancelled; completed changes stand.\n')
        return { ok: false, cancelled: true, message: MSG_CANCELLED }
      }

      // Best-effort node failures don't roll the source back, so the live state
      // is the (partially) restored one - it does NOT match the imported target.
      // Compatible-mode adaptations (kept-local torch, requirements repair
      // drift or repair errors) also mean the target state was not literally
      // reached, so the imported envelope must not be committed even though the
      // restore is reported as successful; the post-restore snapshot records
      // reality.
      const reachedTarget = totalFailures === 0 && !torchNote &&
        repairResult.changed.length === 0 && repairResult.errors.length === 0 &&
        protectedDrift.length === 0 && !protectedDriftUnknown
      const updatedInstallation = {
        ...freshInst,
        ...restoreState,
      }

      let adaptedStateRecorded = false
      if (stagedEnvelope && reachedTarget) {
        try {
          // Commit a staged import to history ONLY once the restore fully
          // succeeded — the install has actually been in this state (#1137).
          await snapshots.importSnapshots(installation.installPath, stagedEnvelope, installation.id)
        } catch (err) {
          console.warn('Committing imported snapshots failed:', err)
          await ensureLiveStateOnTop()
          return { ok: false, message: `Snapshot was restored, but its history could not be saved: ${(err as Error).message}` }
        }

        // Release only after the commit succeeds, so a failed commit keeps the
        // staged file available for retry.
        if (restoreToken) {
          try {
            await snapshots.releaseStagedSnapshotEnvelope(restoreToken)
          } catch (err) {
            console.warn('Releasing staged snapshot failed:', err)
          }
        }
      } else if (stagedEnvelope && restoreToken && totalFailures === 0) {
        // Compatible-mode success with adaptations: the restore is done and the
        // envelope is never committed (the install was never in exactly that
        // state) — the post-restore snapshot of the ACTUAL state is what
        // records this restore. Write it before dropping the staged file, so a
        // failure keeps the target retryable instead of leaving "Latest" stale.
        adaptedStateRecorded = true
        try {
          const { filename } = await snapshots.ensureCurrentSnapshotOnTop(installation.installPath, updatedInstallation)
          const snapshotCount = await snapshots.getSnapshotCount(installation.installPath)
          if (filename) await update({ lastSnapshot: filename, snapshotCount })
        } catch (err) {
          console.warn('Post-restore snapshot failed:', err)
          return { ok: false, message: `Snapshot was restored with adaptations, but the resulting state could not be saved: ${(err as Error).message}` }
        }
        try {
          await snapshots.releaseStagedSnapshotEnvelope(restoreToken)
        } catch (err) {
          console.warn('Releasing staged snapshot failed:', err)
        }
      }

      try {
        if (stagedEnvelope) {
          // Make the newest snapshot reflect the real current state. On success the
          // just-committed target already matches (no-op, stays Latest); otherwise
          // a fresh post-restore snapshot is written strictly on top — including
          // above the future-dated imported entries, since ensureCurrentSnapshotOnTop
          // stamps after the current top. The adapted path above already did this.
          if (!adaptedStateRecorded) {
            const { filename } = await snapshots.ensureCurrentSnapshotOnTop(installation.installPath, updatedInstallation)
            const snapshotCount = await snapshots.getSnapshotCount(installation.installPath)
            if (filename) await update({ lastSnapshot: filename, snapshotCount })
          }
        } else {
          // Restoring an existing in-history snapshot: it carries an older
          // timestamp, so a plain post-restore snapshot lands on top.
          const filename = await snapshots.saveSnapshot(installation.installPath, updatedInstallation, 'post-restore')
          const snapshotCount = await snapshots.getSnapshotCount(installation.installPath)
          await update({ lastSnapshot: filename, snapshotCount })
        }
      } catch (err) {
        console.warn('Post-restore snapshot failed:', err)
      }

      sendProgress('done', {
        percent: 100,
        status: nothingToDo ? t('standalone.snapshotRestoreNothingToDo') : t('standalone.snapshotRestoreComplete')
      })
      // Successful compatible-mode restores disclose their adaptations as a
      // transient notice (ok + navigate:'detail' + message → flashNotice).
      const adaptations: string[] = []
      if (torchNote) adaptations.push(torchNote)
      if (protectedDriftNote && !protectedDriftForImport) adaptations.push(protectedDriftNote)
      if (repairResult.changed.length > 0) adaptations.push(t('standalone.snapshotRepairAdjusted', { count: repairResult.changed.length }))
      if (repairResult.errors.length > 0) adaptations.push(t('standalone.snapshotRepairWarnings', { count: repairResult.errors.length }))
      return { ok: totalFailures === 0, navigate: 'detail',
        ...(totalFailures > 0
          ? { message: failMessage(`${totalFailures} operation(s) failed`) }
          : adaptations.length > 0 ? { message: adaptations.join(' ') } : {}) }
    } finally {
      // Structural guarantee: staging is removed on every exit â€” early
      // returns, unexpected throws, and success (a no-op there: the apply
      // transaction already cleaned its own staging).
      await cleanupTorchStaging()
    }
  }

  // Handler kept for potential future use; the UI button was removed.
  if (actionId === 'snapshot-delete') {
    const file = actionData?.file as string | undefined
    if (!file) return { ok: false, message: t('standalone.snapshotNoFile') }
    await snapshots.deleteSnapshot(installation.installPath, file)
    const remaining = await snapshots.listSnapshots(installation.installPath)
    const snapshotCount = remaining.length
    const lastSnapshot = remaining.length > 0 ? remaining[0]!.filename : null
    await update({ snapshotCount, ...(file === installation.lastSnapshot ? { lastSnapshot } : {}) })
    return { ok: true, navigate: 'detail' }
  }

  if (actionId === 'snapshot-view') {
    const file = actionData?.file as string | undefined
    if (!file) return { ok: false, message: t('standalone.snapshotNoFile') }
    const target = await snapshots.loadSnapshot(installation.installPath, file)
    const diff = await snapshots.diffAgainstCurrent(installation.installPath, installation, target)

    const lines: string[] = []

    if (diff.comfyuiChanged && diff.comfyui) {
      lines.push(`${t('standalone.snapshotDiffComfyUI')}`)
      lines.push(`  ${diff.comfyui.from.formattedVersion} → ${diff.comfyui.to.formattedVersion}`)
      lines.push('')
    }

    if (diff.nodesAdded.length > 0 || diff.nodesRemoved.length > 0 || diff.nodesChanged.length > 0) {
      lines.push(`${t('standalone.snapshotDiffNodes')}`)
      for (const n of diff.nodesAdded) {
        const ver = n.version || (n.commit ? n.commit.slice(0, 7) : '')
        lines.push(`  + ${n.id}${ver ? ` ${ver}` : ''}`)
      }
      for (const n of diff.nodesRemoved) {
        const ver = n.version || (n.commit ? n.commit.slice(0, 7) : '')
        lines.push(`  − ${n.id}${ver ? ` ${ver}` : ''}`)
      }
      for (const n of diff.nodesChanged) {
        const fromVer = n.from.version || (n.from.commit ? n.from.commit.slice(0, 7) : '?')
        const toVer = n.to.version || (n.to.commit ? n.to.commit.slice(0, 7) : '?')
        const enabledChanged = n.from.enabled !== n.to.enabled
        const versionChanged = fromVer !== toVer
        if (enabledChanged && versionChanged) {
          lines.push(`  ~ ${n.id}: ${fromVer} → ${toVer}, ${n.from.enabled ? 'enabled' : 'disabled'} → ${n.to.enabled ? 'enabled' : 'disabled'}`)
        } else if (enabledChanged) {
          lines.push(`  ~ ${n.id}: ${n.from.enabled ? 'enabled' : 'disabled'} → ${n.to.enabled ? 'enabled' : 'disabled'}`)
        } else {
          lines.push(`  ~ ${n.id}: ${fromVer} → ${toVer}`)
        }
      }
      lines.push('')
    }

    const pipTotal = diff.pipsAdded.length + diff.pipsRemoved.length + diff.pipsChanged.length
    if (pipTotal > 0) {
      lines.push(`${t('standalone.snapshotDiffPackages')} (${pipTotal})`)
      for (const p of diff.pipsAdded) lines.push(`  + ${p.name} ${p.version}`)
      for (const p of diff.pipsRemoved) lines.push(`  − ${p.name} ${p.version}`)
      for (const p of diff.pipsChanged) lines.push(`  ~ ${p.name}: ${p.from} → ${p.to}`)
      lines.push('')
    }

    if (lines.length === 0) {
      lines.push(t('standalone.snapshotDiffNoChanges'))
    }

    return { ok: true, message: lines.join('\n') }
  }

  if (actionId === 'change-pytorch') {
    const stackId = actionData?.stackId as string | undefined
    if (!stackId) return { ok: false, message: t('standalone.pytorchNoStack') }

    // Pip-applied changes (adopted installs, index-served stacks) prepare a
    // pip payload instead of downloading a bundle. Judged from the stackId
    // shape here (the entry isn't resolved yet); index ids always pip-apply.
    const viaPip = installation.adopted === true || parseAnyIndexStackId(stackId) !== null
    sendProgress('steps', { steps: [
      { phase: 'torch-prepare', label: t(viaPip ? 'standalone.pytorchPreparePhasePip' : 'standalone.pytorchPreparePhase') },
      { phase: 'torch-swap', label: t('standalone.pytorchSwapPhase') },
    ] })

    // Trust boundary: the renderer's stackId is only a hint — re-resolve it
    // against a fresh R2 fetch for THIS installation (variant + Python ABI).
    sendProgress('torch-prepare', { percent: -1, status: t('standalone.pytorchResolving') })
    let entry
    try {
      entry = await resolveTorchStack(installation, stackId)
    } catch (err) {
      return { ok: false, message: t('standalone.pytorchCatalogError', { message: (err as Error).message }) }
    }
    if (!entry) return { ok: false, message: t('standalone.pytorchStackUnavailable') }

    const currentTuple = getInstalledTorchTuple(installation)
    if (currentTuple.torch && torchTupleMatches(entry.packages, currentTuple)) {
      return { ok: true, navigate: 'detail', message: t('standalone.pytorchAlreadyInstalled', { version: currentTuple.torch }) }
    }

    // Hard gate before anything is downloaded or touched. Pip-applied
    // changes have no bundle download pending — charge the pip staging
    // estimate (source-aware: AMD multi-arch stages more). Judged from the
    // resolved entry's source (authoritative).
    try {
      const entryViaPip = stackAppliesViaPip(entry.source, installation.adopted === true)
      await preflightDiskSpace(installation, entryViaPip ? null : entry, signal,
        entryViaPip ? { pipSource: entry.source } : undefined)
    } catch (err) {
      if (err instanceof DiskSpaceError) return { ok: false, message: err.message }
      throw err
    }

    // Drop the shared shell + pop-outs: a live shell holds a handle on the
    // install dir and any running python locks venv DLLs, which would break
    // the venv rename at the heart of the transaction.
    releaseInstallTerminalForFsOp(installation.id)

    // Safety net the user can roll back to from the Snapshots tab.
    try {
      const filename = await snapshots.saveSnapshot(installation.installPath, installation, 'pre-update')
      const snapshotCount = await snapshots.getSnapshotCount(installation.installPath)
      await update({ lastSnapshot: filename, snapshotCount })
    } catch (err) {
      sendOutput(`Pre-change snapshot failed: ${(err as Error).message}\n`)
    }

    // Acquire the bundle into staging (no venv contact), then re-check disk —
    // the download itself consumed space between preflight and the venv copy.
    // The installer helpers emit 'download'/'extract' phases; fold them into
    // the declared 'torch-prepare' step so the stepper tracks them.
    const prepareProgress = (phase: string, data: Record<string, unknown>): void =>
      sendProgress(phase === 'download' || phase === 'extract' ? 'torch-prepare' : phase, data)
    const acquired = await acquireTorchBundle(installation, entry, { sendProgress: prepareProgress, sendOutput, update, signal })
    if (acquired.failure) return acquired.failure

    const result = await applyTorchStackTransaction(installation, acquired.prepared, { sendProgress, sendOutput, update, signal })
    if (!result.ok) return { ok: false, message: result.message }

    try {
      const freshInst = (await installations.get(installation.id)) || installation
      const filename = await snapshots.saveSnapshot(installation.installPath, freshInst, 'post-update')
      const snapshotCount = await snapshots.getSnapshotCount(installation.installPath)
      await update({ lastSnapshot: filename, snapshotCount })
    } catch (err) {
      console.warn('Post-change snapshot failed:', err)
    }

    sendProgress('done', { percent: 100, status: result.message })
    return { ok: true, navigate: 'detail' }
  }

  if (actionId === 'switch-channel') {
    const targetChannel = actionData?.channel as string | undefined
    if (!targetChannel) return { ok: false, message: 'No channel specified.' }
    await update({ updateChannel: targetChannel })
    return { ok: true, navigate: 'detail' }
  }

  if (actionId === 'check-update') {
    const channel = getEffectiveChannel(installation)
    const otherChannels = ['stable', 'latest'].filter((ch) => ch !== channel)
    await Promise.allSettled([
      ...otherChannels.map((ch) =>
        releaseCache.getOrFetch(COMFYUI_REPO, ch, async () => {
          const release = await fetchLatestRelease(ch)
          if (!release) return null
          return releaseCache.buildCacheEntry(release)
        }, true)
      ),
      // Refresh the switchable-PyTorch-stack catalog alongside the release
      // check so the PyTorch picker on the Update tab has current options.
      refreshTorchStackCatalog(installation),
    ])
    const result = await releaseCache.checkForUpdate(COMFYUI_REPO, channel, installation, update)
    // Enrich the "+ N commits" label in the background (it can run a slow
    // `git fetch --unshallow`); the card refreshes in place when it lands.
    void releaseCache.enrichCommitsAhead(COMFYUI_REPO, path.join(installation.installPath, 'ComfyUI')).catch(() => {})
    // A manual check that finds nothing should say so, else it reads as a no-op.
    // The tab-open auto-refresh passes `silent` to suppress this.
    if (result.ok && actionData?.silent !== true) {
      const info = releaseCache.getEffectiveInfo(COMFYUI_REPO, channel, installation)
      if (!releaseCache.isUpdateAvailable(installation, channel, info)) {
        return { ...result, message: t('standalone.upToDateMessage') }
      }
    }
    return result
  }

  if (actionId === 'update-comfyui') {
    return handleUpdateComfyUI(installation, actionData, { update, sendProgress, sendOutput, signal })
  }

  if (actionId === 'migrate-from') {
    return handleMigrateFrom(installation, actionData, { update, sendProgress, sendOutput, signal })
  }

  return { ok: false, message: `Action "${actionId}" not yet implemented.` }
}

async function handleUpdateComfyUI(
  installation: InstallationRecord,
  actionData: Record<string, unknown> | undefined,
  { update, sendProgress, sendOutput, signal }: ActionTools
): Promise<ActionResult> {
  const installPath = installation.installPath
  const comfyuiDir = path.join(installPath, 'ComfyUI')
  const gitDir = path.join(comfyuiDir, '.git')

  if (!fs.existsSync(gitDir)) {
    return { ok: false, message: t('standalone.updateNoGit') }
  }

  // Drop the shared shell + pop-outs before touching git / the venv: a live
  // shell's cwd and any running python lock files the update would rewrite
  // (Windows can't replace open files), so `uv pip` upgrades would fail.
  releaseInstallTerminalForFsOp(installation.id)

  // Adopted installs route through `adoptedPythonPath`; only managed installs
  // need the standalone-env Python, so check existence per-case.
  if (installation.adopted !== true) {
    const masterPython = getMasterPythonPath(installPath)
    if (!fs.existsSync(masterPython)) {
      return { ok: false, message: 'Master Python not found.' }
    }
  } else {
    const adoptedPython = installation.adoptedPythonPath as string | undefined
    if (!adoptedPython || !fs.existsSync(adoptedPython)) {
      return {
        ok: false,
        message: 'Adopted Python not found at the recorded path. Re-run "Migrate to Standalone" to reconcile, or use "Copy & Update" to rebuild as a managed standalone.',
      }
    }
  }

  const targetChannel = (actionData?.channel as string | undefined) ?? (installation.updateChannel as string | undefined) ?? 'stable'
  if (targetChannel !== (installation.updateChannel as string | undefined)) {
    await update({ updateChannel: targetChannel })
  }
  const channel = targetChannel as 'stable' | 'latest'

  // The IPP version picker carries a strict `vMAJOR.MINOR.PATCH` ref so the
  // user can upgrade or downgrade to a specific historical release. Bad
  // shapes (rc / alpha / blank) are dropped here as a defence-in-depth: the
  // python script also gates this, but a malformed value should never even
  // reach the spawn.
  const rawTargetTag = typeof actionData?.targetTag === 'string' ? actionData.targetTag : undefined
  const targetTag = rawTargetTag && /^v\d+\.\d+\.\d+$/.test(rawTargetTag) ? rawTargetTag : undefined

  sendProgress('steps', { steps: [
    { phase: 'prepare', label: t('standalone.updatePrepare') },
    { phase: 'run', label: t('standalone.updateRun') },
    { phase: 'deps', label: t('standalone.updateDeps') },
  ] })

  sendProgress('prepare', { percent: -1, status: t('standalone.updatePrepareSnapshot') })
  sendProgress('run', { percent: -1, status: t('standalone.updateFetching') })

  const result = await runComfyUIUpdate({
    installPath,
    installation,
    channel,
    ...(targetTag ? { targetTag } : {}),
    update,
    sendProgress,
    sendOutput,
    signal,
    dryRunConflictCheck: true,
    saveRollback: true,
    preUpdateSnapshot: true,
  })

  if (!result.ok) {
    return { ok: false, message: result.message }
  }

  // Reconcile installedTag against the new comfyVersion so the "up to date"
  // badge is correct immediately without a renderer-triggered check-update.
  try {
    const freshInst = result.installation as unknown as Record<string, unknown>
    await releaseCache.checkForUpdate(COMFYUI_REPO, channel, freshInst, async (data) => {
      await update(data)
    })
  } catch {
    // best-effort — UI corrects itself on the next check-update
  }

  sendProgress('done', { percent: 100, status: 'Complete' })
  return { ok: true, navigate: 'detail' }
}

async function handleMigrateFrom(
  installation: InstallationRecord,
  actionData: Record<string, unknown> | undefined,
  { sendProgress, sendOutput }: ActionTools
): Promise<ActionResult> {
  const sourceId = actionData?.sourceInstallationId as string | undefined
  if (!sourceId) return { ok: false, message: 'No source installation specified.' }

  const wantNodes = actionData?.customNodes === true
  const wantAllUserData = actionData?.allUserData === true
  const wantWorkflows = !wantAllUserData && actionData?.workflows === true
  const wantSettings = !wantAllUserData && actionData?.userSettings === true
  const wantModels = actionData?.models === true
  const wantInput = actionData?.input === true
  const wantOutput = actionData?.output === true

  const srcInst = await installations.get(sourceId)
  if (!srcInst) return { ok: false, message: 'Source installation not found.' }

  const srcComfyUI = findComfyUIDir(srcInst.installPath)
  const dstComfyUI = path.join(installation.installPath, 'ComfyUI')

  if (!srcComfyUI) {
    return { ok: false, message: t('migrate.noComfyUIDir') }
  }

  const useSharedModels = (installation.useSharedModels as boolean | undefined) !== false
  const useSharedInputOutput = (installation.useSharedInputOutput as boolean | undefined) !== false
  const perInstallInput = installation.inputDir as string | undefined
  const perInstallOutput = installation.outputDir as string | undefined

  const srcModels = path.join(srcComfyUI, 'models')
  const dstModels = useSharedModels
    ? ((settings.get('modelsDirs') as string[] | undefined) || settings.defaults.modelsDirs)[0]!
    : path.join(dstComfyUI, 'models')
  const srcInput = path.join(srcComfyUI, 'input')
  const dstInput = useSharedInputOutput
    ? ((settings.get('inputDir') as string | undefined) || settings.defaults.inputDir)
    : perInstallInput || path.join(dstComfyUI, 'input')
  const srcOutput = path.join(srcComfyUI, 'output')
  const dstOutput = useSharedInputOutput
    ? ((settings.get('outputDir') as string | undefined) || settings.defaults.outputDir)
    : perInstallOutput || path.join(dstComfyUI, 'output')

  const srcCustomNodes = path.join(srcComfyUI, 'custom_nodes')
  const dstCustomNodes = path.join(dstComfyUI, 'custom_nodes')
  const srcWorkflows = path.join(srcComfyUI, 'user', 'default', 'workflows')
  const dstWorkflows = path.join(dstComfyUI, 'user', 'default', 'workflows')
  const srcUserDir = path.join(srcComfyUI, 'user')

  const steps: Array<{ phase: string; label: string }> = [{ phase: 'migrate', label: t('migrate.filePhase') }]
  if (wantNodes) steps.push({ phase: 'deps', label: t('migrate.depsPhase') })
  sendProgress('steps', { steps })

  sendProgress('migrate', { percent: 0, status: t('migrate.scanning') })

  const srcNodes = wantNodes ? listCustomNodes(srcCustomNodes) : []
  const hasAllUserData = wantAllUserData && fs.existsSync(srcUserDir)
  const hasWorkflows = wantWorkflows && fs.existsSync(srcWorkflows)
  const hasModels = wantModels && fs.existsSync(srcModels)
  const hasInput = wantInput && fs.existsSync(srcInput)
  const hasOutput = wantOutput && fs.existsSync(srcOutput)

  const settingsFiles: Array<{ profile: string; src: string; dst: string }> = []
  if (wantSettings && fs.existsSync(srcUserDir)) {
    try {
      for (const d of fs.readdirSync(srcUserDir, { withFileTypes: true })) {
        if (d.isDirectory() && !d.name.startsWith('_')) {
          const src = path.join(srcUserDir, d.name, 'comfy.settings.json')
          if (fs.existsSync(src)) {
            settingsFiles.push({ profile: d.name, src, dst: path.join(dstComfyUI, 'user', d.name, 'comfy.settings.json') })
          }
        }
      }
    } catch {}
  }

  const total = srcNodes.length + (hasAllUserData ? 1 : 0) + (hasWorkflows ? 1 : 0) + (settingsFiles.length > 0 ? 1 : 0) + (hasModels ? 1 : 0) + (hasInput ? 1 : 0) + (hasOutput ? 1 : 0)

  if (total === 0) {
    sendProgress('migrate', { percent: 100, status: t('migrate.nothingToMigrate') })
    if (wantNodes) sendProgress('deps', { percent: 100, status: t('migrate.noDeps') })
    sendProgress('done', { percent: 100, status: 'Complete' })
    return { ok: true, navigate: 'detail' }
  }

  let migrated = 0
  const migratedNodes: Array<{ name: string; dir: string; hasRequirements: boolean }> = []
  const backedUp: string[] = []
  const summary: string[] = []

  if (srcNodes.length > 0) {
    fs.mkdirSync(dstCustomNodes, { recursive: true })
    for (const node of srcNodes) {
      const dstNodeDir = path.join(dstCustomNodes, node.name)
      if (fs.existsSync(dstNodeDir)) {
        const bak = backupDir(dstNodeDir)
        if (bak) backedUp.push(node.name)
      }
      await copyDirWithProgress(node.dir, dstNodeDir, (copied, fileTotal) => {
        const sub = fileTotal > 0 ? copied / fileTotal : 1
        const percent = Math.round(((migrated + sub) / total) * 100)
        sendProgress('migrate', { percent, status: t('migrate.copyingNode', { name: node.name, current: migrated + 1, total }) })
      })
      migratedNodes.push(node)
      migrated++
    }
    summary.push(t('migrate.summaryNodes', { count: migratedNodes.length }))
    if (backedUp.length > 0) summary.push(t('migrate.summaryBackedUp', { count: backedUp.length }))
  }

  if (hasAllUserData) {
    sendProgress('migrate', { percent: Math.round((migrated / total) * 100), status: t('migrate.mergingUserData') })
    const dstUserDir = path.join(dstComfyUI, 'user')
    const result = await mergeDirFlat(srcUserDir, dstUserDir, (copied, skipped, fileTotal) => {
      const sub = fileTotal > 0 ? (copied + skipped) / fileTotal : 1
      const percent = Math.round(((migrated + sub) / total) * 100)
      sendProgress('migrate', { percent, status: t('migrate.mergingUserData') })
    })
    migrated++
    summary.push(t('migrate.summaryUserData', { copied: result.copied, skipped: result.skipped }))
  }

  if (hasWorkflows) {
    sendProgress('migrate', { percent: Math.round((migrated / total) * 100), status: t('migrate.mergingWorkflows') })
    const result = await mergeDirFlat(srcWorkflows, dstWorkflows, (copied, skipped, fileTotal) => {
      const sub = fileTotal > 0 ? (copied + skipped) / fileTotal : 1
      const percent = Math.round(((migrated + sub) / total) * 100)
      sendProgress('migrate', { percent, status: t('migrate.mergingWorkflows') })
    })
    migrated++
    summary.push(t('migrate.summaryWorkflows', { copied: result.copied, skipped: result.skipped }))
  }

  if (settingsFiles.length > 0) {
    sendProgress('migrate', { percent: Math.round((migrated / total) * 100), status: t('migrate.copyingSettings') })
    let copied = 0
    for (const sf of settingsFiles) {
      await fs.promises.mkdir(path.dirname(sf.dst), { recursive: true })
      await fs.promises.copyFile(sf.src, sf.dst)
      copied++
    }
    migrated++
    summary.push(t('migrate.summarySettings', { count: copied }))
  }

  if (hasModels) {
    sendProgress('migrate', { percent: Math.round((migrated / total) * 100), status: t('migrate.mergingModels') })
    const result = await mergeDirFlat(srcModels, dstModels, (copied, skipped, fileTotal) => {
      const sub = fileTotal > 0 ? (copied + skipped) / fileTotal : 1
      const percent = Math.round(((migrated + sub) / total) * 100)
      sendProgress('migrate', { percent, status: t('migrate.mergingModels') })
    })
    migrated++
    summary.push(t('migrate.summaryModels', { copied: result.copied, skipped: result.skipped }))
  }

  if (hasInput) {
    sendProgress('migrate', { percent: Math.round((migrated / total) * 100), status: t('migrate.mergingInput') })
    const result = await mergeDirFlat(srcInput, dstInput, (copied, skipped, fileTotal) => {
      const sub = fileTotal > 0 ? (copied + skipped) / fileTotal : 1
      const percent = Math.round(((migrated + sub) / total) * 100)
      sendProgress('migrate', { percent, status: t('migrate.mergingInput') })
    })
    migrated++
    summary.push(t('migrate.summaryInput', { copied: result.copied, skipped: result.skipped }))
  }

  if (hasOutput) {
    sendProgress('migrate', { percent: Math.round((migrated / total) * 100), status: t('migrate.mergingOutput') })
    const result = await mergeDirFlat(srcOutput, dstOutput, (copied, skipped, fileTotal) => {
      const sub = fileTotal > 0 ? (copied + skipped) / fileTotal : 1
      const percent = Math.round(((migrated + sub) / total) * 100)
      sendProgress('migrate', { percent, status: t('migrate.mergingOutput') })
    })
    migrated++
    summary.push(t('migrate.summaryOutput', { copied: result.copied, skipped: result.skipped }))
  }

  sendProgress('migrate', { percent: 100, status: t('common.done') })

  if (wantNodes) {
    sendProgress('deps', { percent: 0, status: t('migrate.checkingDeps') })

    const nodesWithReqs = migratedNodes.filter((n) => n.hasRequirements)
    if (nodesWithReqs.length === 0) {
      sendProgress('deps', { percent: 100, status: t('migrate.noDeps') })
    } else {
      const uvPath = getActiveUvPath(installation)
      const activePython = getActivePythonPath(installation)

      if (!fs.existsSync(uvPath) || !activePython) {
        sendOutput(t('migrate.noUvOrPython') + '\n')
        sendProgress('deps', { percent: 100, status: t('migrate.depsSkipped') })
      } else {
        const migrateMirror = settings.get('pypiMirror')
        let depsInstalled = 0

        for (const node of nodesWithReqs) {
          const nodReqPath = path.join(dstCustomNodes, node.name, 'requirements.txt')
          sendProgress('deps', {
            percent: Math.round((depsInstalled / nodesWithReqs.length) * 100),
            status: t('migrate.installingNodeDeps', { name: node.name }),
          })

          try {
            const procResult = await installFilteredRequirementsDetailed(nodReqPath, uvPath, activePython, installation.installPath, `.migrate-reqs-${node.name}.txt`, sendOutput, undefined, { pypiMirror: migrateMirror, useChineseMirrors: settings.get('useChineseMirrors') === true })
            if (procResult.code !== 0) {
              sendOutput(`\n${withOutputTail(`⚠ ${node.name}: dependency install exited with code ${procResult.code}`, procResult.output)}\n`)
            }
          } catch (err) {
            sendOutput(`⚠ ${node.name}: ${(err as Error).message}\n`)
          }

          depsInstalled++
        }

        sendProgress('deps', { percent: 100, status: t('migrate.depsComplete') })
        summary.push(t('migrate.summaryDeps', { count: nodesWithReqs.length }))
      }
    }
  }

  // Install manager_requirements.txt from the destination ComfyUI if present.
  {
    const dstComfyUIDir = path.join(installation.installPath, 'ComfyUI')
    const mgrReqPath = path.join(dstComfyUIDir, 'manager_requirements.txt')
    if (fs.existsSync(mgrReqPath)) {
      const uvPath = getActiveUvPath(installation)
      const activePython = getActivePythonPath(installation)

      if (fs.existsSync(uvPath) && activePython) {
        sendOutput('\nInstalling manager requirements…\n')
        const procResult = await installFilteredRequirementsDetailed(mgrReqPath, uvPath, activePython, installation.installPath, '.migrate-mgr-reqs.txt', sendOutput, undefined, settings.getMirrorConfig())
        if (procResult.code !== 0) {
          sendOutput(`\n${withOutputTail(`⚠ manager requirements install exited with code ${procResult.code}`, procResult.output)}\n`)
        }
      }
    }
  }

  sendProgress('done', { percent: 100, status: 'Complete' })
  sendOutput(`\n✓ ${t('migrate.complete')}: ${summary.join(', ')}\n`)

  return { ok: true, navigate: 'detail' }
}
