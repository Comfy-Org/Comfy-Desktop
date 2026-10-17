import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, ArrowRightLeft } from 'lucide-vue-next'
import { useSessionStore } from '../stores/sessionStore'
import { progressOpKindForActionId } from '../lib/progressOpKind'
import { installTypeMetaForInstall } from '../lib/installTypeIcon'
import { isBuildInstall } from '../devplatform/buildState'
import type { Installation } from '../types/ipc'

export type InstallLifecycleStatus = 'idle' | 'launching' | 'running' | 'stopping' | 'error'

export interface InstallTileStateOptions {
  installation: () => Installation
  /** Override runtime lifecycle presentation for surfaces that own separate sessions. */
  lifecycleStatus?: () => InstallLifecycleStatus | undefined
  /** True while Desktop captures this instance and creates its workspace draft. */
  isPromotingToWorkspace?: () => boolean
  showWhyCloud?: () => boolean
}

/**
 * What a dashboard card shows about an install: its lifecycle (running,
 * starting, stopping, updating, errored), its one update / migrate action,
 * and its meta facts. Shared by the dashboard tile and the Builds dashboard's
 * cards so the two cannot drift.
 */
export function useInstallTileState(opts: InstallTileStateOptions) {
  const { t } = useI18n()
  const sessionStore = useSessionStore()

  const inst = computed(() => opts.installation())

  const isRunning = computed(() =>
    opts.lifecycleStatus?.() == null
      ? sessionStore.isRunning(inst.value.id)
      : opts.lifecycleStatus?.() === 'running'
  )
  const isLaunching = computed(() =>
    opts.lifecycleStatus?.() == null
      ? sessionStore.isLaunching(inst.value.id)
      : opts.lifecycleStatus?.() === 'launching'
  )
  const isStopping = computed(() =>
    opts.lifecycleStatus?.() == null
      ? sessionStore.isStopping(inst.value.id)
      : opts.lifecycleStatus?.() === 'stopping'
  )
  /* A managed update flips the record to status 'updating'; a standalone
   * update never touches the record and is only visible through main's
   * operation broadcast. Key on both so the tile reports "Updating" the same
   * way for either kind, regardless of which window started the update. */
  const isUpdating = computed(() => {
    if (inst.value.status === 'updating') return true
    const op = sessionStore.operationInstances.get(inst.value.id)
    return op != null && progressOpKindForActionId(op.actionId) === 'update'
  })
  const hasError = computed(() =>
    opts.lifecycleStatus?.() == null
      ? sessionStore.errorInstances.has(inst.value.id)
      : opts.lifecycleStatus?.() === 'error'
  )

  /* Backend-flagged problem states (failed install, interrupted delete, missing
   * install folder) carry a `danger` statusTag. Surface it as a static red pill —
   * distinct from a live crash (`hasError`), which owns the clickable error badge. */
  const dangerTag = computed(() =>
    inst.value.statusTag?.style === 'danger' ? inst.value.statusTag : null
  )

  const statusClasses = computed<Record<string, boolean>>(() => ({
    'chooser-tile-running': isRunning.value && !isStopping.value,
    'chooser-tile-stopping': isStopping.value,
    'chooser-tile-updating': isUpdating.value,
    'chooser-tile-errored': hasError.value || dangerTag.value != null
  }))

  /* Lifecycle → top-right status pill (dot + label). Stopping wins over
   * launching wins over running; an idle tile gets no pill. An errored
   * tile shows the clickable error badge instead (see template). */
  const statusPill = computed<{
    label: string
    dotClass: string
    spinning?: boolean
    running?: boolean
  } | null>(() => {
    if (opts.isPromotingToWorkspace?.())
      return {
        label: 'devPlatform.workspace.promoting',
        dotClass: 'chooser-tile-status--promoting',
        spinning: true
      }
    if (isUpdating.value)
      return {
        label: 'instancePicker.progressUpdating',
        dotClass: 'chooser-tile-status--updating',
        spinning: true
      }
    if (isStopping.value)
      return { label: 'chooser.statusStopping', dotClass: 'chooser-tile-status--stopping' }
    if (isLaunching.value)
      return { label: 'chooser.statusLaunching', dotClass: 'chooser-tile-status--launching' }
    if (isRunning.value)
      return {
        label: 'chooser.statusRunning',
        dotClass: 'chooser-tile-status--running',
        running: true
      }
    return null
  })

  const showWhyCloudTrigger = computed(
    () => opts.showWhyCloud?.() && !hasError.value && !statusPill.value && !dangerTag.value
  )

  const hasUpdate = computed(() => inst.value.statusTag?.style === 'update')
  // The backend tags every migratable install (Legacy Desktop, portable, git)
  // with a `migrate` status tag — mirror `hasUpdate` rather than special-casing
  // a single source.
  const hasMigratePrompt = computed(() => inst.value.statusTag?.style === 'migrate')

  const typeMeta = computed(() => installTypeMetaForInstall(inst.value))

  /** Wears the build glyph rather than its install-type icon, so a build keeps
   *  one identity whether it's installed or still a card. */
  const isFromBuild = computed(() => isBuildInstall(inst.value))

  const buildVersion = computed(() =>
    typeof inst.value.distributionVersion === 'string' ? inst.value.distributionVersion : ''
  )

  /** Desktop's listPreview is the bare installPath (useless as a label), so fall
   *  back to sourceLabel. Cloud/remote values are URLs — strip the protocol. */
  const sourceLabel = computed(() => {
    // The path is noise on a tile whose identity is the build.
    if (isFromBuild.value) return ''
    const raw =
      inst.value.sourceId === 'desktop'
        ? inst.value.sourceLabel
        : inst.value.listPreview || inst.value.sourceLabel
    return raw ? raw.replace(/^https?:\/\//, '') : raw
  })

  /** Labelled ("Build v7") so it can't be read as the ComfyUI version beside it. */
  const trailingFact = computed(() =>
    isFromBuild.value
      ? buildVersion.value
        ? t('devPlatform.build.version', { version: buildVersion.value })
        : ''
      : inst.value.version || ''
  )

  /** Build installs show the ComfyUI version followed by the Build version;
   *  everything else shows the source followed by its version. */
  const leadingFact = computed(() =>
    isFromBuild.value ? inst.value.version || '' : sourceLabel.value
  )

  const metaLine = computed(() =>
    [leadingFact.value, trailingFact.value].filter(Boolean).join(' · ')
  )

  /** The single update/migrate affordance, or null when the install has neither.
   *  The Update tooltip surfaces the target version the bare pill hides. */
  const actionPill = computed(() => {
    if (isUpdating.value) return null
    if (hasUpdate.value)
      return {
        action: 'update' as const,
        icon: ArrowDownToLine,
        label: t('chooser.updatePill'),
        tooltip: inst.value.statusTag?.label || t('chooser.updatePill'),
        pillClass: 'chooser-tile-pill-update'
      }
    if (hasMigratePrompt.value)
      return {
        action: 'migrate' as const,
        icon: ArrowRightLeft,
        label: t('chooser.migratePill'),
        tooltip: t('dashboard.migrateBannerTitle'),
        pillClass: 'chooser-tile-pill-migrate'
      }
    return null
  })

  /** The hover button repeats the tile's own click, labelled with what it does. */
  const launchLabel = computed(() =>
    isRunning.value ? t('chooser.openInstall') : t('actions.launch')
  )
  const canLaunch = computed(() => !isStopping.value && !isUpdating.value)

  return {
    inst,
    isRunning,
    isLaunching,
    isStopping,
    isUpdating,
    hasError,
    dangerTag,
    statusClasses,
    statusPill,
    showWhyCloudTrigger,
    typeMeta,
    leadingFact,
    trailingFact,
    metaLine,
    actionPill,
    launchLabel,
    canLaunch
  }
}
