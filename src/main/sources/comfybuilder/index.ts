/**
 * ComfyBuilder pipeline source — main process only.
 *
 * Lists the signed-in workspace's ComfyBuilder pipelines as selectable install
 * cards. For each pipeline the newest succeeded build's artifact is resolved so
 * the card can advertise whether it is installable; every pipeline is shown
 * regardless — un-installable ones are surfaced with a reason and blocked later,
 * at install time, never filtered out here.
 *
 * When no one is signed in, the field resolves to a single `requiresAuth`
 * sentinel option and makes zero network calls, so the wizard can prompt for
 * sign-in instead of listing pipelines.
 */
import fs from 'fs'
import path from 'path'
import { t } from '../../lib/i18n'
import { parseArgs, extractPort } from '../../lib/util'
import { getActivePythonPath } from '../../lib/pythonEnv'
import { DEFAULT_LAUNCH_ARGS } from '../standalone/envPaths'
import { install } from './install'
import { postInstall, probeInstallation } from '../standalone/install'
import { listDeployments, listPipelines } from '../../comfybuilder/apiClient'
import type { ApiClientOptions } from '../../comfybuilder/apiClient'
import { pipelineInstallState, resolveLatestArtifact } from '../../comfybuilder/latestArtifact'
import type { PipelineInstallReason } from '../../comfybuilder/latestArtifact'
import { loadTokens } from '../../comfybuilder/tokenStore'
import type { Artifact } from '../../comfybuilder/dto'
import type { InstallationRecord } from '../../installations'
import type {
  SourcePlugin,
  FieldOption,
  LaunchCommand,
  ActionResult,
  ActionTools,
} from '../../types/sources'

/** The single card-picker field id. */
const PIPELINE_FIELD = 'pipeline'

/**
 * Sentinel option value returned (as the sole option) when the user is not
 * signed in. The renderer detects `data.requiresAuth` and shows a sign-in
 * prompt instead of a card grid.
 */
export const REQUIRES_AUTH_VALUE = '__comfybuilder_requires_auth__'

/**
 * Install-decision metadata carried on each pipeline card's `data.meta`. The
 * install flow reads `deploymentId`/`artifact` to know exactly what to fetch;
 * the wizard reads `installable`/`reason` to gate the Continue button.
 */
export interface PipelineOptionMeta {
  installable: boolean
  reason?: PipelineInstallReason
  deploymentId?: string
  version?: string
  artifact?: Artifact
}

/**
 * Test-only seam: point the pipeline/deployment lookups at the mock Builder API.
 * Production leaves this unset and inherits the real base URL. It is deliberately
 * NOT read from the renderer-supplied `context`, so the renderer can never
 * redirect an authenticated request at an arbitrary host.
 */
let apiClientOptions: ApiClientOptions | undefined

/** @internal — override the API client options in tests (mock Builder API). */
export function _setApiClientOptionsForTest(options: ApiClientOptions | undefined): void {
  apiClientOptions = options
}

/** The lone option returned when the user is signed out; carries no network cost. */
function requiresAuthOption(): FieldOption {
  return {
    value: REQUIRES_AUTH_VALUE,
    label: 'Sign in to ComfyBuilder',
    description: 'Sign in to view and install your account pipelines.',
    data: { requiresAuth: true },
  }
}

/** One-line card description reflecting the pipeline's install state. */
function describePipeline(meta: PipelineOptionMeta): string {
  if (meta.installable) {
    return meta.version ? `Latest build: ${meta.version}` : 'Ready to install'
  }
  if (meta.reason === 'platform-mismatch') return 'No build for this platform yet'
  return 'No successful build yet'
}

/**
 * Resolve one pipeline into a card option: fetch its deployments, pick the
 * newest succeeded artifact, and compute install-state metadata. Never throws
 * away the pipeline — an un-installable one still becomes a (blocked) card.
 */
async function buildPipelineOption(
  pipelineId: string,
  pipelineName: string,
  orgId: string,
): Promise<FieldOption> {
  const deployments = await listDeployments(pipelineId, apiClientOptions)
  const resolved = resolveLatestArtifact(deployments)
  const state = pipelineInstallState(deployments, process.platform)
  const meta: PipelineOptionMeta = {
    installable: state.installable,
    ...(state.reason ? { reason: state.reason } : {}),
    ...(resolved
      ? {
          deploymentId: resolved.deployment.id,
          version: resolved.deployment.version,
          artifact: resolved.artifact,
        }
      : {}),
  }
  return {
    value: pipelineId,
    label: pipelineName,
    description: describePipeline(meta),
    data: { pipelineId, pipelineName, orgId, meta },
  }
}

