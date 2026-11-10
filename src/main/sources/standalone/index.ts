import fs from 'fs'
import path from 'path'
import { fetchJSON } from '../../lib/fetch'
import { parseArgs, extractPort, formatTime } from '../../lib/util'
import { t } from '../../lib/i18n'
import { launchAction } from '../../lib/actions'
import { getLatestStableTag, getStableTags } from '../../lib/comfyui-releases'
import { copyDirWithProgress } from '../../lib/copy'
import { resolveModelsPresence } from '../../lib/modelDownloadPaths'
import {
  PLATFORM_PREFIX,
  DEFAULT_LAUNCH_ARGS,
  getVariantLabel,
  stripPlatform,
  getActivePythonPath,
  getVenvDir,
  recommendVariant,
  variantMatchesHost,
  writeComfyEnvironment
} from './envPaths'
import { install, postInstall, probeInstallation } from './install'
import { NO_TEMPLATE_VALUE, isPersistableTemplateId } from './curatedTemplates'
import { loadTemplateCatalog, toTemplateFieldOption } from './templateCatalog'
import { resolveTemplateModels } from './templateModels'
import * as installations from '../../installations'

import { getListPreview, getStatusTag, getDetailSections, R2_BASE_URL } from './updateSections'
import { handleAction } from './actions'
import type { InstallationRecord } from '../../installations'
import type { SourcePlugin, FieldOption, LaunchCommand } from '../../types/sources'

export { getVariantLabel } from './envPaths'

import type { R2Variant, R2Latest, R2VendorReleases } from './r2Catalog'

interface VariantData {
  variantId: string
  manifest: { id: string; comfyui_ref: string; python_version: string }
  downloadUrl: string
  downloadFiles: { url: string; filename: string; size: number }[]
}

const MODELS_PRESENT_BUDGET_MS = 2500

function buildVariantOption(
  vendorId: string,
  release: R2Variant,
  displayTag: string | null,
  gpu: string | undefined,
  nightly = false
): FieldOption {
  const sizeMB = (release.size / 1048576).toFixed(0)
  const downloadFiles = [
    {
      url: `${R2_BASE_URL}/${vendorId}/${release.tag}/${release.file}`,
      filename: release.file,
      size: release.size
    }
  ]
  const displayVersion = displayTag
    ? `${displayTag.replace(/^v/, '')}${nightly ? ' (nightly)' : ''}`
    : release.comfyui_version
  return {
    value: vendorId,
    label: getVariantLabel(vendorId),
    description: `ComfyUI ${displayVersion}  ·  Python ${release.python_version}  ·  ${sizeMB} MB`,
    data: {
      variantId: vendorId,
      manifest: {
        id: vendorId,
        comfyui_ref: release.comfyui_version,
        python_version: release.python_version
      },
      downloadFiles,
      downloadUrl: downloadFiles[0]!.url,
      r2Release: release
    } as unknown as Record<string, unknown>,
    recommended: recommendVariant(vendorId, gpu)
  }
}

export function buildPinnedVariant(
  release: FieldOption,
  variantId: string,
  releaseTag: string,
  gpu?: string
): FieldOption | null {
  const releaseData = release.data as { vendorReleases?: Record<string, R2Variant[]> } | undefined
  const history = releaseData?.vendorReleases?.[variantId]
  if (!history) return null
  const exact = history.find((r) => r.tag === releaseTag)
  if (!exact) return null
  return buildVariantOption(variantId, exact, null, gpu)
}

