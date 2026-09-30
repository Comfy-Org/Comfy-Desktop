import { computed, onUnmounted, ref, watch, type Ref, type ShallowRef } from 'vue'
import type TemplatePickerStep from '../components/TemplatePickerStep.vue'
import type { DiskSpaceInfo, ExampleWorkflowDownload, FieldOption } from '../types/ipc'

interface ExampleWorkflowContext {
  /** The page's example picker, which owns the disk-space rule. */
  picker: Readonly<ShallowRef<InstanceType<typeof TemplatePickerStep> | null>>
  selectedInstallationId: Ref<string | null>
  isSelectedInstallationInstalled: Ref<boolean>
  /** The page's current workflow, whichever way it was chosen. */
  workflowFilePath: Ref<string | null>
  workflowError: Ref<string | null>
  isWorkflowImporting: Ref<boolean>
  isWorkflowLocked: Ref<boolean>
  deleteWorkflow: () => Promise<void>
  t: (key: string) => string
}

/**
 * Example workflows on the performance test page: the picker, preparing the
 * chosen example, and following its model download until the test can run.
 */
export function usePerformanceTestExampleWorkflow(context: ExampleWorkflowContext) {
  const { selectedInstallationId, workflowFilePath, workflowError, isWorkflowImporting, t } =
    context

  const options = ref<FieldOption[]>([])
  const diskSpace = ref<DiskSpaceInfo | null>(null)
  const selectedId = ref<string | null>(null)
  const isPickerOpen = ref(false)
  const isPickerLoading = ref(false)
  const diskError = computed(() => context.picker.value?.shownDiskError ?? null)
  /** Label of the example being prepared, until its download reports progress. */
  const pendingLabel = ref<string | null>(null)
  /** Label of the prepared example, shown instead of its file name. */
  const displayName = ref<string | null>(null)
  /** Installation the prepared example's models are downloaded for. */
  const preparedForInstallationId = ref<string | null>(null)
  /** Model download of the prepared example; the test can't run until it finishes. */
  const download = ref<ExampleWorkflowDownload | null>(null)
  let isUnmounted = false

  function clearState(): void {
    download.value = null
    displayName.value = null
    preparedForInstallationId.value = null
    selectedId.value = null
  }

  /** Delete a workflow nobody follows any more; the main process stops its download. */
  function abandon(filePath: string): void {
    void window.api.deletePerformanceTestWorkflow(filePath).catch(() => {})
  }

  /** Before another workflow replaces the prepared example: abandon its unfinished download. */
  function release(): void {
    if (download.value && workflowFilePath.value) abandon(workflowFilePath.value)
    clearState()
  }

  /** Show the model download's progress; a failed download removes the workflow. */
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

  /** Latest push, for `prepare`: a download can settle before its reply arrives. */
  let latestPush: { filePath: string; download: ExampleWorkflowDownload } | null = null
  // The main process pushes progress until the download settles.
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
        // The main process's detail is English and technical ("HTTP 429"): log it.
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
      // A push that beat the reply is newer than the reply's snapshot.
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

  /** The prepared example was downloaded for another instance; it must not run on this one. */
  const isForOtherInstallation = computed(() =>
    Boolean(
      workflowFilePath.value &&
      preparedForInstallationId.value &&
      preparedForInstallationId.value !== selectedInstallationId.value
    )
  )

  // Remove it as soon as nothing holds the workflow: a launching or stopping test
  // defers the removal until the lock clears.
  watch(
    () => isForOtherInstallation.value && !context.isWorkflowLocked.value,
    (shouldRemove) => {
      if (shouldRemove) void context.deleteWorkflow()
    }
  )

  onUnmounted(() => {
    isUnmounted = true
    unsubscribeDownload()
    // Leaving the page abandons an unfinished example and stops its model download.
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