export const comfybuilder: SourcePlugin = {
  id: 'comfybuilder',
  label: 'ComfyBuilder',
  description: 'Install a custom ComfyUI distribution built with ComfyBuilder.',
  category: 'local',

  get fields() {
    return [
      { id: PIPELINE_FIELD, label: 'Pipeline', type: 'select' as const, renderAs: 'cards' as const },
    ]
  },

  defaultLaunchArgs: DEFAULT_LAUNCH_ARGS,

  get installSteps() {
    return [
      { phase: 'download', label: t('common.download') },
      { phase: 'extract', label: t('common.extract') },
      { phase: 'setup', label: t('standalone.setupEnv') },
      { phase: 'cleanup', label: t('standalone.cleanupEnv') },
    ]
  },

  getDefaults() {
    return { launchArgs: DEFAULT_LAUNCH_ARGS, launchMode: 'window', browserPartition: 'unique' }
  },

  async getFieldOptions(
    fieldId: string,
    _selections: Record<string, FieldOption | undefined>,
    _context: Record<string, unknown>,
  ): Promise<FieldOption[]> {
    if (fieldId !== PIPELINE_FIELD) return []
    // Signed out: surface the sign-in sentinel and make zero network calls.
    if (loadTokens() === null) return [requiresAuthOption()]

    // ALL pipelines are returned — un-installable ones carry a reason and are
    // blocked at install, never hidden. Resolve their states in parallel.
    const pipelines = await listPipelines(apiClientOptions)
    return Promise.all(pipelines.map((p) => buildPipelineOption(p.id, p.name, p.org_id)))
  },

  buildInstallation(selections: Record<string, FieldOption | undefined>): Record<string, unknown> {
    const data = selections[PIPELINE_FIELD]?.data as
      | { pipelineId?: string; pipelineName?: string; meta?: PipelineOptionMeta }
      | undefined
    const meta = data?.meta
    const artifact = meta?.artifact
    return {
      pipelineId: data?.pipelineId ?? '',
      pipelineName: data?.pipelineName ?? '',
      // Read back by install.ts to block an un-installable pipeline at install time.
      installable: meta?.installable === true,
      ...(meta?.reason ? { reason: meta.reason } : {}),
      ...(meta?.deploymentId ? { deploymentId: meta.deploymentId } : {}),
      version: meta?.version ?? '',
      downloadUrl: artifact?.download_url ?? '',
      ...(artifact
        ? {
            artifactId: artifact.artifact_id,
            artifactFilename: artifact.filename,
            artifactChecksum: artifact.checksum,
            artifactSizeBytes: artifact.size_bytes,
          }
        : {}),
      launchArgs: DEFAULT_LAUNCH_ARGS,
      launchMode: 'window',
      browserPartition: 'unique',
    }
  },

  getListPreview(installation: InstallationRecord): string | null {
    return (installation.pipelineName as string) || null
  },

  getLaunchCommand(installation: InstallationRecord): LaunchCommand | null {
    // A ComfyBuilder distribution unpacks to the same standalone-env + ComfyUI
    // layout as the standalone source, so launch resolves the managed venv
    // python and runs ComfyUI/main.py from the install root.
    const pythonPath = getActivePythonPath(installation)
    if (!pythonPath || !fs.existsSync(pythonPath)) return null
    const mainPy = path.join(installation.installPath, 'ComfyUI', 'main.py')
    if (!fs.existsSync(mainPy)) return null
    const userArgs = ((installation.launchArgs as string | undefined) ?? DEFAULT_LAUNCH_ARGS).trim()
    const parsed = userArgs.length > 0 ? parseArgs(userArgs) : []
    const port = extractPort(parsed)
    return {
      cmd: pythonPath,
      args: ['-s', path.join('ComfyUI', 'main.py'), ...parsed],
      cwd: installation.installPath,
      port,
    }
  },

  getListActions(installation: InstallationRecord): Record<string, unknown>[] {
    const installed = installation.status === 'installed'
    return [
      {
        id: 'launch',
        label: 'Launch',
        style: 'primary',
        enabled: installed,
        ...(installed ? {} : { disabledMessage: 'Installation is not ready yet.' }),
        showProgress: true,
        progressTitle: 'Starting ComfyUI',
        cancellable: true,
      },
    ]
  },

  getDetailSections(installation: InstallationRecord): Record<string, unknown>[] {
    return [
      {
        tab: 'status',
        title: 'Installation Info',
        fields: [
          { label: 'Install method', value: (installation.sourceLabel as string) || 'ComfyBuilder' },
          { label: 'Pipeline', value: (installation.pipelineName as string) || '—' },
          { label: 'Version', value: (installation.version as string) || '—' },
        ],
      },
    ]
  },

  install,
  postInstall,
  // A ComfyBuilder artifact unpacks to the same standalone-env + ComfyUI layout,
  // so the standalone probe reads the manifest identically.
  probeInstallation,

  async handleAction(
    actionId: string,
    _installation: InstallationRecord,
    _actionData: Record<string, unknown> | undefined,
    _tools: ActionTools,
  ): Promise<ActionResult> {
    return { ok: false, message: `Action "${actionId}" not yet implemented.` }
  },
}
