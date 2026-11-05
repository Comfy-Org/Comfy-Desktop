import fs from 'fs'
import path from 'path'
import * as releaseCache from '../../lib/release-cache'
import { buildChannelCards, buildChannelLabelMap } from '../../lib/channel-cards'
import type { ChannelDef } from '../../lib/channel-cards'
import { formatComfyVersion } from '../../lib/version'
import type { ComfyVersion } from '../../lib/version'
import { truncateNotes } from '../../lib/comfyui-releases'
import {
  copyAction,
  deleteAction,
  untrackAction,
  launchAction,
  openFolderAction,
  renameAction
} from '../../lib/actions'
import { t } from '../../lib/i18n'
import { buildLaunchSettingsFields, buildStorageFields } from '../common/launchSettingsFields'
import {
  getVariantLabel,
  getTorchVersion,
  getInstalledTorchTuple,
  DEFAULT_LAUNCH_ARGS
} from './envPaths'
import {
  torchTupleMatches,
  stackAppliesViaPip,
  torchLocalTag,
  isDevVersion
} from './torchStackTypes'
import { getCachedTorchStacks } from './torchStackCatalog'
import type { TorchStackEntry } from './torchStackCatalog'
import { torchSeriesInfo, nvidiaDriverMismatch } from './torchIndexManifest'
import type { InstallationRecord } from '../../installations'
import type { StatusTag } from '../../types/sources'

export const COMFYUI_REPO = 'Comfy-Org/ComfyUI'
export const RELEASE_REPO = 'Comfy-Org/ComfyUI-Standalone-Environments'
export { R2_BASE_URL } from '../../lib/r2Mirror'

function getChannelDefs(): ChannelDef[] {
  return [
    {
      value: 'stable',
      label: t('standalone.channelStable'),
      description: t('standalone.channelStableDesc'),
      recommended: true
    },
    {
      value: 'latest',
      label: t('standalone.channelLatest'),
      description: t('standalone.channelLatestDesc')
    }
  ]
}

export function getChannelLabel(channel: string): string {
  const map = buildChannelLabelMap(getChannelDefs())
  return map[channel] || channel
}

export function getEffectiveChannel(installation: InstallationRecord): string {
  const stored = (installation.updateChannel as string | undefined) || 'stable'
  if (stored !== 'stable') return stored
  const cv = installation.comfyVersion as ComfyVersion | undefined
  return typeof cv?.commitsAhead === 'number' && cv.commitsAhead > 0 ? 'latest' : stored
}

export function getListPreview(installation: InstallationRecord): string | null {
  return getChannelLabel(getEffectiveChannel(installation))
}

export function getStatusTag(installation: InstallationRecord): StatusTag | undefined {
  const channel = getEffectiveChannel(installation)
  const info = releaseCache.getEffectiveInfo(COMFYUI_REPO, channel, installation)
  if (info && releaseCache.isUpdateAvailable(installation, channel, info)) {
    const version = info.releaseName || info.latestTag || ''
    return { label: t('standalone.updateAvailableTag', { version }), style: 'update', version }
  }
  return undefined
}

function torchSeriesGroup(torch: string | null | undefined): {
  id: string
  label: string
  description?: string
} {
  const base = torchSeriesBase(torch)
  const description = torchSeriesDescription(base.id)
  if (torch && isDevVersion(torch)) {
    return {
      id: `nightly-${base.id}`,
      label: t('standalone.pytorchSeriesNightly', { series: base.label }),
      ...(description ? { description } : {})
    }
  }
  return { ...base, ...(description ? { description } : {}) }
}

function torchSeriesDescription(seriesId: string): string | undefined {
  const info = torchSeriesInfo(seriesId)
  if (!info) return undefined
  const parts: string[] = []
  const noteKey = info.noteKey ? `standalone.${info.noteKey}` : null
  const localizedNote = noteKey ? t(noteKey) : null
  if (localizedNote && localizedNote !== noteKey) parts.push(localizedNote)
  else if (info.note) parts.push(info.note)
  const mismatch = nvidiaDriverMismatch(info)
  if (mismatch) parts.push(t('standalone.pytorchDriverWarning', mismatch))
  return parts.length > 0 ? parts.join('  ·  ') : undefined
}

