import { computed, onUnmounted, ref, watch, type Ref, type ShallowRef } from 'vue'
import type TemplatePickerStep from '../components/TemplatePickerStep.vue'
import type { DiskSpaceInfo, ExampleWorkflowDownload, FieldOption } from '../types/ipc'

interface ExampleWorkflowContext {
  picker: Readonly<ShallowRef<InstanceType<typeof TemplatePickerStep> | null>>
  selectedInstallationId: Ref<string | null>
  isSelectedInstallationInstalled: Ref<boolean>
  workflowFilePath: Ref<string | null>
  workflowError: Ref<string | null>
  isWorkflowImporting: Ref<boolean>
  isWorkflowLocked: Ref<boolean>
  deleteWorkflow: () => Promise<void>
  t: (key: string) => string
}

export function usePerformanceTestExampleWorkflow(context: ExampleWorkflowContext) {
  const { selectedInstallationId, workflowFilePath, workflowError, isWorkflowImporting, t } =
    context

  const options = ref<FieldOption[]>([])
  const diskSpace = ref<DiskSpaceInfo | null>(null)
  const selectedId = ref<string | null>(null)
  const isPickerOpen = ref(false)
  const isPickerLoading = ref(false)
  const diskError = computed(() => context.picker.value?.shownDiskError ?? null)
  const pendingLabel = ref<string | null>(null)
  const displayName = ref<string | null>(null)
  const preparedForInstallationId = ref<string | null>(null)
  const download = ref<ExampleWorkflowDownload | null>(null)
  let isUnmounted = false

  function clearState(): void {
    download.value = null
    displayName.value = null
    preparedForInstallationId.value = null
    selectedId.value = null
  }

  function abandon(filePath: string): void {
    void window.api.deletePerformanceTestWorkflow(filePath).catch(() => {})
  }

  function release(): void {
    if (download.value && workflowFilePath.value) abandon(workflowFilePath.value)
    clearState()
  }

  async function applyDownload(current: ExampleWorkflowDownload | undefined): Promise<void> {
    if (current?.status === 'resolving' || current?.status === 'downloading') {
      download.value = current
      return
    }
    download.value = null
    if (current?.status === 'error') {
      const message =
        current.error === 'insufficient-disk'
          ? t('performanceTest.exampleModelsNoSpace')
          : t('performanceTest.exampleModelsFailed')
      await context.deleteWorkflow()
      workflowError.value = message
    }
  }

  let latestPush: { filePath: string; download: ExampleWorkflowDownload } | null = null
  const unsubscribeDownload = window.api.onPerformanceTestExampleDownload((push) => {
    latestPush = push
    if (isUnmounted || !download.value || workflowFilePath.value !== push.filePath) return
    void applyDownload(push.download)
  })

  async function openPicker(): Promise<void> {
    const installationId = selectedInstallationId.value
    if (!installationId || context.isWorkflowLocked.value || isWorkflowImporting.value) return
    if (!context.isSelectedInstallationInstalled.value) {
      workflowError.value = t('performanceTest.exampleWorkflowsNeedInstall')
      return
    }
    if (!navigator.onLine) {
      workflowError.value = t('performanceTest.exampleWorkflowsOffline')
      return
    }
    isPickerLoading.value = true
    workflowError.value = null
    try {
      const catalog = await window.api.getPerformanceTestExampleWorkflows(installationId)
      options.value = catalog.options
      diskSpace.value = catalog.diskSpace
      if (catalog.options.length === 0) {
        workflowError.value = t('performanceTest.noExampleWorkflows')
        return
      }
      selectedId.value =
        catalog.options.find((option) => option.value === selectedId.value)?.value ??
        catalog.options.find((option) => option.recommended)?.value ??
        catalog.options[0]!.value
      isPickerOpen.value = true
    } catch (error) {
      console.warn('[performance-test] Could not list the example workflows:', error)
      workflowError.value = t('performanceTest.importFailed')
    } finally {
      isPickerLoading.value = false
    }
  }

  async function prepare(): Promise<void> {
    const installationId = selectedInstallationId.value
    const templateId = selectedId.value
    const option = options.value.find(({ value }) => value === templateId)
    if (!installationId || !templateId || !option || isWorkflowImporting.value) return

    const previousPath = workflowFilePath.value
    isPickerOpen.value = false
    isWorkflowImporting.value = true
    workflowError.value = null
    pendingLabel.value = option.label
    try {
      const result = await window.api.preparePerformanceTestExampleWorkflow(
        installationId,
        templateId
      )
      if (!result.ok || !result.filePath) {
        console.warn('[performance-test] Could not prepare the example workflow:', result.message)
        workflowError.value =
          result.reason === 'offline'
            ? t('performanceTest.exampleWorkflowsOffline')
            : result.reason === 'unavailable'
              ? t('performanceTest.exampleWorkflowUnavailable')
              : t('performanceTest.importFailed')
        return
      }
      if (isUnmounted || selectedInstallationId.value !== installationId) {
        abandon(result.filePath)
        return
      }
      clearState()
      workflowFilePath.value = result.filePath
      displayName.value = option.label
      preparedForInstallationId.value = installationId
      selectedId.value = templateId
      if (previousPath && previousPath !== result.filePath) abandon(previousPath)
      const pushed = latestPush?.filePath === result.filePath ? latestPush.download : undefined
      latestPush = null
      await applyDownload(pushed ?? result.download)
    } catch (error) {
      console.warn('[performance-test] Could not prepare the example workflow:', error)
      workflowError.value = t('performanceTest.importFailed')
    } finally {
      pendingLabel.value = null
      isWorkflowImporting.value = false
    }
  }

  const isForOtherInstallation = computed(() =>
    Boolean(
      workflowFilePath.value &&
      preparedForInstallationId.value &&
      preparedForInstallationId.value !== selectedInstallationId.value
    )
  )

  watch(
    () => isForOtherInstallation.value && !context.isWorkflowLocked.value,
    (shouldRemove) => {
      if (shouldRemove) void context.deleteWorkflow()
    }
  )

  onUnmounted(() => {
    isUnmounted = true
    unsubscribeDownload()
    if (download.value && workflowFilePath.value) abandon(workflowFilePath.value)
  })

  return {
    options,
    diskSpace,
    selectedId,
    isPickerOpen,
    isPickerLoading,
    diskError,
    pendingLabel,
    displayName,
    download,
    isForOtherInstallation,
    openPicker,
    prepare,
    release,
    clearState
  }
}
