import fs from 'fs'
import path from 'path'
import * as releaseCache from '../../lib/release-cache'
import { buildChannelCards, buildChannelLabelMap } from '../../lib/channel-cards'
import type { ChannelDef } from '../../lib/channel-cards'
import { formatComfyVersion } from '../../lib/version'
import type { ComfyVersion } from '../../lib/version'
import { truncateNotes } from '../../lib/comfyui-releases'
import { deleteAction, untrackAction, launchAction, openFolderAction, renameAction } from '../../lib/actions'
import { t } from '../../lib/i18n'
import { buildLaunchSettingsFields, buildStorageFields } from '../common/launchSettingsFields'
import { getVariantLabel, getTorchVersion, getInstalledTorchTuple, DEFAULT_LAUNCH_ARGS } from './envPaths'
import { torchTupleMatches } from './torchStackTypes'
import { getCachedTorchStacks } from './torchStackCatalog'
import type { InstallationRecord } from '../../installations'
import type { StatusTag } from '../../types/sources'

export const COMFYUI_REPO = 'Comfy-Org/ComfyUI'
export const RELEASE_REPO = 'Comfy-Org/ComfyUI-Standalone-Environments'
export { R2_BASE_URL } from '../../lib/r2Mirror'

function getChannelDefs(): ChannelDef[] {
  return [
    { value: 'stable', label: t('standalone.channelStable'), description: t('standalone.channelStableDesc'), recommended: true },
    { value: 'latest', label: t('standalone.channelLatest'), description: t('standalone.channelLatestDesc') },
  ]
}

export function getChannelLabel(channel: string): string {
  const map = buildChannelLabelMap(getChannelDefs())
  return map[channel] || channel
}

/**
 * The channel to surface for an install. `installation.updateChannel` is a
 * declared preference that can drift from the real checkout (e.g. a `git pull`
 * outside the app leaves a `stable` record many commits past its base tag), so
 * when the tree is ahead of its base stable tag the de-facto channel is
 * `latest`. Never mutates the stored record; the next in-app update reconciles.
 */
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

/**
 * The PyTorch stack picker on the Update tab. Uses the synchronously cached
 * catalog (refreshed by check-update); hidden entirely until the cache has
 * compatible stacks, and always hidden for adopted installs (their env is not
 * ours to mutate). Options are presentation only — the change-pytorch handler
 * re-resolves the stackId on the main side.
 */
function buildPytorchSection(installation: InstallationRecord, installed: boolean): Record<string, unknown> | null {
  if (!installed || installation.adopted === true) return null
  const stacks = getCachedTorchStacks(installation)
  if (stacks.length === 0) return null

  // Full-tuple match (local tags stripped): torch version alone can't
  // distinguish stacks, and dist-info versions may carry a +cuXXX tag the
  // catalog omits.
  const installedTuple = getInstalledTorchTuple(installation)
  const currentTorch = installedTuple.torch
  const current = currentTorch ? stacks.find((s) => torchTupleMatches(s.packages, installedTuple)) : undefined
  const fieldValue = current ? current.stackId : 'pytorch-current'

  const options: Record<string, unknown>[] = []
  if (!current) {
    // The installed torch doesn't match any catalog stack (manual install or
    // catalog gap): surface it as a read-only "current" entry.
    options.push({
      value: 'pytorch-current',
      label: currentTorch ? `PyTorch ${currentTorch}` : t('standalone.pytorchUnknown'),
      description: t('standalone.pytorchObservedDesc'),
      data: { installedVersion: currentTorch ?? '—', updateAvailable: false },
    })
  }
  for (const s of stacks) {
    const isCurrent = s.stackId === current?.stackId
    const parts: string[] = []
    if (s.packages.torchvision) parts.push(`torchvision ${s.packages.torchvision}`)
    if (s.packages.torchaudio) parts.push(`torchaudio ${s.packages.torchaudio}`)
    const sizeGB = (s.bundle.size / 1024 ** 3).toFixed(1)
    parts.push(t('standalone.pytorchDownloadSize', { size: sizeGB }))
    const actions = isCurrent ? undefined : [{
      id: 'change-pytorch', label: t('standalone.pytorchChangeNow'), style: 'primary', enabled: true,
      showProgress: true, cancellable: true,
      progressTitle: t('standalone.pytorchChangingTitle', { version: s.packages.torch }),
      data: { stackId: s.stackId },
      confirm: {
        title: t('standalone.pytorchConfirmTitle'),
        message: t('standalone.pytorchConfirmMessage', {
          from: `**${currentTorch ?? '—'}**`,
          to: `**${s.packages.torch}**`,
          size: sizeGB,
        }) + `\n\n${t('standalone.updateSnapshotUndoHint')}`,
      },
    }]
    options.push({
      value: s.stackId,
      label: `PyTorch ${s.packages.torch}`,
      description: parts.join('  ·  '),
      data: {
        installedVersion: currentTorch ?? '—',
        latestVersion: s.packages.torch,
        updateAvailable: !isCurrent,
        ...(actions ? { actions } : {}),
      },
    })
  }

  return {
    tab: 'update',
    title: t('standalone.pytorchSection'),
    fields: [{
      id: 'pytorchStack', label: t('standalone.pytorch'), value: fieldValue, editable: true,
      refreshSection: true, editType: 'channel-cards', options, tooltip: t('tooltips.pytorchStack'),
    }],
  }
}