function versionNumbers(s: string): number[] {
  const run = /\d+(?:\.\d+)*/.exec(s)?.[0] ?? ''
  return run === '' ? [] : run.split('.').map(Number)
}

function compareNumbersDesc(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function compareStackDisplay(a: TorchStackEntry, b: TorchStackEntry): number {
  const nightly = Number(isDevVersion(a.packages.torch)) - Number(isDevVersion(b.packages.torch))
  if (nightly !== 0) return nightly
  const tagA = torchLocalTag(a.packages.torch)
  const tagB = torchLocalTag(b.packages.torch)
  if (tagA !== tagB) {
    const bySeries = compareNumbersDesc(versionNumbers(tagA), versionNumbers(tagB))
    if (bySeries !== 0) return bySeries
    return tagA.localeCompare(tagB)
  }
  const byVersion = compareNumbersDesc(
    versionNumbers(a.packages.torch),
    versionNumbers(b.packages.torch)
  )
  if (byVersion !== 0) return byVersion
  return b.date.localeCompare(a.date)
}

function torchSeriesBase(torch: string | null | undefined): { id: string; label: string } {
  const tag = torchLocalTag(torch)
  const cu = /^cu(\d{2,})$/.exec(tag)?.[1]
  if (cu) return { id: tag, label: `CUDA ${cu.slice(0, -1)}.${cu.slice(-1)} (${tag})` }
  const rocm = /^rocm([\d.]+)$/.exec(tag)?.[1]
  if (rocm) return { id: tag, label: `ROCm ${rocm}` }
  if (tag === 'xpu') return { id: 'xpu', label: 'Intel XPU' }
  if (tag === 'cpu') return { id: 'cpu', label: 'CPU' }
  if (tag === '') return { id: 'default', label: t('standalone.pytorchSeriesDefault') }
  return { id: tag, label: tag }
}

function buildPytorchSection(
  installation: InstallationRecord,
  installed: boolean
): Record<string, unknown> | null {
  if (!installed) return null
  const stacks = getCachedTorchStacks(installation)
  if (stacks.length === 0) return null
  const adopted = installation.adopted === true

  const installedTuple = getInstalledTorchTuple(installation)
  const currentTorch = installedTuple.torch
  const current = currentTorch
    ? stacks.find((s) => torchTupleMatches(s.packages, installedTuple))
    : undefined
  const fieldValue = current ? current.stackId : 'pytorch-current'

  const grouped = new Set(stacks.map((s) => torchSeriesGroup(s.packages.torch).id)).size >= 2

  const ordered = [...stacks].sort(compareStackDisplay)

  const options: Record<string, unknown>[] = []
  const syntheticCurrent = current
    ? null
    : {
        value: 'pytorch-current',
        label: currentTorch ? `PyTorch ${currentTorch}` : t('standalone.pytorchUnknown'),
        description: t('standalone.pytorchObservedDesc'),
        ...(grouped ? { groupPath: [torchSeriesGroup(currentTorch)] } : {}),
        data: {
          productName: 'PyTorch',
          installedVersion: currentTorch ?? '—',
          updateAvailable: false,
          hideUpToDateBadge: true
        }
      }
  if (syntheticCurrent && !grouped) options.push(syntheticCurrent)
  for (const s of ordered) {
    const isCurrent = s.stackId === current?.stackId
    const viaPip = stackAppliesViaPip(s.source, adopted)
    const parts: string[] = []
    if (s.packages.torchvision) parts.push(`torchvision ${s.packages.torchvision}`)
    if (s.packages.torchaudio) parts.push(`torchaudio ${s.packages.torchaudio}`)
    const noteKey = s.noteKey ? `standalone.${s.noteKey}` : null
    const localizedNote = noteKey ? t(noteKey) : null
    if (localizedNote && localizedNote !== noteKey) parts.push(localizedNote)
    else if (s.note) parts.push(s.note)
    if (!s.packages.torchaudio && !isCurrent) parts.push(t('standalone.pytorchNoTorchaudioNote'))
    if (isDevVersion(s.packages.torch)) parts.push(t('standalone.pytorchNightlyNote'))
    if (s.capWarning)
      parts.push(
        t('standalone.pytorchCapWarning', {
          required: `${s.capWarning.min}-${s.capWarning.max}`,
          detected: s.capWarning.detected.join(', ')
        })
      )
    const driverMismatch = nvidiaDriverMismatch(
      torchSeriesInfo(torchSeriesBase(s.packages.torch).id)
    )
    if (driverMismatch && !isCurrent)
      parts.push(t('standalone.pytorchDriverWarning', driverMismatch))
    const sizeGB = s.bundle ? (s.bundle.size / 1024 ** 3).toFixed(1) : ''
    if (!viaPip) parts.push(t('standalone.pytorchDownloadSize', { size: sizeGB }))
    const confirmMessage = viaPip
      ? t('standalone.pytorchConfirmMessagePip', {
          from: `**${currentTorch ?? '—'}**`,
          to: `**${s.packages.torch}**`
        })
      : t('standalone.pytorchConfirmMessage', {
          from: `**${currentTorch ?? '—'}**`,
          to: `**${s.packages.torch}**`,
          size: sizeGB
        })
    const capNotice = s.capWarning
      ? `\n\n${t('standalone.pytorchCapConfirmWarning', {
          required: `${s.capWarning.min}-${s.capWarning.max}`,
          detected: s.capWarning.detected.join(', ')
        })}`
      : ''
    const driverNotice = driverMismatch
      ? `\n\n${t('standalone.pytorchDriverConfirmWarning', driverMismatch)}`
      : ''
    const actions = isCurrent
      ? undefined
      : [
          {
            id: 'change-pytorch',
            label: t('standalone.pytorchChangeNow'),
            style: 'primary',
            enabled: true,
            showProgress: true,
            cancellable: true,
            progressTitle: t('standalone.pytorchChangingTitle', { version: s.packages.torch }),
            data: { stackId: s.stackId },
            confirm: {
              title: t('standalone.pytorchConfirmTitle'),
              message:
                confirmMessage +
                capNotice +
                driverNotice +
                `\n\n${t('standalone.updateSnapshotUndoHint')}`
            }
          },
          {
            id: 'copy-pytorch',
            label: t('standalone.copyAndChangePytorch'),
            style: 'default',
            enabled: true,
            tooltip: t('tooltips.copyAndChangePytorch'),
            showProgress: true,
            cancellable: true,
            progressTitle: t('standalone.copyPytorchChangingTitle', { version: s.packages.torch }),
            data: { stackId: s.stackId },
            prompt: {
              title: t('standalone.copyAndChangePytorchTitle'),
              message:
                t('standalone.copyAndChangePytorchMessage', {
                  from: `**${currentTorch ?? '?'}**`,
                  to: `**${s.packages.torch}**`
                }) +
                capNotice +
                driverNotice,
              placeholder: t('standalone.copyAndUpdatePlaceholder'),
              defaultValue: installation.name,
              uniquifyDefault: true,
              confirmLabel: t('standalone.copyAndChangePytorchConfirm'),
              required: true,
              field: 'name'
            }
          }
        ]
    options.push({
      value: s.stackId,
      label: `PyTorch ${s.packages.torch}`,
      description: parts.join('  ·  '),
      ...(grouped ? { groupPath: [torchSeriesGroup(s.packages.torch)] } : {}),
      data: {
        productName: 'PyTorch',
        installedVersion: currentTorch ?? '—',
        latestVersion: s.packages.torch,
        latestLabel: t('standalone.pytorchSelectedVersion'),
        updateAvailable: !isCurrent,
        hideUpToDateBadge: true,
        ...(actions ? { actions } : {})
      }
    })
  }
  if (syntheticCurrent && grouped) options.push(syntheticCurrent)

  return {
    tab: 'update',
    title: t('standalone.pytorchSection'),
    fields: [
      {
        id: 'pytorchStack',
        label: t('standalone.pytorch'),
        value: fieldValue,
        editable: true,
        refreshSection: true,
        editType: 'channel-cards',
        options,
        tooltip: t('tooltips.pytorchStack'),
        ...(grouped ? { groupLabels: [t('standalone.pytorchSeriesLabel')] } : {})
      }
    ]
  }
}

export function getDetailSections(installation: InstallationRecord): Record<string, unknown>[] {
  const installed = installation.status === 'installed'

  const infoFields: Record<string, unknown>[] = [
    { label: t('common.installMethod'), value: installation.sourceLabel as string },
    {
      key: 'comfyui-version',
      label: t('standalone.currentVersion'),
      value: installation.comfyVersion
        ? formatComfyVersion(installation.comfyVersion as ComfyVersion, 'detail')
        : (installation.version as string | undefined) || 'unknown'
    },
    {
      label: t('standalone.variant'),
      value: (installation.variant as string | undefined)
        ? getVariantLabel(installation.variant as string)
        : '—'
    },
    {
      label: t('standalone.python'),
      value: (installation.pythonVersion as string | undefined) || '—'
    },
    { label: t('standalone.pytorch'), value: getTorchVersion(installation) || '—' },
    { label: t('common.location'), value: installation.installPath || '—' }
  ]

  const copiedFrom = installation.copiedFrom as string | undefined
  if (copiedFrom) {
    const copiedFromName = installation.copiedFromName as string | undefined
    const copiedAt = installation.copiedAt as string | undefined
    const copyReason = installation.copyReason as string | undefined
    const reasonLabel =
      copyReason === 'copy-update'
        ? t('standalone.lineageCopyUpdate')
        : copyReason === 'copy-pytorch'
          ? t('standalone.lineageCopyPytorch')
          : copyReason === 'release-update'
            ? t('standalone.lineageReleaseUpdate')
            : t('standalone.lineageCopy')
    const dateStr = copiedAt ? new Date(copiedAt).toLocaleString() : ''
    const nameStr = copiedFromName || copiedFrom
    infoFields.push({
      label: t('standalone.lineage'),
      value: dateStr ? `${reasonLabel}: ${nameStr}  ·  ${dateStr}` : `${reasonLabel}: ${nameStr}`
    })
  }

  const sections: Record<string, unknown>[] = [
    {
      tab: 'status',
      title: t('common.installInfo'),
      fields: infoFields
    }
  ]

  if (installed && installation.installPath) {
    sections.push({
      tab: 'snapshots',
      title: t('standalone.snapshotHistory')
    })
  }

  const hasGit =
    installed &&
    installation.installPath &&
    fs.existsSync(path.join(installation.installPath, 'ComfyUI', '.git'))
  const channel = getEffectiveChannel(installation)

  const channelDefs = getChannelDefs()
  const baseCards = buildChannelCards(COMFYUI_REPO, channelDefs, installation)

  const channelOptions = baseCards.map((card) => {
    const actions: Record<string, unknown>[] = []
    if (card.data?.updateAvailable && hasGit) {
      const channelInfo = releaseCache.getEffectiveInfo(COMFYUI_REPO, card.value, installation)!
      const cv = installation.comfyVersion as ComfyVersion | undefined
      const installedDisplay = cv
        ? formatComfyVersion(cv, 'detail')
        : channelInfo.installedTag || 'unknown'
      const latestCv = channelInfo.commitSha
        ? ({
            commit: channelInfo.commitSha,
            baseTag: channelInfo.baseTag,
            commitsAhead: channelInfo.commitsAhead
          } as ComfyVersion)
        : undefined
      const latestDisplay = latestCv
        ? formatComfyVersion(latestCv, 'detail')
        : channelInfo.releaseName || channelInfo.latestTag || '—'
      const isSwitching = card.value !== channel
      const isDowngrade =
        card.value === 'stable' && cv
          ? cv.commitsAhead === undefined
            ? !!cv.baseTag
            : cv.commitsAhead > 0
          : false
      const msgKey = isDowngrade
        ? 'standalone.updateConfirmMessageDowngrade'
        : card.value === 'latest'
          ? 'standalone.updateConfirmMessageLatest'
          : 'standalone.updateConfirmMessage'
      const notes = truncateNotes(channelInfo.releaseNotes || '', 2000)
      const notesDetails = notes
        ? [{ label: t('standalone.releaseNotesLabel'), items: [notes] }]
        : undefined
      const switchPrefix = isSwitching
        ? t('channelCards.switchChannelPrefix', {
            from: `**${getChannelLabel(channel)}**`,
            to: `**${card.label}**`
          })
        : ''
      const boldInstalled = `**${installedDisplay}**`
      const boldLatest = `**${latestDisplay}**`
      const baseConfirmMessage = isSwitching
        ? t('channelCards.movingTo', { channel: `**${card.label}**` })
        : t(msgKey, { installed: boldInstalled, latest: boldLatest })
      const confirmMessage = `${baseConfirmMessage}\n\n${t('standalone.updateSnapshotUndoHint')}`
      actions.push({
        id: 'update-comfyui',
        label: t('standalone.updateNow'),
        style: 'primary',
        enabled: installed,
        tooltip: t('tooltips.updateNow'),
        showProgress: true,
        progressTitle: isSwitching
          ? t('channelCards.switchingToTitle', { channel: card.label })
          : isDowngrade
            ? t('standalone.downgradingTitle', { version: latestDisplay })
            : t('standalone.updatingTitle', { version: latestDisplay }),
        data: {
          channel: card.value,
          isDowngrade
        },
        confirm: {
          title: t('standalone.updateConfirmTitle'),
          message: confirmMessage,
          messageDetails: notesDetails
        }
      })
      actions.push({
        id: 'copy-update',
        label: t('standalone.copyAndUpdate'),
        style: 'default',
        enabled: installed,
        tooltip: t('tooltips.copyAndUpdate'),
        showProgress: true,
        progressTitle: t('standalone.copyUpdatingTitle', { version: latestDisplay }),
        cancellable: true,
        data: { channel: card.value },
        prompt: {
          title: t('standalone.copyAndUpdateTitle'),
          message:
            (isSwitching ? switchPrefix : '') +
            t('standalone.copyAndUpdateMessage', { installed: boldInstalled, latest: boldLatest }),
          placeholder: t('standalone.copyAndUpdatePlaceholder'),
          defaultValue: installation.name,
          uniquifyDefault: true,
          confirmLabel: t('standalone.copyAndUpdateConfirm'),
          required: true,
          field: 'name',
          messageDetails: notesDetails
        }
      })
    } else if (card.value !== channel && hasGit) {
      actions.push({
        id: 'switch-channel',
        label: t('channelCards.switchChannelOnly'),
        style: 'default',
        enabled: installed,
        data: { channel: card.value }
      })
    }
    return {
      ...card,
      data: card.data ? { ...card.data, actions: actions.length ? actions : undefined } : undefined
    }
  })

  const updateFields: Record<string, unknown>[] = [
    {
      id: 'updateChannel',
      label: t('standalone.updateChannel'),
      value: channel,
      editable: true,
      refreshSection: true,
      editType: 'channel-cards',
      options: channelOptions,
      tooltip: t('tooltips.updateChannel')
    }
  ]
  const updateActions: Record<string, unknown>[] = [
    { id: 'check-update', label: t('actions.checkForUpdate'), style: 'default', enabled: installed }
  ]
  sections.push({
    tab: 'update',
    title: t('standalone.updates'),
    fields: updateFields,
    actions: updateActions
  })

  const pytorchSection = buildPytorchSection(installation, installed)
  if (pytorchSection) sections.push(pytorchSection)

  sections.push(
    {
      tab: 'settings',
      title: t('common.launchSettings'),
      fields: buildLaunchSettingsFields(installation, { defaultLaunchArgs: DEFAULT_LAUNCH_ARGS })
    },
    {
      tab: 'storage',
      fields: buildStorageFields(installation)
    },
    {
      title: 'Actions',
      pinBottom: true,
      actions: [
        launchAction(installed, !installed ? t('errors.installNotReady') : undefined),
        renameAction(installation.name),
        copyAction(installation.name, installed),
        openFolderAction(installation.installPath),
        { id: 'share', label: t('actions.share'), style: 'default', enabled: installed },
        ...(installation.adopted ? [] : [untrackAction()]),
        deleteAction(installation)
      ]
    }
  )

  return sections
}
