import {
  computed,
  onScopeDispose,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useModal } from './useModal'
import { useDialogs } from './useDialogs'
import { useStopAction } from './useStopAction'
import { useActionGuard } from './useActionGuard'
import { useMigrateAction } from './useMigrateAction'
import { useSessionStore } from '../stores/sessionStore'
import { emitTelemetryAction, toErrorBucket } from '../lib/telemetry'
import { progressOpKindForActionId, destroysInstanceForActionId } from '../lib/progressOpKind'
import {
  REQUIRES_STOPPED,
  type ActionDef,
  type ActionResult,
  type DetailField,
  type DetailSection,
  type DiskSpaceInfo,
  type Installation,
  type ShowProgressOpts
} from '../types/ipc'
import { shareLatestSnapshot } from '../lib/snapshots'
import {
  IN_PLACE_RELAUNCH,
  augmentActionWithStopWarning,
  stopAndWaitForExit
} from '../lib/stopWarning'
import { sleepRemainder } from '../lib/uiTiming'
import type { SectionTab } from '../lib/pickerTabs'
import {
  runConfirmChain,
  runDiskSpaceCheck,
  runFieldSelectsChain,
  runPromptChain,
  runSelectChain
} from './actionShoppingList'

export interface UseComfyUISettingsOpts {
  installation: MaybeRefOrGetter<Installation | null>
  onShowProgress: (opts: ShowProgressOpts) => void
  onNavigateList?: () => void
  onClose?: () => void
  onDismissPreview?: () => void
}

export interface UseComfyUISettingsApi {
  sections: Ref<DetailSection[]>
  diskSpace: Ref<DiskSpaceInfo | null>
  loading: Ref<boolean>
  error: Ref<string | null>

  sectionsFresh: ComputedRef<boolean>

  notice: Ref<string | null>

  reload: () => Promise<void>

  refreshSection: (sectionTitle: string | undefined) => Promise<void>

  updateField: (field: DetailField, value: unknown) => Promise<void>

  pendingRestartFieldIds: ComputedRef<Set<string>>

  clearPendingRestart: (installId: string) => void

  fieldErrorMessages: ComputedRef<Map<string, string>>

  renameInstallation: (newName: string) => Promise<boolean>

  runAction: (action: ActionDef) => Promise<void>

  runningActionIds: Ref<Set<string>>

  sectionsForTab: (tab: SectionTab) => ComputedRef<DetailSection[]>

  diskUsageItem: ComputedRef<{ label: string; value: string } | null>

  pinBottomSection: ComputedRef<DetailSection | null>