export function getDetailSections(installation: InstallationRecord): Record<string, unknown>[] {
  const installed = installation.status === 'installed'

  const infoFields: Record<string, unknown>[] = [
    { label: t('common.installMethod'), value: installation.sourceLabel as string },
    { key: 'comfyui-version', label: t('standalone.currentVersion'), value: installation.comfyVersion ? formatComfyVersion(installation.comfyVersion as ComfyVersion, 'detail') : (installation.version as string | undefined) || 'unknown' },
    { label: t('standalone.variant'), value: (installation.variant as string | undefined) ? getVariantLabel(installation.variant as string) : '—' },
    { label: t('standalone.python'), value: (installation.pythonVersion as string | undefined) || '—' },
    { label: t('standalone.pytorch'), value: getTorchVersion(installation) || '—' },
    { label: t('common.location'), value: installation.installPath || '—' },
  ]

  const copiedFrom = installation.copiedFrom as string | undefined
  if (copiedFrom) {
    const copiedFromName = installation.copiedFromName as string | undefined
    const copiedAt = installation.copiedAt as string | undefined
    const copyReason = installation.copyReason as string | undefined
    const reasonLabel = copyReason === 'copy-update' ? t('standalone.lineageCopyUpdate')
      : copyReason === 'release-update' ? t('standalone.lineageReleaseUpdate')
      : t('standalone.lineageCopy')
    const dateStr = copiedAt ? new Date(copiedAt).toLocaleString() : ''
    const nameStr = copiedFromName || copiedFrom
    infoFields.push({
      label: t('standalone.lineage'),
      value: dateStr
        ? `${reasonLabel}: ${nameStr}  ·  ${dateStr}`
        : `${reasonLabel}: ${nameStr}`,
    })
  }

  const sections: Record<string, unknown>[] = [
    {
      tab: 'status',
      title: t('common.installInfo'),
      fields: infoFields,
    },
  ]

  // Minimal section so the tab appears; SnapshotTab.vue handles rendering.
  if (installed && installation.installPath) {
    sections.push({
      tab: 'snapshots',
      title: t('standalone.snapshotHistory'),
    })
  }

  const hasGit = installed && installation.installPath && fs.existsSync(path.join(installation.installPath, 'ComfyUI', '.git'))
  const channel = getEffectiveChannel(installation)

  const channelDefs = getChannelDefs()
  const baseCards = buildChannelCards(COMFYUI_REPO, channelDefs, installation)

  const channelOptions = baseCards.map((card) => {
    const actions: Record<string, unknown>[] = []
    if (card.data?.updateAvailable && hasGit) {
      const channelInfo = releaseCache.getEffectiveInfo(COMFYUI_REPO, card.value, installation)!
      const cv = installation.comfyVersion as ComfyVersion | undefined
      const installedDisplay = cv ? formatComfyVersion(cv, 'detail') : (channelInfo.installedTag || 'unknown')
      const latestCv = channelInfo.commitSha
        ? { commit: channelInfo.commitSha, baseTag: channelInfo.baseTag, commitsAhead: channelInfo.commitsAhead } as ComfyVersion
        : undefined
      const latestDisplay = latestCv ? formatComfyVersion(latestCv, 'detail') : (channelInfo.releaseName || channelInfo.latestTag || '—')
      const isSwitching = card.value !== channel
      const isDowngrade = card.value === 'stable' && cv ? (cv.commitsAhead === undefined ? !!cv.baseTag : cv.commitsAhead > 0) : false
      const msgKey = isDowngrade ? 'standalone.updateConfirmMessageDowngrade'
        : card.value === 'latest' ? 'standalone.updateConfirmMessageLatest'
        : 'standalone.updateConfirmMessage'
      const notes = truncateNotes(channelInfo.releaseNotes || '', 2000)
      const notesDetails = notes ? [{ label: t('standalone.releaseNotesLabel'), items: [notes] }] : undefined
      const switchPrefix = isSwitching
        ? t('channelCards.switchChannelPrefix', { from: `**${getChannelLabel(channel)}**`, to: `**${card.label}**` })
        : ''
      const boldInstalled = `**${installedDisplay}**`
      const boldLatest = `**${latestDisplay}**`
      // A channel switch reads as "Moving to <channel>"; the up/down direction
      // is incidental and frames it confusingly. Same-channel updates keep the
      // version-diff / rollback copy.
      // Every in-place update path carries the breakage warning — custom
      // nodes / saved workflows can pin to specific ComfyUI internals that
      // shift across releases. Pair it with the snapshot-undo hint so the
      // user knows the update is reversible. Both live in the confirm copy
      // itself (not the collapsible details) so the user can't dismiss past
      // them accidentally.
      const baseConfirmMessage = isSwitching
        ? t('channelCards.movingTo', { channel: `**${card.label}**` })
        : t(msgKey, { installed: boldInstalled, latest: boldLatest })
      const confirmMessage = `${baseConfirmMessage}\n\n${t('standalone.updateBreakingWarning')}\n${t('standalone.updateSnapshotUndoHint')}`
      actions.push({
        id: 'update-comfyui', label: t('standalone.updateNow'), style: 'primary', enabled: installed,
        tooltip: t('tooltips.updateNow'),
        showProgress: true,
        progressTitle: isSwitching
          ? t('channelCards.switchingToTitle', { channel: card.label })
          : isDowngrade
            ? t('standalone.downgradingTitle', { version: latestDisplay })
            : t('standalone.updatingTitle', { version: latestDisplay }),
        // Carry the explicit target channel: the stored `updateChannel` can be
        // stale, which would pass `--stable` for a latest checkout and silently
        // downgrade it.
        data: {
          channel: card.value,
          isDowngrade,
        },
        confirm: {
          title: t('standalone.updateConfirmTitle'),
          message: confirmMessage,
          messageDetails: notesDetails,
        },
      })
      actions.push({
        id: 'copy-update', label: t('standalone.copyAndUpdate'), style: 'default', enabled: installed,
        tooltip: t('tooltips.copyAndUpdate'),
        showProgress: true, progressTitle: t('standalone.copyUpdatingTitle', { version: latestDisplay }),
        cancellable: true,
        data: { channel: card.value },
        prompt: {
          title: t('standalone.copyAndUpdateTitle'),
          message: (isSwitching ? switchPrefix : '') + t('standalone.copyAndUpdateMessage', { installed: boldInstalled, latest: boldLatest }),
          placeholder: t('standalone.copyAndUpdatePlaceholder'),
          // Default to the source name (never the target version, which goes
          // stale the moment the copy is updated again). `uniquifyDefault` shows
          // the numbered name it will actually get on save (e.g. "ComfyUI (8)").
          defaultValue: installation.name,
          uniquifyDefault: true,
          confirmLabel: t('standalone.copyAndUpdateConfirm'),
          required: true,
          field: 'name',
          messageDetails: notesDetails,
        },
      })
    } else if (card.value !== channel && hasGit) {
      actions.push({
        id: 'switch-channel', label: t('channelCards.switchChannelOnly'), style: 'default', enabled: installed,
        data: { channel: card.value },
      })
    }
    return { ...card, data: card.data ? { ...card.data, actions: actions.length ? actions : undefined } : undefined }
  })

  const updateFields: Record<string, unknown>[] = [
    { id: 'updateChannel', label: t('standalone.updateChannel'), value: channel, editable: true,
      refreshSection: true, editType: 'channel-cards', options: channelOptions, tooltip: t('tooltips.updateChannel') },
  ]
  const updateActions: Record<string, unknown>[] = [
    { id: 'check-update', label: t('actions.checkForUpdate'), style: 'default', enabled: installed },
  ]
  sections.push({
    tab: 'update',
    title: t('standalone.updates'),
    fields: updateFields,
    actions: updateActions,
  })

  const pytorchSection = buildPytorchSection(installation, installed)
  if (pytorchSection) sections.push(pytorchSection)

  sections.push(
    {
      tab: 'settings',
      title: t('common.launchSettings'),
      fields: buildLaunchSettingsFields(installation, { defaultLaunchArgs: DEFAULT_LAUNCH_ARGS }),
    },
    {
      tab: 'storage',
      fields: buildStorageFields(installation),
    },
    {
      title: 'Actions',
      pinBottom: true,
      actions: [
        launchAction(installed, !installed ? t('errors.installNotReady') : undefined),
        renameAction(installation.name),
        { id: 'copy', label: t('actions.copyInstallation'), style: 'default', enabled: installed,
          showProgress: true, progressTitle: t('actions.copyingInstallation'), cancellable: true,
          prompt: {
            title: t('actions.copyInstallationTitle'),
            message: t('actions.copyInstallationMessage'),
            // Pre-fill with the numbered name the duplicate will actually get on
            // save ("ComfyUI" → "ComfyUI (1)"), via uniqueName(), instead of a
            // "(Copy)" label or a stale suggestion that differs from the result.
            defaultValue: installation.name,
            uniquifyDefault: true,
            confirmLabel: t('actions.copyInstallationConfirm'),
            required: true,
            field: 'name',
          } },
        openFolderAction(installation.installPath),
        { id: 'share', label: t('actions.share'), style: 'default', enabled: installed },
        // Adopted installs are non-forgettable: the `.comfyui-desktop-2`
        // marker on disk would also stop the legacy auto-tracker from
        // resurfacing them, stranding the user. Matches the same gate in
        // the chooser context menu (useInstallContextMenu).
        ...(installation.adopted ? [] : [untrackAction()]),
        deleteAction(installation),
      ],
    },
  )

  return sections
}
