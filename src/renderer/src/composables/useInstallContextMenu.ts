import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '../stores/sessionStore'
import { useProgressStore } from '../stores/progressStore'
import { useModal } from './useModal'
import { useStopAction } from './useStopAction'
import { revealInFolderLabel } from './usePlatform'
import { progressOpKindForActionId, destroysInstanceForActionId } from '../lib/progressOpKind'
import { shareLatestSnapshot } from '../lib/snapshots'
import { isBuildInstall } from '../devplatform/buildState'
import type { ContextMenuItem } from '../types/context-menu'
import type { Installation, ShowProgressOpts } from '../types/ipc'

export type InstallMenuActionId =
  | 'manage'
  | 'update'
  | 'migrate'
  | 'restore-snapshot'
  | 'stop'
  | 'reveal-in-folder'
  | 'share'
  | 'promote-to-workspace'
  | 'copy-install'
  | 'delete'

export interface ManageOpenOptions {
  initialTab?: string
  autoAction?: string | null
}

export function useInstallContextMenu(
  opts: {
    onManage?: (inst: Installation, options?: ManageOpenOptions) => void
    onShowProgress?: (showOpts: ShowProgressOpts) => void
    canPromoteToWorkspace?: (inst: Installation) => boolean
  } = {}
) {
  const { t } = useI18n()
  const modal = useModal()
  const { confirmAndStop } = useStopAction({
    confirm: (o) => modal.confirm({ ...o, confirmStyle: 'danger' }),
    alert: (o) => modal.alert(o)
  })
  const sessionStore = useSessionStore()
  const progressStore = useProgressStore()

  const ctxMenu = ref({
    open: false,
    x: 0,
    y: 0,
    inst: null as Installation | null
  })
  const promotingInstallationIds = ref<ReadonlySet<string>>(new Set())

  function setPromotingToWorkspace(installationId: string, promoting: boolean): void {
    const next = new Set(promotingInstallationIds.value)
    if (promoting) next.add(installationId)
    else next.delete(installationId)
    promotingInstallationIds.value = next
  }

  function isPromotingToWorkspace(inst: Installation): boolean {
    return promotingInstallationIds.value.has(inst.id)
  }

  function isLocalLikeInstall(inst: Installation): boolean {
    return inst.sourceCategory !== 'cloud'
  }

  function isInstalled(inst: Installation): boolean {
    return inst.status === 'installed'
  }

  function hasUpdateTag(inst: Installation): boolean {
    return inst.statusTag?.style === 'update'
  }

  function hasMigratePrompt(inst: Installation): boolean {
    return inst.statusTag?.style === 'migrate'
  }

  function hasInstallPath(inst: Installation): boolean {
    return !!inst.installPath
  }

  function isStoppedActionGated(inst: Installation): boolean {
    return (
      sessionStore.isRunning(inst.id) ||
      sessionStore.isStopping(inst.id) ||
      progressStore.getProgressInfo(inst.id) !== null
    )
  }

  function getMenuItems(inst: Installation): ContextMenuItem[] {
    const items: ContextMenuItem[] = []
    const stoppedActionGated = isStoppedActionGated(inst)
    const supportsSnapshotActions =
      isInstalled(inst) && hasInstallPath(inst) && isLocalLikeInstall(inst) && !isBuildInstall(inst)
    const gatedTitle = stoppedActionGated ? t('chooser.stoppedActionGatedReason') : undefined

    if (opts.onManage) {
      items.push({
        id: 'manage',
        label: t('chooser.manageInstall')
      })

      if (isInstalled(inst) && hasUpdateTag(inst)) {
        items.push({
          id: 'update',
          label: t('chooser.menuUpdate'),
          disabled: stoppedActionGated,
          title: gatedTitle
        })
      }
      if (hasMigratePrompt(inst)) {
        items.push({
          id: 'migrate',
          label: t('chooser.menuMigrate'),
          disabled: stoppedActionGated,
          title: gatedTitle
        })
      }
    }

    if (isInstalled(inst) && (inst.sourceId === 'standalone' || isBuildInstall(inst))) {
      items.push({
        id: 'copy-install',
        label: t('actions.copyInstallation'),
        disabled: stoppedActionGated,
        title: gatedTitle
      })
    }

    if (hasInstallPath(inst) && isLocalLikeInstall(inst)) {
      items.push({
        id: 'reveal-in-folder',
        label: revealInFolderLabel(window.api?.platform)
      })
    }

    const snapshotCluster: ContextMenuItem[] = []

    if (supportsSnapshotActions) {
      snapshotCluster.push({
        id: 'share',
        label: t('chooser.menuExportSnapshot', 'Export Snapshot')
      })
    }

    if (opts.onManage && supportsSnapshotActions) {
      snapshotCluster.push({
        id: 'restore-snapshot',
        label: t('chooser.menuRestoreSnapshot'),
        disabled: stoppedActionGated,
        title: gatedTitle
      })
    }

    if (opts.canPromoteToWorkspace?.(inst)) {
      const promoting = isPromotingToWorkspace(inst)
      snapshotCluster.push({
        id: 'promote-to-workspace',
        label: promoting
          ? t('devPlatform.workspace.promoting', 'Creating...')
          : t('devPlatform.workspace.promoteToWorkspace', 'Create Build'),
        hint: t(
          'devPlatform.workspace.promoteToWorkspaceHint',
          'Create a Build from this instance in Comfy Developer Platform.'
        ),
        hintUrl: 'https://platform.comfy.org/profile/deploy',
        hintLinkLabel: t('devPlatform.workspace.readMore', 'Read more'),
        disabled: promoting
      })
    }

    const [snapshotClusterHead] = snapshotCluster
    if (snapshotClusterHead) {
      snapshotClusterHead.separator = items.length > 0
      items.push(...snapshotCluster)
    }

    const cluster: ContextMenuItem[] = []
    if (isLocalLikeInstall(inst) && sessionStore.isRunning(inst.id)) {
      cluster.push({ id: 'stop', label: t('actions.stop', 'Stop'), style: 'danger' })
    }
    if (isLocalLikeInstall(inst) && (isInstalled(inst) || isBuildInstall(inst))) {
      cluster.push({
        id: 'delete',
        label: t('chooser.menuDelete'),
        disabled: stoppedActionGated,
        title: gatedTitle,
        style: 'danger'
      })
    }
    const [clusterHead] = cluster
    if (clusterHead) {
      clusterHead.separator = items.length > 0
      items.push(...cluster)
    }

    return items
  }

  function openCardMenu(event: MouseEvent, inst: Installation): void {
    const items = getMenuItems(inst)
    if (items.length === 0) return
    event.preventDefault()
    ctxMenu.value = { open: true, x: event.clientX, y: event.clientY, inst }
  }

  function openKebabMenu(event: MouseEvent, inst: Installation): void {
    const items = getMenuItems(inst)
    if (items.length === 0) return
    event.stopPropagation()
    event.preventDefault()
    const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect?.()
    const x = rect ? rect.right - 180 : event.clientX
    const y = (rect?.bottom ?? event.clientY) + 4
    ctxMenu.value = { open: true, x, y, inst }
  }

  const ctxMenuItems = computed<ContextMenuItem[]>(() => {
    const inst = ctxMenu.value.inst
    if (!inst) return []
    return getMenuItems(inst)
  })

  async function runInstantActionWithAlert(
    inst: Installation,
    actionId: string,
    actionLabel: string
  ): Promise<void> {
    try {
      const result = await window.api.runAction(inst.id, actionId)
      if (result.ok === false && result.message) {
        await modal.alert({ title: actionLabel, message: result.message })
      }
    } catch (err) {
      const message = (err as Error)?.message || String(err)
      await modal.alert({ title: actionLabel, message })
    }
  }

  async function triggerAction(id: string, inst: Installation): Promise<void> {
    if (id === 'manage') {
      opts.onManage?.(inst)
    } else if (id === 'update') {
      opts.onManage?.(inst, { initialTab: 'update', autoAction: 'update-comfyui' })
    } else if (id === 'migrate') {
      opts.onManage?.(inst, { autoAction: 'migrate-to-standalone' })
    } else if (id === 'restore-snapshot') {
      opts.onManage?.(inst, { initialTab: 'snapshots' })
    } else if (id === 'stop') {
      await confirmAndStop(inst.id)
    } else if (id === 'reveal-in-folder') {
      await runInstantActionWithAlert(
        inst,
        'open-folder',
        revealInFolderLabel(window.api?.platform)
      )
    } else if (id === 'share') {
      const label = t('chooser.menuExportSnapshot', 'Export Snapshot')
      try {
        const result = await shareLatestSnapshot(inst.id)
        if (!result.ok) {
          await modal.alert({
            title: label,
            message:
              result.reason === 'none'
                ? t('snapshots.noSnapshotsToShare', 'There are no snapshots to share yet.')
                : (result.message ?? t('snapshots.shareFailed', 'Could not share the snapshot.'))
          })
        }
      } catch (err) {
        await modal.alert({ title: label, message: (err as Error)?.message || String(err) })
      }
    } else if (id === 'promote-to-workspace') {
      if (isPromotingToWorkspace(inst)) return
      const title = t('devPlatform.workspace.promoteFailedTitle', 'Could not create build')
      let failureMessage: string | null = null
      setPromotingToWorkspace(inst.id, true)
      try {
        const result = await window.api.comfybuilder.promoteLocalInstance(inst.id)
        if (!result.ok) {
          failureMessage =
            result.message ||
            t(
              'devPlatform.workspace.promoteFailedMessage',
              'Could not create a draft in Comfy Developer Platform.'
            )
        }
      } catch (err) {
        failureMessage = (err as Error)?.message || String(err)
      } finally {
        setPromotingToWorkspace(inst.id, false)
      }
      if (failureMessage) await modal.alert({ title, message: failureMessage })
    } else if (id === 'copy-install') {
      opts.onManage?.(inst, { autoAction: 'copy' })
    } else if (id === 'delete') {
      if (opts.onShowProgress) {
        const deleteLabel = t('actions.delete', 'Delete')
        const confirmed = await modal.confirm({
          title: t('actions.deleteConfirmTitle', 'Delete Install'),
          message: `${inst.installPath ? inst.installPath + '\n\n' : ''}${t(
            'actions.deleteConfirmMessage',
            'This permanently removes this ComfyUI installation and all its files. This cannot be undone.'
          )}\n\n${t('actions.deleteConfirmDetail', 'Other installs are not affected.')}`,
          confirmLabel: deleteLabel,
          confirmStyle: 'danger'
        })
        if (!confirmed) return
        opts.onShowProgress({
          installationId: inst.id,
          title: `${deleteLabel} - ${inst.name}`,
          apiCall: () => window.api.runAction(inst.id, 'delete'),
          cancellable: true,
          returnTo: 'list',
          opKind: progressOpKindForActionId('delete'),
          destroysInstance: destroysInstanceForActionId('delete')
        })
        return
      }
      if (opts.onManage) {
        opts.onManage(inst, { autoAction: 'delete' })
      } else {
        await runInstantActionWithAlert(inst, 'delete', t('chooser.menuDelete'))
      }
    }
  }

  async function handleCtxMenuSelect(id: string): Promise<void> {
    const inst = ctxMenu.value.inst
    if (!inst) return
    await triggerAction(id, inst)
  }

  function closeMenu(): void {
    ctxMenu.value.open = false
  }

  function viewError(inst: Installation): void {
    const err = sessionStore.errorInstances.get(inst.id)
    if (!err) return
    let message = err.message
    if (!message) {
      if (err.signal && err.exitCode != null) {
        message = t('comfyLifecycle.crashedDescWithCodeAndSignal', {
          code: err.exitCode,
          signal: err.signal
        })
      } else if (err.signal) {
        message = t('comfyLifecycle.crashedDescWithSignal', { signal: err.signal })
      } else if (err.exitCode != null) {
        message = t('comfyLifecycle.crashedDescWithCode', { code: err.exitCode })
      } else {
        message = t('comfyLifecycle.crashedDesc')
      }
    }
    if (err.lastStderr) message = `${message}\n\n${err.lastStderr}`
    void modal.alert({ title: t('chooser.errorTitle'), message })
  }

  function viewDanger(inst: Installation): void {
    const tag = inst.statusTag
    if (!tag || tag.style !== 'danger') return
    void modal.alert({ title: tag.label, message: tag.detail || tag.label })
  }

  return {
    ctxMenu,
    ctxMenuItems,
    openCardMenu,
    openKebabMenu,
    handleCtxMenuSelect,
    closeMenu,
    triggerAction,
    viewError,
    viewDanger,
    isStoppedActionGated,
    isPromotingToWorkspace
  }
}
