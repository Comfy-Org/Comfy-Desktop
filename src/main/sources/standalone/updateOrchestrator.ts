import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { killProcTree } from '../../lib/process'
import {
  resolveLocalVersion,
  clearVersionCache,
  type LatestTagOverride
} from '../../lib/version-resolve'
import {
  readGitHead,
  rollbackComfySource,
  fetchTags,
  findLatestVersionTag,
  revParseRef
} from '../../lib/git'
import {
  PYTORCH_RE,
  installFilteredRequirementsDetailed,
  runUvPipDetailed,
  getPipIndexArgs
} from '../../lib/pip'
import { withOutputTail } from '../../lib/logged-process'
import { formatComfyVersion } from '../../lib/version'
import type { ComfyVersion } from '../../lib/version'
import { t } from '../../lib/i18n'
import { getBundledScriptPath } from '../../lib/bundledScript'
import * as settings from '../../settings'
import * as snapshots from '../../lib/snapshots'
import { repairMacBinaries } from './macRepair'
import { getActivePythonPath, getActiveUvPath, getMasterPythonPath } from './envPaths'
import {
  writeOpMarker,
  completeOpMarker,
  readOpMarker,
  clearOpMarker,
  rollbackStatusMessage
} from '../../lib/opMarker'
import type { InstallationRecord } from '../../installations'

interface ScriptResult {
  exitCode: number
  exitSignal: string | null
  markers: Record<string, string>
  stdoutBuf: string
  stderrBuf: string
}

export interface UpdateOrchestrationOptions {
  installPath: string
  installation: InstallationRecord
  channel: 'stable' | 'latest'
  update: (data: Record<string, unknown>) => Promise<void>
  sendProgress: (step: string, data: Record<string, unknown>) => void
  sendOutput?: (text: string) => void
  signal?: AbortSignal
  dryRunConflictCheck?: boolean
  saveRollback?: boolean
  preUpdateSnapshot?: boolean
  forceDepsSync?: boolean
  targetTag?: string
}

export interface UpdateOrchestrationResult {
  ok: boolean
  message?: string
  navigate?: string
  comfyVersion?: ComfyVersion
  installation: InstallationRecord
}

export function spawnCommand(
  command: string,
  args: string[],
  cwd: string,
  onStdout: ((text: string) => void) | undefined,
  onStderr: ((text: string) => void) | undefined,
  signal?: AbortSignal
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (signal?.aborted) return Promise.resolve({ code: 1, stdout: '', stderr: '' })
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const onAbort = (): void => {
      killProcTree(proc)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      stdout += text
      onStdout?.(text)
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      stderr += text
      onStderr?.(text)
    })
    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      onStderr?.(`Error: ${err.message}\n`)
      resolve({ code: 1, stdout, stderr })
    })
    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

function spawnUpdateScript(
  masterPython: string,
  comfyuiDir: string,
  channelArgs: string[],
  sendOutput: ((text: string) => void) | undefined,
  signal?: AbortSignal
): Promise<ScriptResult> {
  const updateScript = getBundledScriptPath('update_comfyui.py')
  const markers: Record<string, string> = {}
  let markerBuf = ''
  let stdoutBuf = ''
  let stderrBuf = ''
  let exitSignal: string | null = null

  const exitCode = new Promise<number>((resolve) => {
    const proc = spawn(masterPython, ['-s', updateScript, comfyuiDir, ...channelArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    if (signal) {
      const onAbort = (): void => {
        proc.kill()
      }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
      proc.on('close', () => signal.removeEventListener('abort', onAbort))
    }
    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      stdoutBuf += text
      markerBuf += text
      const lines = markerBuf.split(/\r?\n/)
      markerBuf = lines.pop()!
      for (const line of lines) {
        const match = line.match(/^\[(\w+)\]\s*(.+)$/)
        if (match) markers[match[1]!] = match[2]!.trim()
      }
      sendOutput?.(text)
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      stderrBuf += text
      sendOutput?.(text)
    })
    proc.on('error', (err) => {
      sendOutput?.(`Error: ${err.message}\n`)
      resolve(1)
    })
    proc.on('close', (code, sig) => {
      exitSignal = sig
      resolve(code ?? 1)
    })
  })

  return exitCode.then((code) => {
    if (markerBuf) {
      const match = markerBuf.match(/^\[(\w+)\]\s*(.+)$/)
      if (match) markers[match[1]!] = match[2]!.trim()
    }
    return { exitCode: code, exitSignal, markers, stdoutBuf, stderrBuf }
  })
}

