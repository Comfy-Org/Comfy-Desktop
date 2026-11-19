import { computed, ref, type Ref, type ShallowRef } from 'vue'
import type TemplatePickerStep from '../components/TemplatePickerStep.vue'
import { fileName } from '../lib/performanceTestResults'
import { usePerformanceTestExampleWorkflow } from './usePerformanceTestExampleWorkflow'

export type PerformanceTestWorkflowSource = 'example' | 'api'

interface PerformanceTestWorkflowContext {
  picker: Readonly<ShallowRef<InstanceType<typeof TemplatePickerStep> | null>>
  selectedInstallationId: Ref<string | null>
  isSelectedInstallationInstalled: Readonly<Ref<boolean>>
  isLocked: Readonly<Ref<boolean>>
  t: (key: string) => string
}

export function usePerformanceTestWorkflow(context: PerformanceTestWorkflowContext) {
  const { isLocked, t } = context
  const filePath = ref<string | null>(null)
  const error = ref<string | null>(null)
  const isImporting = ref(false)
  const isDeleting = ref(false)

  const example = usePerformanceTestExampleWorkflow({
    picker: context.picker,
    selectedInstallationId: context.selectedInstallationId,
    isSelectedInstallationInstalled: context.isSelectedInstallationInstalled,
    workflowFilePath: filePath,
    workflowError: error,
    isWorkflowImporting: isImporting,
    isWorkflowLocked: isLocked,
    deleteWorkflow: remove,
    t
  })

  const source = computed<PerformanceTestWorkflowSource | null>(() => {
    if (example.pendingLabel.value) return 'example'
    if (!filePath.value) return null
    return example.displayName.value === null ? 'api' : 'example'
  })
  const label = computed(
    () =>
      example.pendingLabel.value ??
      example.displayName.value ??
      (filePath.value ? fileName(filePath.value) : '')
  )
  const telemetryName = computed(() =>
    example.displayName.value === null || !filePath.value ? 'custom' : fileName(filePath.value)
  )
  const isReady = computed(() =>
    Boolean(
      filePath.value &&
      !isImporting.value &&
      !isDeleting.value &&
      !example.download.value &&
      !example.isForOtherInstallation.value
    )
  )

  async function importFrom(sourcePath?: string): Promise<void> {
    if (isImporting.value || isDeleting.value || isLocked.value) return
    isImporting.value = true
    error.value = null
    try {
      const result = await window.api.importPerformanceTestWorkflow(sourcePath)
      if (result.ok && result.filePath) {
        example.release()
        filePath.value = result.filePath
      } else if (!result.canceled) {
        error.value = result.message || t('performanceTest.importFailed')
      }
    } catch (cause) {
      error.value = (cause as Error)?.message || t('performanceTest.importFailed')
    } finally {
      isImporting.value = false
    }
  }

  async function importFile(file: File): Promise<void> {
    const sourcePath = window.api.getPathForFile(file)
    if (sourcePath) await importFrom(sourcePath)
  }

  async function remove(): Promise<void> {
    const removing = filePath.value
    if (!removing || isDeleting.value || isLocked.value) return
    isDeleting.value = true
    error.value = null
    try {
      const result = await window.api.deletePerformanceTestWorkflow(removing)
      if (result.ok) {
        if (filePath.value === removing) {
          filePath.value = null
          example.clearState()
        }
        if (result.status === 'preserved') {
          error.value = result.message || t('performanceTest.deleteFailed')
        }
      } else {
        error.value = result.message || t('performanceTest.deleteFailed')
      }
    } catch (cause) {
      error.value = (cause as Error)?.message || t('performanceTest.deleteFailed')
    } finally {
      isDeleting.value = false
    }
  }

  return {
    filePath,
    error,
    isImporting,
    isDeleting,
    source,
    label,
    telemetryName,
    isReady,
    importFrom,
    importFile,
    remove,
    example
  }
}