  pinBottomActions: ComputedRef<ActionDef[]>
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function useComfyUISettings(opts: UseComfyUISettingsOpts): UseComfyUISettingsApi {
  const { t } = useI18n()
  const modal = useModal()
  const dialogs = useDialogs()
  const { confirmAndStop } = useStopAction({
    confirm: (o) => dialogs.confirm({ ...o, tone: 'danger' }),
    alert: (o) => dialogs.alert(o)
  })
  const actionGuard = useActionGuard()
  const { confirmMigration } = useMigrateAction()
  const sessionStore = useSessionStore()

  const sections = ref<DetailSection[]>([])
  const diskSpace = ref<DiskSpaceInfo | null>(null)
  const installSize = ref<number | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const notice = ref<string | null>(null)
  let noticeTimer: ReturnType<typeof setTimeout> | null = null
  const NOTICE_TTL_MS = 4000
  function flashNotice(message: string): void {
    if (noticeTimer) clearTimeout(noticeTimer)
    notice.value = message
    noticeTimer = setTimeout(() => {
      notice.value = null
      noticeTimer = null
    }, NOTICE_TTL_MS)
  }
  const runningActionIds = ref<Set<string>>(new Set())
  const restartBaselines = ref<Map<string, Map<string, unknown>>>(new Map())
  const errorMessages = ref<Map<string, Map<string, string>>>(new Map())
  const errorClearTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const UPDATE_TIMEOUT_MS = 5000
  const ERROR_TAG_TTL_MS = 4000
  let lastLoadedId: string | null = null
  const sectionsPayloadId = ref<string | null>(null)
  let requestSeq = 0

  async function loadAll(installationId: string, installPath: string): Promise<void> {
    lastLoadedId = installationId
    loading.value = true
    error.value = null
    const seq = ++requestSeq
    try {
      const [secs, disk] = await Promise.all([
        window.api.getDetailSections(installationId),
        installPath ? window.api.getDiskSpace(installPath).catch(() => null) : Promise.resolve(null)
      ])
      if (seq !== requestSeq) return
      sections.value = secs
      diskSpace.value = disk
      sectionsPayloadId.value = installationId
    } catch (e) {
      if (seq !== requestSeq) return
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (seq === requestSeq) loading.value = false
    }
    void window.api
      .getInstallationSize(installationId)
      .then((r) => {
        if (seq !== requestSeq) return
        installSize.value = typeof r?.sizeBytes === 'number' ? r.sizeBytes : null
      })
      .catch(() => {
        if (seq !== requestSeq) return
        installSize.value = null
      })
  }

  async function reload(): Promise<void> {
    const inst = toValue(opts.installation)
    if (!inst) {
      sections.value = []
      diskSpace.value = null
      installSize.value = null
      sectionsPayloadId.value = null
      lastLoadedId = null
      requestSeq++
      return
    }
    await loadAll(inst.id, inst.installPath ?? '')
  }

  async function refreshSection(sectionTitle: string | undefined): Promise<void> {
    if (!sectionTitle) {
      await reload()
      return
    }
    const inst = toValue(opts.installation)
    if (!inst) return
    const targetId = inst.id
    const seq = ++requestSeq
    try {
      const fresh = await window.api.getDetailSections(targetId)
      if (seq !== requestSeq || lastLoadedId !== targetId) return
      const updated = fresh.find((s) => s.title === sectionTitle)
      if (!updated) {
        sections.value = fresh
        return
      }
      const idx = sections.value.findIndex((s) => s.title === sectionTitle)
      if (idx >= 0) {
        sections.value.splice(idx, 1, updated)
      } else {
        sections.value = fresh
      }
    } catch (e) {
      if (seq !== requestSeq) return
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (seq === requestSeq) loading.value = false
    }
  }

  function restartFieldsEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (a == null || b == null) return false
    if (typeof a !== 'object' || typeof b !== 'object') return false
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const aKeys = Object.keys(ao)
    const bKeys = Object.keys(bo)
    if (aKeys.length !== bKeys.length) return false
    for (const k of aKeys) {
      if (ao[k] !== bo[k]) return false
    }
    return true
  }

  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error('timeout') as Error & { isTimeout?: boolean }
        err.isTimeout = true
        reject(err)
      }, ms)
    })
    return Promise.race([p, timeout]).finally(() => {
      if (timer) clearTimeout(timer)
    })
  }

  function findFieldInSections(fieldId: string): DetailField | null {
    for (const s of sections.value) {
      const f = s.fields?.find((x) => x.id === fieldId)
      if (f) return f as DetailField
    }
    return null
  }

  function setRestartDirty(installId: string, fieldId: string, baseline: unknown): void {
    const next = new Map(restartBaselines.value)
    const inner = new Map(next.get(installId) ?? new Map())
    if (!inner.has(fieldId)) inner.set(fieldId, baseline)
    next.set(installId, inner)
    restartBaselines.value = next
  }

  function clearRestartDirty(installId: string, fieldId: string): void {
    const inner = restartBaselines.value.get(installId)
    if (!inner || !inner.has(fieldId)) return
    const next = new Map(restartBaselines.value)
    const nextInner = new Map(inner)
    nextInner.delete(fieldId)
    if (nextInner.size === 0) next.delete(installId)
    else next.set(installId, nextInner)
    restartBaselines.value = next
  }

  function setFieldError(installId: string, fieldId: string, message: string): void {
    const next = new Map(errorMessages.value)
    const inner = new Map(next.get(installId) ?? new Map())
    inner.set(fieldId, message)
    next.set(installId, inner)
    errorMessages.value = next
    const timerKey = `${installId}:${fieldId}`
    const existing = errorClearTimers.get(timerKey)
    if (existing) clearTimeout(existing)
    errorClearTimers.set(
      timerKey,
      setTimeout(() => {
        clearFieldError(installId, fieldId)
      }, ERROR_TAG_TTL_MS)
    )
  }

  function clearFieldError(installId: string, fieldId: string): void {
    const timerKey = `${installId}:${fieldId}`
    const existing = errorClearTimers.get(timerKey)
    if (existing) {
      clearTimeout(existing)
      errorClearTimers.delete(timerKey)
    }
    const inner = errorMessages.value.get(installId)
    if (!inner || !inner.has(fieldId)) return
    const next = new Map(errorMessages.value)
    const nextInner = new Map(inner)
    nextInner.delete(fieldId)
    if (nextInner.size === 0) next.delete(installId)
    else next.set(installId, nextInner)
    errorMessages.value = next
  }

  async function updateField(field: DetailField, value: unknown): Promise<void> {
    const inst = toValue(opts.installation)
    if (!inst) return
    const installId = inst.id

    const liveField = findFieldInSections(field.id)
    const priorValue = liveField ? liveField.value : (field.value as unknown)
    if (liveField) liveField.value = value as DetailField['value']

    clearFieldError(installId, field.id)

    try {
      await withTimeout(
        window.api.updateInstallation(installId, { [field.id]: value }),
        UPDATE_TIMEOUT_MS
      )
    } catch (err: unknown) {
      const live = findFieldInSections(field.id)
      if (live) live.value = priorValue as DetailField['value']
      clearRestartDirty(installId, field.id)
      const isTimeout = (err as { isTimeout?: boolean })?.isTimeout === true
      const message = isTimeout
        ? t('comfyUISettings.updateFieldTimeout')
        : err instanceof Error
          ? err.message
          : String(err)
      setFieldError(installId, field.id, message)
      return
    }
    if (
      field.requiresRestart &&
      (sessionStore.isRunning(installId) || sessionStore.isLaunching(installId))
    ) {
      const baseline = restartBaselines.value.get(installId)?.get(field.id) ?? priorValue
      if (restartFieldsEqual(value, baseline)) {
        clearRestartDirty(installId, field.id)
      } else {
        setRestartDirty(installId, field.id, baseline)
      }
    }
    emitTelemetryAction('comfy.desktop.settings.changed', {
      setting_key: field.id,
      value_kind: field.editType || 'text',
      bool_value: typeof value === 'boolean' ? value : undefined
    })
    if (field.onChangeAction) {
      try {
        await window.api.runAction(inst.id, field.onChangeAction)
      } catch (err: unknown) {
        await dialogs.alert({
          title: t('common.error'),
          message: err instanceof Error ? err.message : String(err)
        })
      }
    }
    if (field.refreshSection) {
      const owningSection = sections.value.find((s) => s.fields?.some((f) => f.id === field.id))
      await refreshSection(owningSection?.title)
    } else {
      await reload()
    }
  }

  async function renameInstallation(newName: string): Promise<boolean> {
    const inst = toValue(opts.installation)
    if (!inst) return false
    const name = newName.trim()
    if (!name || name === inst.name) return false
    const result: ActionResult | void = await window.api.updateInstallation(inst.id, { name })
    if (result?.ok === false) {
      await dialogs.alert({ title: inst.name, message: result.message ?? '' })
      return false
    }
    await reload()
    return true
  }

  async function runAction(action: ActionDef): Promise<void> {
    const inst = toValue(opts.installation)
    if (!inst) return

    if (action.id === 'stop') {
      const stopped = await confirmAndStop(inst.id)
      if (stopped) opts.onDismissPreview?.()
      return
    }

    if (action.id === 'share') {
      const result = await shareLatestSnapshot(inst.id)
      if (!result.ok) {
        await dialogs.alert({
          title: action.label,
          message:
            result.reason === 'none'
              ? t('snapshots.noSnapshotsToShare', 'There are no snapshots to share yet.')
              : (result.message ?? t('snapshots.shareFailed', 'Could not share the snapshot.'))
        })
      }
      return
    }

    const telemetryContext = { action_id: action.id }

    const ownsPreflight = action.id === 'migrate-to-standalone'
    const requiresStoppedGuard = REQUIRES_STOPPED.has(action.id)
    const wasRunning = sessionStore.isRunning(inst.id)
    if (requiresStoppedGuard && !ownsPreflight) {
      const proceed = await actionGuard.checkBeforeAction(inst.id, action.label)
      if (!proceed) return
    }

    let mutableAction: ActionDef = { ...action }

    if (mutableAction.id === 'migrate-to-standalone') {
      const migrateResult = await confirmMigration(inst, mutableAction.confirm)
      if (!migrateResult) return
      mutableAction = {
        ...mutableAction,
        data: { ...mutableAction.data, ...migrateResult }
      }
    }

    if (requiresStoppedGuard && wasRunning && !ownsPreflight) {
      mutableAction = augmentActionWithStopWarning(
        mutableAction,
        t('errors.willStopRunning', { name: inst?.name || 'ComfyUI' })
      )
    }

    const afterFieldSelects = await runFieldSelectsChain(mutableAction, dialogs, t)
    if (!afterFieldSelects) return
    mutableAction = afterFieldSelects

    const afterSelect = await runSelectChain(mutableAction, inst.id, dialogs, t)
    if (!afterSelect) return
    mutableAction = afterSelect

    const afterPrompt = await runPromptChain(mutableAction, dialogs)
    if (!afterPrompt) return
    mutableAction = afterPrompt

    if (mutableAction.id !== 'migrate-to-standalone') {
      const afterConfirm = await runConfirmChain(mutableAction, modal, dialogs)
      if (!afterConfirm) return
      mutableAction = afterConfirm
    }

    if (!(await runDiskSpaceCheck(mutableAction, inst, modal, t, null, dialogs))) return

    if (mutableAction.showProgress) {
      const rawTitle = (mutableAction.progressTitle || mutableAction.label).replace(
        /\{(\w+)\}/g,
        (_, k: string) => String((mutableAction.data as Record<string, unknown>)?.[k] ?? k)
      )
      const title = `${rawTitle} — ${inst.name}`
      const isRestart = mutableAction.id === 'restart'
      const needsSelfStop = wasRunning && requiresStoppedGuard && !isRestart
      const wantsRelaunch = needsSelfStop && IN_PLACE_RELAUNCH.has(mutableAction.id)
      const isRunning = (): boolean => sessionStore.isRunning(inst.id)
      const apiCall = isRestart
        ? async (): Promise<ReturnType<typeof window.api.runAction>> => {
            await stopAndWaitForExit(inst.id, isRunning)
            return window.api.runAction(inst.id, 'launch')
          }
        : needsSelfStop
          ? async (): Promise<ReturnType<typeof window.api.runAction>> => {
              await stopAndWaitForExit(inst.id, isRunning)
              const result = await window.api.runAction(
                inst.id,
                mutableAction.id,
                mutableAction.data
              )
              if (wantsRelaunch && result?.ok !== false) {
                await window.api.runAction(inst.id, 'launch')
              }
              return result
            }
          : (): ReturnType<typeof window.api.runAction> =>
              window.api.runAction(inst.id, mutableAction.id, mutableAction.data)
      emitTelemetryAction('comfy.desktop.action.invoked', telemetryContext)
      opts.onShowProgress({
        installationId: inst.id,
        title,
        apiCall,
        cancellable: !!mutableAction.cancellable,
        returnTo: 'detail',
        triggersInstanceStart: mutableAction.id === 'launch' || isRestart || wantsRelaunch,
        opKind: isRestart ? 'launch' : progressOpKindForActionId(mutableAction.id),
        destroysInstance: destroysInstanceForActionId(mutableAction.id),
        actionId: mutableAction.id,
        actionData: mutableAction.data
      })
      return
    }

    runningActionIds.value = new Set(runningActionIds.value).add(mutableAction.id)
    const busyStartedAt = Date.now()
    try {
      emitTelemetryAction('comfy.desktop.action.invoked', telemetryContext)
      if (wasRunning && requiresStoppedGuard) {
        await stopAndWaitForExit(inst.id, () => sessionStore.isRunning(inst.id))
      }
      const result = await window.api.runAction(inst.id, mutableAction.id, mutableAction.data)
      if (result.running) {
        await actionGuard.checkBeforeAction(inst.id, mutableAction.label)
        return
      }
      const resultValue = result.cancelled ? 'cancelled' : result.ok === false ? 'failed' : 'ok'
      emitTelemetryAction('comfy.desktop.action.result', {
        result: resultValue,
        ...telemetryContext
      })
      if (result.navigate === 'list') {
        opts.onClose?.()
        opts.onNavigateList?.()
      } else if (result.navigate === 'detail') {
        await reload()
        if (result.message) {
          flashNotice(result.message)
        }
      } else if (result.message) {
        await dialogs.alert({ title: mutableAction.label, message: result.message })
      } else {
        await reload()
      }
    } catch (err: unknown) {
      emitTelemetryAction('comfy.desktop.action.result', {
        result: 'failed',
        error_bucket: toErrorBucket(err),
        ...telemetryContext
      })
      await dialogs.alert({
        title: mutableAction.label,
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      await sleepRemainder(busyStartedAt)
      const next = new Set(runningActionIds.value)
      next.delete(mutableAction.id)
      runningActionIds.value = next
    }
  }

  function sectionsForTab(tab: SectionTab): ComputedRef<DetailSection[]> {
    return computed(() => sections.value.filter((s) => s.tab === tab && !s.pinBottom))
  }

  const pinBottomSection = computed<DetailSection | null>(
    () => sections.value.find((s) => s.pinBottom) ?? null
  )

  const pinBottomActions = computed<ActionDef[]>(() => {
    const acts = (pinBottomSection.value?.actions ?? []).filter(
      (a) => a.id !== 'launch' && a.id !== 'restart'
    )
    const inst = toValue(opts.installation)
    if (!inst) return acts
    if (inst.sourceCategory !== 'cloud' && sessionStore.isRunning(inst.id)) {
      const stopAction: ActionDef = {
        id: 'stop',
        label: t('actions.stop', 'Stop'),
        style: 'danger',
        enabled: true
      }
      const firstDanger = acts.findIndex((a) => a.style === 'danger')
      if (firstDanger === -1) acts.push(stopAction)
      else acts.splice(firstDanger, 0, stopAction)
    }
    return acts
  })

  const diskUsageItem = computed<{ label: string; value: string } | null>(() => {
    if (installSize.value !== null) {
      return {
        label: t('comfyUISettings.diskUsage', 'Disk Usage'),
        value: formatBytes(installSize.value)
      }
    }
    if (!diskSpace.value) return null
    return {
      label: t('comfyUISettings.diskUsage', 'Disk Usage'),
      value: '—'
    }
  })

  const pendingRestartFieldIds = computed<Set<string>>(() => {
    const inst = toValue(opts.installation)
    if (!inst) return new Set()
    const inner = restartBaselines.value.get(inst.id)
    return inner ? new Set(inner.keys()) : new Set()
  })

  const fieldErrorMessages = computed<Map<string, string>>(() => {
    const inst = toValue(opts.installation)
    if (!inst) return new Map()
    return errorMessages.value.get(inst.id) ?? new Map()
  })

  watch(
    () => toValue(opts.installation)?.id ?? null,
    () => {
      void reload()
    },
    { immediate: true }
  )

  const offReleaseEnriched = window.api.onReleaseCacheEnriched?.(() => {
    if (toValue(opts.installation)) void reload()
  })
  onScopeDispose(() => {
    offReleaseEnriched?.()
    if (noticeTimer) clearTimeout(noticeTimer)
  })

  watch(
    () => {
      const inst = toValue(opts.installation)
      return !!inst && sessionStore.operationInstances.has(inst.id)
    },
    (active, wasActive) => {
      if (wasActive && !active && runningActionIds.value.size === 0) void reload()
    }
  )

  function clearRestartAndErrors(installId: string): void {
    if (restartBaselines.value.has(installId)) {
      const next = new Map(restartBaselines.value)
      next.delete(installId)
      restartBaselines.value = next
    }
    if (errorMessages.value.has(installId)) {
      const next = new Map(errorMessages.value)
      next.delete(installId)
      errorMessages.value = next
    }
  }

  watch(
    () => {
      const inst = toValue(opts.installation)
      if (!inst || !sessionStore.isRunning(inst.id)) return null
      return `${inst.id}\0${sessionStore.runningInstances.get(inst.id)?.startedAt ?? ''}`
    },
    (session, previous) => {
      const inst = toValue(opts.installation)
      if (!inst) return
      const sameInstall = session?.split('\0')[0] === previous?.split('\0')[0]
      if (session && previous && sameInstall && session !== previous) clearRestartAndErrors(inst.id)
      void reload()
    }
  )

  watch(
    () => [...sessionStore.runningInstances.keys()],
    (runningIds, prevIds) => {
      const running = new Set(runningIds)
      for (const id of prevIds) {
        if (!running.has(id)) clearRestartAndErrors(id)
      }
    }
  )

  watch(
    () => [...sessionStore.launchingInstances.keys()],
    (launchingIds, prevIds) => {
      const launching = new Set(launchingIds)
      const prev = new Set(prevIds)
      for (const id of launching) {
        if (!prev.has(id)) clearRestartAndErrors(id)
      }
      for (const id of prev) {
        if (!launching.has(id) && !sessionStore.isRunning(id)) {
          clearRestartAndErrors(id)
        }
      }
    }
  )

  const sectionsFresh = computed<boolean>(() => {
    const inst = toValue(opts.installation)
    return !!inst && sectionsPayloadId.value === inst.id
  })

  return {
    sections,
    diskSpace,
    loading,
    error,
    sectionsFresh,
    notice,
    reload,
    refreshSection,
    updateField,
    renameInstallation,
    pendingRestartFieldIds,
    clearPendingRestart: clearRestartAndErrors,
    fieldErrorMessages,
    runAction,
    runningActionIds,
    sectionsForTab,
    diskUsageItem,
    pinBottomSection,
    pinBottomActions
  }
}