export async function runComfyUIUpdate(
  opts: UpdateOrchestrationOptions
): Promise<UpdateOrchestrationResult> {
  const {
    installPath,
    channel,
    update,
    sendProgress,
    signal,
    dryRunConflictCheck = false,
    saveRollback = false,
    preUpdateSnapshot = false
  } = opts
  let { installation } = opts
  const sendOutput = opts.sendOutput
  const comfyuiDir = path.join(installPath, 'ComfyUI')
  const updaterPython =
    installation.adopted === true
      ? (installation.adoptedPythonPath as string)
      : getMasterPythonPath(installPath)
  const channelArgs = opts.targetTag
    ? ['--tag', opts.targetTag]
    : channel === 'stable'
      ? ['--stable']
      : []

  const reqPath = path.join(comfyuiDir, 'requirements.txt')
  let preReqs = ''
  try {
    preReqs = await fs.promises.readFile(reqPath, 'utf-8')
  } catch {}

  const mgrReqPath = path.join(comfyuiDir, 'manager_requirements.txt')
  let preMgrReqs = ''
  try {
    preMgrReqs = await fs.promises.readFile(mgrReqPath, 'utf-8')
  } catch {}

  let preUpdateFilename: string | undefined
  if (preUpdateSnapshot) {
    try {
      preUpdateFilename = await snapshots.saveSnapshot(installPath, installation, 'pre-update')
      const snapshotCount = await snapshots.getSnapshotCount(installPath)
      await update({ lastSnapshot: preUpdateFilename, snapshotCount })
    } catch (err) {
      console.warn('Pre-update snapshot failed:', err)
    }
  }

  const preOpHead = readGitHead(comfyuiDir)
  const pending = readOpMarker(installPath)
  const repairing = pending?.op === 'update' && !pending.postHead
  if (preOpHead && !repairing) {
    await writeOpMarker(installPath, { op: 'update', preHead: preOpHead, startedAt: Date.now() })
  }

  let result = await spawnUpdateScript(updaterPython, comfyuiDir, channelArgs, sendOutput, signal)

  if (result.exitCode !== 0 && result.exitSignal === 'SIGKILL' && process.platform === 'darwin') {
    if (sendOutput) {
      sendOutput('\nProcess was killed by macOS — attempting binary repair…\n')
    } else {
      console.warn('macOS killed update process — attempting binary repair and retry')
    }
    await repairMacBinaries(installPath, sendProgress, sendOutput, installation)
    if (sendOutput) {
      sendOutput('Repair complete — retrying update…\n\n')
    }
    result = await spawnUpdateScript(updaterPython, comfyuiDir, channelArgs, sendOutput, signal)
  }

  if (result.markers.BACKUP_BRANCH && preOpHead && !repairing) {
    const existingMarker = readOpMarker(installPath)
    if (existingMarker && !existingMarker.postHead) {
      await writeOpMarker(installPath, {
        ...existingMarker,
        backupBranch: result.markers.BACKUP_BRANCH
      })
    }
  }

  const wroteNothing = !result.markers.WRITING_TARGET && readGitHead(comfyuiDir) === preOpHead
  if (result.exitCode !== 0 && wroteNothing && !repairing) await clearOpMarker(installPath)

  let rollbackNote = ''
  if (
    (signal?.aborted || result.exitCode !== 0) &&
    preOpHead &&
    readGitHead(comfyuiDir) !== preOpHead
  ) {
    const rolledBack = await rollbackComfySource(comfyuiDir, preOpHead, sendOutput)
    rollbackNote = `\n\n${rollbackStatusMessage(rolledBack, preOpHead, result.markers.BACKUP_BRANCH)}`
  }

  if (signal?.aborted) return { ok: false, message: `Cancelled${rollbackNote}`, installation }

  if (result.exitCode !== 0) {
    const detail = [result.stderrBuf, result.stdoutBuf]
      .filter(Boolean)
      .join('\n')
      .trim()
      .split('\n')
      .slice(-20)
      .join('\n')
    if (sendOutput) {
      let message: string
      if (detail) {
        message = `${t('standalone.updateFailed', { code: result.exitCode })}\n\n${detail}`
      } else if (result.exitSignal) {
        message = `${t('standalone.updateFailed', { code: result.exitCode })}\n\nProcess was killed by signal ${result.exitSignal}.\npython: ${updaterPython}\nscript: ${getBundledScriptPath('update_comfyui.py')}`
      } else {
        message = `${t('standalone.updateFailed', { code: result.exitCode })}\n\nProcess produced no output.\npython: ${updaterPython}\nscript: ${getBundledScriptPath('update_comfyui.py')}`
      }
      return { ok: false, message: message + rollbackNote, installation }
    }
    console.warn(
      `Auto-update script failed (exit ${result.exitCode}):\n${detail.split('\n').slice(-10).join('\n')}${rollbackNote}`
    )
    return { ok: false, installation }
  }

  const { markers } = result

  let postReqs = ''
  try {
    postReqs = await fs.promises.readFile(reqPath, 'utf-8')
  } catch {}

  const headMoved = !!(
    markers.PRE_UPDATE_HEAD &&
    markers.POST_UPDATE_HEAD &&
    markers.PRE_UPDATE_HEAD !== markers.POST_UPDATE_HEAD
  )
  const reqsChanged = preReqs !== postReqs
  const forceDeps = repairing || !!opts.forceDepsSync
  const shouldSyncDeps = (reqsChanged || headMoved || forceDeps) && postReqs.length > 0

  let depFailure: string | null = null

  if (shouldSyncDeps) {
    const uvPath = getActiveUvPath(installation)
    const activeEnvPython = getActivePythonPath(installation)

    if (!fs.existsSync(uvPath) || !activeEnvPython) {
      depFailure = 'Python environment or uv not found while installing updated dependencies'
    } else if (!signal?.aborted) {
      if (dryRunConflictCheck) {
        const filteredReqs = postReqs
          .split('\n')
          .filter((l) => !PYTORCH_RE.test(l.trim()))
          .join('\n')
        const filteredReqPath = path.join(installPath, '.comfyui-reqs-filtered.txt')
        await fs.promises.writeFile(filteredReqPath, filteredReqs, 'utf-8')

        try {
          const indexArgs = getPipIndexArgs(
            settings.get('pypiMirror'),
            settings.get('useChineseMirrors') === true
          )
          sendProgress('deps', { percent: -1, status: t('standalone.updateDepsDryRun') })

          if (!signal?.aborted) {
            const dryRunResult = await spawnCommand(
              uvPath,
              [
                'pip',
                'install',
                '--dry-run',
                '-r',
                filteredReqPath,
                '--python',
                activeEnvPython,
                ...indexArgs
              ],
              installPath,
              undefined,
              undefined,
              signal
            )

            if (dryRunResult.code !== 0) {
              sendOutput?.(
                `\n⚠ Requirements dry-run detected potential conflicts:\n${dryRunResult.stderr || dryRunResult.stdout}\n`
              )
              sendOutput?.(
                'Proceeding with install attempt — some conflicts may be benign.\nTip: Use "Copy & Update" for a risk-free update that leaves this installation untouched.\n'
              )
            } else if (dryRunResult.stderr) {
              sendOutput?.(dryRunResult.stderr)
            }
          }

          if (!signal?.aborted) {
            sendProgress('deps', { percent: -1, status: t('standalone.updateDepsInstalling') })
            const pipResult = await runUvPipDetailed(
              uvPath,
              ['pip', 'install', '-r', filteredReqPath, '--python', activeEnvPython, ...indexArgs],
              installPath,
              sendOutput ?? (() => {}),
              signal
            )
            if (pipResult.code !== 0) {
              depFailure = withOutputTail(
                `requirements install exited with code ${pipResult.code}`,
                pipResult.output
              )
            }
          }
        } catch (err) {
          depFailure = `requirements install failed: ${(err as Error).message}`
        } finally {
          try {
            await fs.promises.unlink(filteredReqPath)
          } catch {}
        }
      } else {
        sendProgress('update', { percent: -1, status: 'Installing updated dependencies' })
        const logFn = sendOutput ?? console.log
        try {
          const installResult = await installFilteredRequirementsDetailed(
            reqPath,
            uvPath,
            activeEnvPython,
            installPath,
            '.post-install-reqs.txt',
            logFn,
            signal,
            settings.getMirrorConfig()
          )
          if (installResult.code !== 0) {
            depFailure = withOutputTail(
              `requirements install exited with code ${installResult.code}`,
              installResult.output
            )
          }
        } catch (err) {
          depFailure = `requirements install failed: ${(err as Error).message}`
        }
      }
    }
  } else if (dryRunConflictCheck) {
    sendProgress('deps', { percent: -1, status: t('standalone.updateDepsUpToDate') })
  }

  let postMgrReqs = ''
  try {
    postMgrReqs = await fs.promises.readFile(mgrReqPath, 'utf-8')
  } catch {}

  const mgrReqsChanged = preMgrReqs !== postMgrReqs || repairing
  if (!depFailure && !signal?.aborted && mgrReqsChanged && postMgrReqs.length > 0) {
    const uvPath = getActiveUvPath(installation)
    const activeEnvPython = getActivePythonPath(installation)

    if (!fs.existsSync(uvPath) || !activeEnvPython) {
      depFailure = 'Python environment or uv not found while installing manager dependencies'
    } else {
      if (dryRunConflictCheck) {
        sendProgress('deps', { percent: -1, status: t('standalone.updateDepsInstalling') })
        sendOutput?.('\nInstalling manager requirements…\n')
      }
      const logFn = sendOutput ?? console.log
      try {
        const mgrResult = await installFilteredRequirementsDetailed(
          mgrReqPath,
          uvPath,
          activeEnvPython,
          installPath,
          dryRunConflictCheck ? '.manager-reqs-filtered.txt' : '.post-install-mgr-reqs.txt',
          logFn,
          signal,
          settings.getMirrorConfig()
        )
        if (mgrResult.code !== 0) {
          depFailure = withOutputTail(
            `manager requirements install exited with code ${mgrResult.code}`,
            mgrResult.output
          )
        }
      } catch (err) {
        depFailure = `manager requirements install failed: ${(err as Error).message}`
      }
    }
  }

  if (depFailure || signal?.aborted) {
    const preHead = markers.PRE_UPDATE_HEAD
    const sourceMoved = !!preHead && readGitHead(comfyuiDir) !== preHead
    let rolledBack = true
    if (sourceMoved) {
      rolledBack = await rollbackComfySource(comfyuiDir, preHead!, sendOutput)
    }
    const reason = signal?.aborted ? 'Cancelled' : depFailure!
    const message = sourceMoved
      ? `${reason}\n\n${rollbackStatusMessage(rolledBack, preHead!, markers.BACKUP_BRANCH)}`
      : reason
    if (!sendOutput) console.warn(`ComfyUI update aborted: ${reason}`)
    return { ok: false, message, installation }
  }

  await completeOpMarker(installPath)

  await fetchTags(comfyuiDir)
  clearVersionCache()
  const checkedOutTag = markers.CHECKED_OUT_TAG || undefined
  const fullPostHead = markers.POST_UPDATE_HEAD || readGitHead(comfyuiDir)

  let latestTagOverride: LatestTagOverride | undefined
  const latestTag = await findLatestVersionTag(comfyuiDir)
  if (latestTag) {
    const sha = await revParseRef(comfyuiDir, latestTag)
    if (sha) latestTagOverride = { name: latestTag, sha }
  }

  let comfyVersion: ComfyVersion | undefined
  if (fullPostHead) {
    comfyVersion = await resolveLocalVersion(
      comfyuiDir,
      fullPostHead,
      checkedOutTag,
      latestTagOverride
    )
  }

  const installedTag = comfyVersion
    ? formatComfyVersion(comfyVersion, 'short')
    : checkedOutTag || 'unknown'

  const existing =
    (installation.updateInfoByChannel as Record<string, Record<string, unknown>> | undefined) || {}
  const updateData: Record<string, unknown> = {
    ...(comfyVersion ? { comfyVersion } : {}),
    updateChannel: channel,
    updateInfoByChannel: {
      ...existing,
      [channel]: { installedTag }
    }
  }

  if (saveRollback) {
    updateData.lastRollback = {
      preUpdateHead: markers.PRE_UPDATE_HEAD || null,
      postUpdateHead: fullPostHead,
      backupBranch: markers.BACKUP_BRANCH || null,
      channel,
      updatedAt: Date.now()
    }
  }

  await update(updateData)
  if (comfyVersion) {
    installation = { ...installation, comfyVersion } as InstallationRecord
  }

  try {
    const updatedInstallation = { ...installation, updateChannel: channel }
    const filename = await snapshots.saveSnapshot(installPath, updatedInstallation, 'post-update')
    const snapshotCount = await snapshots.getSnapshotCount(installPath)
    await update({ lastSnapshot: filename, snapshotCount })

    if (preUpdateFilename) {
      const pruned = await snapshots.deduplicatePreUpdateSnapshot(installPath, preUpdateFilename)
      if (pruned) {
        const updatedCount = await snapshots.getSnapshotCount(installPath)
        await update({ snapshotCount: updatedCount })
      }
    }
  } catch (err) {
    console.warn('Post-update snapshot failed:', err)
  }

  return { ok: true, comfyVersion, installation }
}
