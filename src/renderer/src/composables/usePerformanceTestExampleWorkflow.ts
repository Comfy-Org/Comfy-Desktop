import { computed, onUnmounted, ref, watch, type Ref, type ShallowRef } from 'vue'
import type TemplatePickerStep from '../components/TemplatePickerStep.vue'
import type { DiskSpaceInfo, ExampleWorkflowDownload, FieldOption } from '../types/ipc'

const DOWNLOAD_POLL_MS = 500

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
  let downloadTimer: ReturnType<typeof setTimeout> | undefined
  let isUnmounted = false

  function clearState(): void {
    clearTimeout(downloadTimer)
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

  function scheduleFollow(filePath: string): void {
    downloadTimer = setTimeout(() => void followDownload(filePath), DOWNLOAD_POLL_MS)
  }

  /** Poll the model download until it settles; a failed download removes the workflow. */
  async function followDownload(filePath: string): Promise<void> {
    let current: ExampleWorkflowDownload | null
    try {
      current = await window.api.getPerformanceTestExampleDownload(filePath)
    } catch {
      // A failed read says nothing about the download: keep the test blocked and ask again.
      if (isUnmounted || workflowFilePath.value !== filePath) return
      download.value ??= {
        status: 'resolving',
        percent: -1,
        message: t('performanceTest.preparingExampleWorkflow')
      }
      scheduleFollow(filePath)
      return
    }
    if (isUnmounted || workflowFilePath.value !== filePath) return
    if (current?.status === 'resolving' || current?.status === 'downloading') {
      download.value = current
      scheduleFollow(filePath)
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
      workflowError.value = (error as Error)?.message || t('performanceTest.importFailed')
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
        throw new Error(
          result.reason === 'offline'
            ? t('performanceTest.exampleWorkflowsOffline')
            : result.reason === 'unavailable'
              ? t('performanceTest.exampleWorkflowUnavailable')
              : result.message || t('performanceTest.importFailed')
        )
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
      // Keeps the "preparing" label (and the run blocked) until real progress arrives.
      await followDownload(result.filePath)
    } catch (error) {
      workflowError.value = (error as Error)?.message || t('performanceTest.importFailed')
    } finally {
      pendingLabel.value = null
      isWorkflowImporting.value = false
    }
  }

  watch(selectedInstallationId, (installationId) => {
    if (
      preparedForInstallationId.value &&
      preparedForInstallationId.value !== installationId &&
      workflowFilePath.value
    ) {
      void context.deleteWorkflow()
    }
  })

  onUnmounted(() => {
    isUnmounted = true
    clearTimeout(downloadTimer)
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
    openPicker,
    prepare,
    release,
    clearState
  }
}