export const standalone: SourcePlugin = {
  id: 'standalone',
  get label() {
    return t('standalone.label')
  },
  get description() {
    return t('standalone.desc')
  },
  category: 'local',

  get fields() {
    return [
      { id: 'release', label: t('common.release'), type: 'select' as const },
      { id: 'comfyVersion', label: t('standalone.comfyVersion'), type: 'select' as const },
      {
        id: 'variant',
        label: t('standalone.variant'),
        type: 'select' as const,
        renderAs: 'cards' as const
      },
      {
        id: 'bundledTemplate',
        label: t('standalone.starterTemplate'),
        type: 'select' as const,
        renderAs: 'cards' as const
      }
    ]
  },

  defaultLaunchArgs: DEFAULT_LAUNCH_ARGS,

  get installSteps() {
    return [
      { phase: 'download', label: t('common.download') },
      { phase: 'extract', label: t('common.extract') },
      { phase: 'setup', label: t('standalone.setupEnv') },
      { phase: 'cleanup', label: t('standalone.cleanupEnv') },
      { phase: 'update', label: t('standalone.updateToStable') }
    ]
  },

  getDefaults() {
    return { launchArgs: DEFAULT_LAUNCH_ARGS, launchMode: 'window', portConflict: 'auto' }
  },

  getListPreview,
  getStatusTag,
  getDetailSections,

  buildInstallation(selections: Record<string, FieldOption | undefined>): Record<string, unknown> {
    const vd = selections.variant?.data as (VariantData & { r2Release?: R2Variant }) | undefined
    const manifest = vd?.manifest
    const r2Release = vd?.r2Release
    const variantId = vd?.variantId || ''
    const isCpu = stripPlatform(variantId) === 'cpu' || stripPlatform(variantId).startsWith('cpu-')
    const isStable = selections.release?.value === 'stable'
    const isLatest = selections.release?.value === 'latest'
    const releaseTag = r2Release?.tag || selections.release?.value || 'unknown'
    const pickedComfyTag = isStable
      ? typeof selections.comfyVersion?.value === 'string' &&
        /^v\d+\.\d+\.\d+$/.test(selections.comfyVersion.value)
        ? selections.comfyVersion.value
        : undefined
      : undefined
    const tplValue = selections.bundledTemplate?.value
    const bundledTemplateId = isPersistableTemplateId(tplValue) ? tplValue : undefined
    const bundledTemplateSizeBytes =
      typeof selections.bundledTemplate?.data?.sizeBytes === 'number'
        ? (selections.bundledTemplate.data.sizeBytes as number)
        : 0
    return {
      version: r2Release?.comfyui_version || manifest?.comfyui_ref || releaseTag,
      releaseTag,
      variant: variantId,
      downloadUrl: vd?.downloadUrl || '',
      downloadFiles: vd?.downloadFiles || [],
      pythonVersion: manifest?.python_version || '',
      ...(r2Release?.build !== undefined ? { originalBuild: r2Release.build } : {}),
      ...(r2Release?.torch_version ? { originalTorchVersion: r2Release.torch_version } : {}),
      launchArgs: isCpu ? `${DEFAULT_LAUNCH_ARGS} --cpu` : DEFAULT_LAUNCH_ARGS,
      launchMode: 'window',
      browserPartition: 'unique',
      ...(isStable || isLatest ? { autoUpdateComfyUI: true } : {}),
      ...(isStable ? { updateChannel: 'stable' } : {}),
      ...(isLatest ? { updateChannel: 'latest' } : {}),
      ...(pickedComfyTag ? { comfyVersionTag: pickedComfyTag } : {}),
      ...(bundledTemplateId
        ? {
            bundledTemplateId,
            bundledTemplateSizeBytes,
            pendingTemplateOpen: bundledTemplateId,
            downloadTemplateModels: true
          }
        : {})
    }
  },

  getLaunchCommand(installation: InstallationRecord): LaunchCommand | null {
    const adopted = installation.adopted === true
    const pythonPath = getActivePythonPath(installation)
    if (!pythonPath || !fs.existsSync(pythonPath)) return null
    const mainPy = path.join(installation.installPath, 'ComfyUI', 'main.py')
    if (!fs.existsSync(mainPy)) return null
    const userArgs = ((installation.launchArgs as string | undefined) ?? DEFAULT_LAUNCH_ARGS).trim()
    const parsed = userArgs.length > 0 ? parseArgs(userArgs) : []
    const port = extractPort(parsed)
    const adoptedBaseDir = adopted ? (installation.adoptedBaseDir as string | undefined) : undefined
    const userSetDatabaseUrl = parsed.some(
      (a) => a === '--database-url' || a.startsWith('--database-url=')
    )
    const adoptArgs = adoptedBaseDir
      ? [
          '--base-directory',
          adoptedBaseDir,
          '--user-directory',
          path.join(adoptedBaseDir, 'user'),
          ...(userSetDatabaseUrl
            ? []
            : ['--database-url', `sqlite:///${path.join(adoptedBaseDir, 'user', 'comfyui.db')}`])
        ]
      : []
    return {
      cmd: pythonPath,
      args: ['-s', path.join('ComfyUI', 'main.py'), ...adoptArgs, ...parsed],
      cwd: installation.installPath,
      port
    }
  },

  getListActions(installation: InstallationRecord): Record<string, unknown>[] {
    const installed = installation.status === 'installed'
    return [launchAction(installed, !installed ? t('errors.installNotReady') : undefined)]
  },

  install,
  postInstall,
  probeInstallation,
  handleAction,

  async fixupCopy(
    inst: InstallationRecord,
    destPath: string,
    sendProgress: (phase: string, detail: Record<string, unknown>) => void,
    signal?: AbortSignal
  ): Promise<void> {
    await writeComfyEnvironment(path.join(destPath, 'ComfyUI'))

    const adopted = inst.adopted === true
    const adoptedBaseDir = adopted ? (inst.adoptedBaseDir as string | undefined) : undefined

    // global `modelsDirs` setting (inherited from the source record),
    if (adopted && adoptedBaseDir && fs.existsSync(adoptedBaseDir)) {
      const carryOver = ['.venv', 'user', 'custom_nodes', 'input', 'output']
      const destComfyUI = path.join(destPath, 'ComfyUI')
      for (const entry of carryOver) {
        if (signal?.aborted) return
        const src = path.join(adoptedBaseDir, entry)
        if (!fs.existsSync(src)) continue
        const dst = path.join(destComfyUI, entry)
        if (fs.existsSync(dst)) {
          try {
            await fs.promises.rm(dst, { recursive: true, force: true })
          } catch {}
        }
        sendProgress('copy', { percent: 0, status: `Copying legacy ${entry}…` })
        await copyDirWithProgress(
          src,
          dst,
          (copied, total, elapsedSecs, etaSecs) => {
            const percent = total > 0 ? Math.round((copied / total) * 100) : 0
            const elapsed = formatTime(elapsedSecs)
            const eta = etaSecs >= 0 ? formatTime(etaSecs) : '—'
            sendProgress('copy', {
              percent,
              status: `Copying legacy ${entry}  ${copied} / ${total}  ·  ${elapsed} elapsed  ·  ${eta} remaining`
            })
          },
          { signal }
        )
      }
    }

    const venvPath = getVenvDir(destPath)
    if (!fs.existsSync(venvPath)) return

    const srcRewriteFrom = adopted && adoptedBaseDir ? adoptedBaseDir : inst.installPath
    const srcRewriteTo = adopted && adoptedBaseDir ? path.join(destPath, 'ComfyUI') : destPath

    const cfgPath = path.join(venvPath, 'pyvenv.cfg')
    if (fs.existsSync(cfgPath)) {
      let content = await fs.promises.readFile(cfgPath, 'utf-8')
      content = content.replaceAll(srcRewriteFrom, srcRewriteTo)
      await fs.promises.writeFile(cfgPath, content, 'utf-8')
    }

    if (process.platform !== 'win32') {
      const binDir = path.join(venvPath, 'bin')
      if (fs.existsSync(binDir)) {
        const entries = await fs.promises.readdir(binDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isFile()) continue
          const filePath = path.join(binDir, entry.name)
          try {
            let content = await fs.promises.readFile(filePath, 'utf-8')
            if (content.startsWith('#!') && content.includes(srcRewriteFrom)) {
              content = content.replaceAll(srcRewriteFrom, srcRewriteTo)
              await fs.promises.writeFile(filePath, content, 'utf-8')
            }
          } catch {}
        }
      }
    }
  },

  async getFieldOptions(
    fieldId: string,
    selections: Record<string, FieldOption | undefined>,
    context: Record<string, unknown>
  ): Promise<FieldOption[]> {
    if (fieldId === 'release') {
      const prefix = PLATFORM_PREFIX[process.platform]
      if (!prefix) return []

      const latest = (await fetchJSON(`${R2_BASE_URL}/latest.json`, { refresh: true })) as R2Latest
      const vendorIds = Object.keys(latest).filter((id) => variantMatchesHost(id))
      if (vendorIds.length === 0) return []

      const vendorReleases = Object.fromEntries(
        await Promise.all(
          vendorIds.map(async (id) => {
            const data = (await fetchJSON(`${R2_BASE_URL}/${id}/releases.json`, {
              refresh: true
            })) as R2VendorReleases
            return [id, data.releases] as const
          })
        )
      )

      const tagMap = new Map<string, { comfyui_version: string; date: string; tag: string }>()
      for (const releases of Object.values(vendorReleases)) {
        for (const release of releases) {
          if (!tagMap.has(release.tag) || release.date > tagMap.get(release.tag)!.date) {
            tagMap.set(release.tag, {
              comfyui_version: release.comfyui_version,
              date: release.date,
              tag: release.tag
            })
          }
        }
      }
      const tags = [...tagMap.values()].sort((a, b) => b.date.localeCompare(a.date))

      const options: FieldOption[] = []

      if (tags.length > 0 && context?.includeLatestStable) {
        const latestStableTag = await getLatestStableTag()
        const newestBundle = tags[0]!
        const channelData = {
          tag: newestBundle.tag,
          vendorReleases,
          latestStableTag
        } as unknown as Record<string, unknown>
        options.push({
          value: 'stable',
          label: t('standalone.channelStable'),
          description: t('standalone.channelStableDesc'),
          recommended: true,
          data: channelData
        })
        options.push({
          value: 'latest',
          label: t('standalone.channelLatest'),
          description: t('standalone.channelLatestDesc'),
          data: channelData
        })
      }
      return options
    }

    if (fieldId === 'comfyVersion') {
      if (selections.release?.value !== 'stable') return []
      const tags = await getStableTags()
      if (tags.length === 0) return []
      return tags.map((tag, i) => ({
        value: tag,
        label: tag,
        recommended: i === 0,
        description: i === 0 ? t('newInstall.latestStable') : undefined
      }))
    }

    if (fieldId === 'variant') {
      const releaseData = selections.release?.data as
        | {
            tag: string
            vendorReleases: Record<string, R2Variant[]>
            latestStableTag?: string | null
          }
        | undefined
      if (!releaseData) return []
      const prefix = PLATFORM_PREFIX[process.platform]
      if (!prefix) return []

      const isStable = selections.release?.value === 'stable'
      const isLatest = selections.release?.value === 'latest'
      const gpu = context?.gpu as string | undefined
      const pickedComfyTag =
        isStable &&
        typeof selections.comfyVersion?.value === 'string' &&
        /^v\d+\.\d+\.\d+$/.test(selections.comfyVersion.value)
          ? selections.comfyVersion.value
          : null

      return Object.entries(releaseData.vendorReleases)
        .filter(([vendorId]) => variantMatchesHost(vendorId))
        .map(([vendorId, releases]): FieldOption | null => {
          const release = releases[0]
          if (!release) return null
          const displayTag = isStable
            ? (pickedComfyTag ?? releaseData.latestStableTag ?? null)
            : isLatest
              ? (releaseData.latestStableTag ?? null)
              : null
          return buildVariantOption(vendorId, release, displayTag, gpu, isLatest)
        })
        .filter((item): item is FieldOption => item != null)
    }

    if (fieldId === 'bundledTemplate') {
      const catalog = await loadTemplateCatalog()

      const installId = typeof context.installationId === 'string' ? context.installationId : null
      const installation = installId ? await installations.get(installId) : null
      const { presence: presenceById, timedOut } = await resolveModelsPresence(
        catalog.map(({ id }) => id),
        installId,
        (id) => resolveTemplateModels(installation, id),
        MODELS_PRESENT_BUDGET_MS
      )
      if (timedOut) {
        console.warn(
          `Template models-present check hit ${MODELS_PRESENT_BUDGET_MS}ms budget for install ${installId ?? '(none)'}; some cards unbadged`
        )
      }

      return [
        {
          value: NO_TEMPLATE_VALUE,
          label: t('standalone.starterTemplateNone'),
          description: t('standalone.starterTemplateNoneDesc')
        },
        ...catalog.map((tpl) => toTemplateFieldOption(tpl, presenceById.get(tpl.id) ?? false))
      ]
    }

    return []
  }
}
