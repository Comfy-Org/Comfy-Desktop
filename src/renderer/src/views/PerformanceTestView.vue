<script setup lang="ts">
import { computed, nextTick, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, Trash2 } from 'lucide-vue-next'
import BrandBackground from '../components/BrandBackground.vue'
import ComfyWordmark from '../components/icons/ComfyWordmark.vue'
import BaseSelect, { type BaseSelectOption } from '../components/ui/BaseSelect.vue'
import { useWorkspaceInstallScope } from '../composables/useWorkspaceInstallScope'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type { ActionResult } from '../types/ipc'
import DevPlatformAccountChip from './devplatform/DevPlatformAccountChip.vue'

const { t } = useI18n()
const authStore = useAuthStore()
const installationStore = useInstallationStore()
const sessionStore = useSessionStore()
const unmanagedWorkspaceValue = '__unmanaged__'
const { selectedWorkspaceId, scopedInstallations } = useWorkspaceInstallScope(
  toRef(installationStore, 'installations')
)
const workspaceOptions = computed<BaseSelectOption[]>(() => {
  const options = authStore.workspaces.map((workspace) => ({
    value: workspace.id,
    label: workspace.type === 'team' ? workspace.name : t('devPlatform.workspace.personalLabel')
  }))
  const currentWorkspaceId = selectedWorkspaceId.value

  if (currentWorkspaceId && !options.some((workspace) => workspace.value === currentWorkspaceId)) {
    options.unshift({
      value: currentWorkspaceId,
      label:
        authStore.status.workspaceType === 'team'
          ? authStore.status.workspaceName || t('devPlatform.workspace.currentFallback')
          : t('devPlatform.workspace.personalLabel')
    })
  }

  return [
    {
      value: unmanagedWorkspaceValue,
      label: t('devPlatform.workspace.unmanagedLabel')
    },
    ...options
  ]
})
const performanceTestInstallations = computed(() =>
  scopedInstallations.value.filter((installation) => installation.sourceCategory !== 'cloud')
)
const instanceOptions = computed<BaseSelectOption[]>(() =>
  performanceTestInstallations.value.map((installation) => ({
    value: installation.id,
    label: installation.name,
    description: [installation.sourceLabel, installation.version].filter(Boolean).join(' · ')
  }))
)
const selectedInstallationId = ref<string | null>(null)
const workflowFilePath = ref<string | null>(null)
const workflowImportError = ref<string | null>(null)
const isWorkflowDragging = ref(false)
const isWorkflowImporting = ref(false)
const isWorkflowDeleting = ref(false)
const isLaunching = ref(false)
const isStopping = ref(false)
const logsExpanded = ref(true)
const resultsExpanded = ref(true)
const warmupRuns = ref('1')
const measuredRuns = ref('5')
const logInstallationId = ref<string | null>(null)
const performanceTestInstallationId = ref<string | null>(null)
const logsElement = ref<HTMLElement | null>(null)
type PerformanceTestRunResult = Awaited<ReturnType<typeof window.api.runPerformanceTestWorkflow>>
const performanceTestResult = ref<PerformanceTestRunResult | null>(null)
const performanceTestLogs = computed(() => {
  if (!logInstallationId.value) return ''
  return sessionStore.getSession(logInstallationId.value)?.output ?? ''
})
const aggregateChart = computed(() => {
  const statistics = performanceTestResult.value?.statistics
  if (!statistics) return []

  const aggregates = [
    {
      label: t('performanceTest.fastestRun'),
      value: statistics.fastest.durationSeconds
    },
    {
      label: t('performanceTest.slowestRun'),
      value: statistics.slowest.durationSeconds
    },
    {
      label: t('performanceTest.averageRunDuration'),
      value: statistics.averageDurationSeconds
    },
    {
      label: t('performanceTest.medianRunDuration'),
      value: statistics.medianDurationSeconds
    }
  ]
  const maximum = Math.max(...aggregates.map(({ value }) => value), 0)

  return aggregates.map((aggregate) => ({
    ...aggregate,
    width: maximum > 0 ? `${(aggregate.value / maximum) * 100}%` : '0%'
  }))
})
const workflowFileName = computed(() => workflowFilePath.value?.split(/[\\/]/).pop() ?? '')
const performanceTestSessionId = (installationId: string): string =>
  `performance-test:${installationId}`
const canRun = computed(() => {
  const installationId = selectedInstallationId.value
  const sessionId = installationId ? performanceTestSessionId(installationId) : ''
  return Boolean(
    installationId &&
    workflowFilePath.value &&
    !isLaunching.value &&
    !isStopping.value &&
    !sessionStore.isLaunching(sessionId)
  )
})
const canStop = computed(() => {
  return Boolean(performanceTestInstallationId.value && !isStopping.value)
})
let activeLaunchPromise: Promise<ActionResult> | null = null

watch(selectedWorkspaceId, () => {
  selectedInstallationId.value = null
})

watch(
  () => authStore.isSignedIn,
  (signedIn) => {
    if (signedIn && authStore.workspaces.length === 0 && !authStore.loadingWorkspaces) {
      void authStore.fetchWorkspaces().catch(() => {})
    }
  },
  { immediate: true }
)

function selectWorkspace(workspaceId: string): void {
  selectedWorkspaceId.value = workspaceId === unmanagedWorkspaceValue ? null : workspaceId
}

function correctRunCount(
  value: string,
  minimum: number,
  maximum: number,
  fallback: number
): string {
  const rawValue = String(value).trim()
  const parsedValue = rawValue === '' ? Number.NaN : Number(rawValue)
  return String(
    Number.isFinite(parsedValue)
      ? Math.min(maximum, Math.max(minimum, Math.round(parsedValue)))
      : fallback
  )
}

function correctWarmupRuns(): void {
  warmupRuns.value = correctRunCount(warmupRuns.value, 1, 5, 1)
}

function correctMeasuredRuns(): void {
  measuredRuns.value = correctRunCount(measuredRuns.value, 1, 100, 5)
}

async function importWorkflow(sourcePath?: string): Promise<void> {
  if (isWorkflowImporting.value || isWorkflowDeleting.value) return
  isWorkflowImporting.value = true
  workflowImportError.value = null
  try {
    const result = await window.api.importPerformanceTestWorkflow(sourcePath)
    if (result.ok && result.filePath) {
      workflowFilePath.value = result.filePath
    } else if (!result.canceled) {
      workflowImportError.value = result.message || t('performanceTest.importFailed')
    }
  } catch (error) {
    workflowImportError.value = (error as Error)?.message || t('performanceTest.importFailed')
  } finally {
    isWorkflowImporting.value = false
  }
}

async function deleteWorkflow(): Promise<void> {
  const filePath = workflowFilePath.value
  if (!filePath || isWorkflowDeleting.value) return
  isWorkflowDeleting.value = true
  workflowImportError.value = null
  try {
    const result = await window.api.deletePerformanceTestWorkflow(filePath)
    if (result.ok) {
      if (workflowFilePath.value === filePath) workflowFilePath.value = null
    } else {
      workflowImportError.value = result.message || t('performanceTest.deleteFailed')
    }
  } catch (error) {
    workflowImportError.value = (error as Error)?.message || t('performanceTest.deleteFailed')
  } finally {
    isWorkflowDeleting.value = false
  }
}

async function dropWorkflow(event: DragEvent): Promise<void> {
  isWorkflowDragging.value = false
  const file = event.dataTransfer?.files[0]
  if (!file) return
  const sourcePath = window.api.getPathForFile(file)
  if (!sourcePath) return
  await importWorkflow(sourcePath)
}

async function runPerformanceTest(): Promise<void> {
  const installationId = selectedInstallationId.value
  const filePath = workflowFilePath.value
  if (!installationId || !filePath || isLaunching.value) return

  correctWarmupRuns()
  correctMeasuredRuns()
  const warmups = Number(warmupRuns.value)
  const runs = Number(measuredRuns.value)
  const sessionId = performanceTestSessionId(installationId)
  isLaunching.value = true
  performanceTestResult.value = null
  logInstallationId.value = sessionId
  performanceTestInstallationId.value = installationId
  sessionStore.startSession(sessionId)
  try {
    if (!sessionStore.isRunning(sessionId)) {
      const launchPromise = window.api.runAction(installationId, 'launch', {
        launchModeOverride: 'console',
        autoPortOnConflict: true,
        sessionIdOverride: sessionId
      })
      activeLaunchPromise = launchPromise
      const result = await launchPromise
      activeLaunchPromise = null
      if (!result.ok && !result.cancelled) {
        sessionStore.appendOutput(sessionId, result.message || t('performanceTest.launchFailed'))
      }
      if (!result.ok) {
        performanceTestInstallationId.value = null
        return
      }
    }

    sessionStore.appendOutput(
      sessionId,
      `\n${t('performanceTest.submittingRuns', {
        count: runs,
        warmupCount: warmups
      })}\n`
    )
    try {
      const submission = await window.api.runPerformanceTestWorkflow(
        sessionId,
        filePath,
        runs,
        warmups
      )
      if (submission.ok) performanceTestResult.value = submission
      sessionStore.appendOutput(
        sessionId,
        submission.ok
          ? `${t('performanceTest.completedRuns', {
              count: submission.submitted,
              unsuccessful: submission.unsuccessfulJobs,
              path: submission.resultPath
            })}\n`
          : `${submission.message || t('performanceTest.submitFailed')}\n`
      )
      if (submission.ok) await stopPerformanceTest()
    } catch (error) {
      sessionStore.appendOutput(
        sessionId,
        `${(error as Error)?.message || t('performanceTest.submitFailed')}\n`
      )
    }
  } catch (error) {
    sessionStore.appendOutput(
      sessionId,
      (error as Error)?.message || t('performanceTest.launchFailed')
    )
    performanceTestInstallationId.value = null
  } finally {
    activeLaunchPromise = null
    isLaunching.value = false
  }
}

function formatDuration(seconds: number): string {
  return `${seconds.toFixed(3)} s`
}

function formatOperatingSystem(info: NonNullable<PerformanceTestRunResult['systemInfo']>): string {
  return (
    [info.os_distro, info.os_release].filter(Boolean).join(' ') ||
    `${info.platform} ${info.os_version}`
  )
}

function getGpuDriver(info: NonNullable<PerformanceTestRunResult['systemInfo']>): string | null {
  return info.nvidia_driver_version ?? info.amd_driver_version ?? info.intel_driver_version
}

async function stopPerformanceTest(): Promise<void> {
  const installationId = performanceTestInstallationId.value
  if (!installationId || !canStop.value) return
  const sessionId = performanceTestSessionId(installationId)

  isStopping.value = true
  try {
    if (activeLaunchPromise) {
      await window.api.cancelOperation(sessionId)
      await activeLaunchPromise.catch(() => undefined)
    }
    await window.api.stopComfyUI(sessionId)
    if (performanceTestInstallationId.value === installationId)
      performanceTestInstallationId.value = null
  } catch (error) {
    sessionStore.appendOutput(
      sessionId,
      `\n${(error as Error)?.message || t('performanceTest.stopFailed')}\n`
    )
  } finally {
    isStopping.value = false
  }
}

async function toggleLogs(): Promise<void> {
  logsExpanded.value = !logsExpanded.value
  if (logsExpanded.value) {
    await nextTick()
    if (logsElement.value) logsElement.value.scrollTop = logsElement.value.scrollHeight
  }
}

watch(performanceTestLogs, async () => {
  await nextTick()
  if (logsElement.value) logsElement.value.scrollTop = logsElement.value.scrollHeight
})
</script>

<template>
  <BrandBackground class="performance-test" data-testid="performance-test">
    <div class="performance-test__layout">
      <div class="performance-test__intro">
        <ComfyWordmark
          class="performance-test__wordmark"
          data-testid="performance-test-logo"
          aria-hidden="true"
        />
        <p class="performance-test__description">
          {{ t('performanceTest.description') }}
        </p>
        <div v-if="authStore.isSignedIn" class="performance-test__content">
          <div class="performance-test__columns">
            <section class="performance-test__column">
              <h2>{{ t('performanceTest.selectInstance') }}</h2>
              <div class="performance-test__selection-row">
                <span class="performance-test__selection-label">
                  {{ t('performanceTest.workspaceLabel') }}
                </span>
                <div class="performance-test__selection-control performance-test__workspace-select">
                  <BaseSelect
                    :model-value="selectedWorkspaceId ?? unmanagedWorkspaceValue"
                    :options="workspaceOptions"
                    :aria-label="t('performanceTest.workspaceLabel')"
                    :loading="authStore.loadingWorkspaces"
                    :loading-label="t('common.loading')"
                    @update:model-value="selectWorkspace"
                  />
                </div>
              </div>
              <div class="performance-test__selection-row">
                <span class="performance-test__selection-label">
                  {{ t('performanceTest.instanceLabel') }}
                </span>
                <div class="performance-test__selection-control performance-test__instance-select">
                  <BaseSelect
                    :model-value="selectedInstallationId ?? ''"
                    :options="instanceOptions"
                    :placeholder="t('performanceTest.selectInstancePlaceholder')"
                    :aria-label="t('performanceTest.selectInstancePlaceholder')"
                    :disabled="instanceOptions.length === 0"
                    @update:model-value="selectedInstallationId = $event"
                  />
                </div>
              </div>
            </section>

            <section class="performance-test__column">
              <h2>{{ t('performanceTest.dropWorkflow') }}</h2>
              <div
                class="performance-test__drop-zone"
                :class="{
                  'performance-test__drop-zone--dragging': isWorkflowDragging,
                  'performance-test__drop-zone--selected': workflowFilePath
                }"
                :aria-busy="isWorkflowImporting || isWorkflowDeleting"
                @dragenter.prevent="isWorkflowDragging = true"
                @dragover.prevent="isWorkflowDragging = true"
                @dragleave.prevent="isWorkflowDragging = false"
                @drop.prevent="dropWorkflow"
              >
                <button
                  class="performance-test__drop-content"
                  type="button"
                  @click="importWorkflow()"
                >
                  <span v-if="!workflowFilePath">
                    {{
                      isWorkflowImporting
                        ? t('performanceTest.importingWorkflow')
                        : t('performanceTest.dropWorkflowHint')
                    }}
                  </span>
                  <span v-else class="performance-test__workflow-file">
                    <strong>{{ workflowFileName }}</strong>
                    <code>{{ workflowFilePath }}</code>
                  </span>
                </button>
                <button
                  v-if="workflowFilePath"
                  class="performance-test__delete-workflow"
                  type="button"
                  :aria-label="t('performanceTest.deleteWorkflow')"
                  :title="t('performanceTest.deleteWorkflow')"
                  :disabled="isWorkflowDeleting"
                  @click="deleteWorkflow"
                >
                  <Trash2 :size="18" aria-hidden="true" />
                </button>
              </div>
              <p v-if="workflowImportError" class="performance-test__workflow-error" role="alert">
                {{ workflowImportError }}
              </p>
            </section>

            <section class="performance-test__column">
              <h2>{{ t('performanceTest.measurementSettings') }}</h2>
              <div class="performance-test__setting">
                <label for="performance-test-warmup-runs">
                  {{ t('performanceTest.warmupRuns') }}
                </label>
                <div class="brand-input performance-test__setting-input">
                  <input
                    id="performance-test-warmup-runs"
                    v-model="warmupRuns"
                    type="number"
                    min="1"
                    max="5"
                    step="1"
                    @change="correctWarmupRuns"
                    @blur="correctWarmupRuns"
                  />
                </div>
              </div>
              <div class="performance-test__setting">
                <label for="performance-test-measured-runs">
                  {{ t('performanceTest.measuredRuns') }}
                </label>
                <div class="brand-input performance-test__setting-input">
                  <input
                    id="performance-test-measured-runs"
                    v-model="measuredRuns"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    @change="correctMeasuredRuns"
                    @blur="correctMeasuredRuns"
                  />
                </div>
              </div>
              <div class="performance-test__run-actions">
                <button
                  class="danger-solid performance-test__stop"
                  type="button"
                  :disabled="!canStop"
                  @click="stopPerformanceTest"
                >
                  {{ isStopping ? t('performanceTest.stopping') : t('performanceTest.stop') }}
                </button>
                <button
                  class="brand-primary performance-test__run"
                  type="button"
                  :disabled="!canRun"
                  @click="runPerformanceTest"
                >
                  {{ isLaunching ? t('performanceTest.running') : t('performanceTest.run') }}
                </button>
              </div>
            </section>
          </div>

          <section class="performance-test__results-section">
            <button
              class="performance-test__logs-toggle"
              type="button"
              :aria-expanded="resultsExpanded"
              @click="resultsExpanded = !resultsExpanded"
            >
              <ChevronRight
                :size="16"
                class="performance-test__logs-chevron"
                :class="{ 'performance-test__logs-chevron--open': resultsExpanded }"
                aria-hidden="true"
              />
              {{ t('performanceTest.results') }}
            </button>
            <div v-show="resultsExpanded" class="performance-test__results">
              <template v-if="performanceTestResult?.statistics">
                <div class="performance-test__summary">
                  <div class="performance-test__summary-column">
                    <dl class="performance-test__result-list">
                      <div>
                        <dt>{{ t('performanceTest.measuredRunCount') }}</dt>
                        <dd>{{ performanceTestResult.statistics.measuredJobCount }}</dd>
                      </div>
                    </dl>
                    <div
                      class="performance-test__aggregate-chart"
                      role="img"
                      :aria-label="t('performanceTest.runDurationChart')"
                    >
                      <div
                        v-for="aggregate in aggregateChart"
                        :key="aggregate.label"
                        class="performance-test__aggregate-bar"
                      >
                        <span>{{ aggregate.label }}</span>
                        <div aria-hidden="true">
                          <i :style="{ width: aggregate.width }" />
                        </div>
                      </div>
                    </div>
                  </div>
                  <dl class="performance-test__result-list">
                    <div>
                      <dt>{{ t('performanceTest.fastestRun') }}</dt>
                      <dd>
                        {{
                          formatDuration(performanceTestResult.statistics.fastest.durationSeconds)
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>{{ t('performanceTest.slowestRun') }}</dt>
                      <dd>
                        {{
                          formatDuration(performanceTestResult.statistics.slowest.durationSeconds)
                        }}
                      </dd>
                    </div>
                  </dl>
                  <dl class="performance-test__result-list">
                    <div>
                      <dt>{{ t('performanceTest.averageRunDuration') }}</dt>
                      <dd>
                        {{
                          formatDuration(performanceTestResult.statistics.averageDurationSeconds)
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>{{ t('performanceTest.medianRunDuration') }}</dt>
                      <dd>
                        {{ formatDuration(performanceTestResult.statistics.medianDurationSeconds) }}
                      </dd>
                    </div>
                  </dl>
                </div>
              </template>
              <p v-else class="performance-test__results-placeholder">
                {{ t('performanceTest.resultsPlaceholder') }}
              </p>

              <template v-if="performanceTestResult?.hardware || performanceTestResult?.systemInfo">
                <h3>{{ t('performanceTest.systemInformation') }}</h3>
                <div class="performance-test__system-groups">
                  <section
                    v-if="
                      performanceTestResult?.hardware ||
                      performanceTestResult?.systemInfo?.gpu_model ||
                      performanceTestResult?.systemInfo?.gpu_vram_mb != null
                    "
                    class="performance-test__system-group"
                  >
                    <h4>{{ t('performanceTest.gpuGroup') }}</h4>
                    <dl
                      class="performance-test__result-list performance-test__result-list--compact"
                    >
                      <div v-if="performanceTestResult?.hardware">
                        <dt>{{ t('performanceTest.device') }}</dt>
                        <dd>
                          {{
                            performanceTestResult.hardware.deviceName ||
                            performanceTestResult.hardware.deviceType
                          }}
                        </dd>
                      </div>
                      <div v-if="performanceTestResult?.hardware?.vramMb != null">
                        <dt>{{ t('performanceTest.vram') }}</dt>
                        <dd>{{ performanceTestResult.hardware.vramMb }} MB</dd>
                      </div>
                      <div v-if="performanceTestResult?.systemInfo?.gpu_model">
                        <dt>{{ t('performanceTest.systemGpu') }}</dt>
                        <dd>{{ performanceTestResult.systemInfo.gpu_model }}</dd>
                      </div>
                      <div
                        v-if="
                          performanceTestResult?.hardware?.vramMb == null &&
                          performanceTestResult?.systemInfo?.gpu_vram_mb != null
                        "
                      >
                        <dt>{{ t('performanceTest.vram') }}</dt>
                        <dd>{{ performanceTestResult.systemInfo.gpu_vram_mb }} MB</dd>
                      </div>
                      <div
                        v-if="
                          performanceTestResult?.systemInfo &&
                          getGpuDriver(performanceTestResult.systemInfo)
                        "
                      >
                        <dt>{{ t('performanceTest.gpuDriver') }}</dt>
                        <dd>{{ getGpuDriver(performanceTestResult.systemInfo) }}</dd>
                      </div>
                    </dl>
                  </section>

                  <section
                    v-if="
                      performanceTestResult?.systemInfo ||
                      performanceTestResult?.hardware?.ramMb != null
                    "
                    class="performance-test__system-group"
                  >
                    <h4>{{ t('performanceTest.cpuMemoryGroup') }}</h4>
                    <dl
                      class="performance-test__result-list performance-test__result-list--compact"
                    >
                      <div v-if="performanceTestResult?.systemInfo">
                        <dt>{{ t('performanceTest.cpu') }}</dt>
                        <dd>{{ performanceTestResult.systemInfo.cpu_model }}</dd>
                      </div>
                      <div v-if="performanceTestResult?.systemInfo">
                        <dt>{{ t('performanceTest.logicalCpuCores') }}</dt>
                        <dd>{{ performanceTestResult.systemInfo.cpu_cores }}</dd>
                      </div>
                      <div v-if="performanceTestResult?.systemInfo?.cpu_physical_cores != null">
                        <dt>{{ t('performanceTest.physicalCpuCores') }}</dt>
                        <dd>{{ performanceTestResult.systemInfo.cpu_physical_cores }}</dd>
                      </div>
                      <div v-if="performanceTestResult?.systemInfo">
                        <dt>{{ t('performanceTest.systemMemory') }}</dt>
                        <dd>{{ performanceTestResult.systemInfo.total_memory_gb }} GB</dd>
                      </div>
                      <div v-if="performanceTestResult?.hardware?.ramMb != null">
                        <dt>{{ t('performanceTest.ram') }}</dt>
                        <dd>{{ performanceTestResult.hardware.ramMb }} MB</dd>
                      </div>
                    </dl>
                  </section>

                  <section
                    v-if="
                      performanceTestResult?.hardware?.pytorchVersion ||
                      performanceTestResult?.hardware?.xformersVersion
                    "
                    class="performance-test__system-group"
                  >
                    <h4>{{ t('performanceTest.pythonGroup') }}</h4>
                    <dl
                      class="performance-test__result-list performance-test__result-list--compact"
                    >
                      <div v-if="performanceTestResult?.hardware?.pytorchVersion">
                        <dt>{{ t('performanceTest.pytorch') }}</dt>
                        <dd>{{ performanceTestResult.hardware.pytorchVersion }}</dd>
                      </div>
                      <div v-if="performanceTestResult?.hardware?.xformersVersion">
                        <dt>{{ t('performanceTest.xformers') }}</dt>
                        <dd>{{ performanceTestResult.hardware.xformersVersion }}</dd>
                      </div>
                    </dl>
                  </section>

                  <section
                    v-if="performanceTestResult?.systemInfo"
                    class="performance-test__system-group"
                  >
                    <h4>{{ t('performanceTest.osOtherGroup') }}</h4>
                    <dl
                      class="performance-test__result-list performance-test__result-list--compact"
                    >
                      <div v-if="performanceTestResult?.systemInfo">
                        <dt>{{ t('performanceTest.operatingSystem') }}</dt>
                        <dd>{{ formatOperatingSystem(performanceTestResult.systemInfo) }}</dd>
                      </div>
                      <div v-if="performanceTestResult?.systemInfo">
                        <dt>{{ t('performanceTest.architecture') }}</dt>
                        <dd>{{ performanceTestResult.systemInfo.arch }}</dd>
                      </div>
                    </dl>
                  </section>
                </div>
              </template>
            </div>
          </section>
          <section
            class="performance-test__logs-section"
            :class="{ 'performance-test__logs-section--collapsed': !logsExpanded }"
          >
            <button
              class="performance-test__logs-toggle"
              type="button"
              :aria-expanded="logsExpanded"
              @click="toggleLogs"
            >
              <ChevronRight
                :size="16"
                class="performance-test__logs-chevron"
                :class="{ 'performance-test__logs-chevron--open': logsExpanded }"
                aria-hidden="true"
              />
              {{ t('settings.logs') }}
            </button>
            <div
              v-show="logsExpanded"
              ref="logsElement"
              class="performance-test__logs"
              aria-live="polite"
            >
              {{ performanceTestLogs || t('performanceTest.logsPlaceholder') }}
            </div>
          </section>
        </div>
      </div>

      <div class="performance-test__account">
        <DevPlatformAccountChip />
      </div>
    </div>
  </BrandBackground>
</template>

<style scoped>
.performance-test {
  min-height: 0;
}

.performance-test__layout {
  position: relative;
  width: 100%;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
}

.performance-test__intro {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  min-height: 100%;
  gap: 24px;
  text-align: left;
}

.performance-test__columns {
  display: grid;
  grid-template-columns: minmax(240px, 3fr) repeat(2, minmax(0, 3.5fr));
  gap: 24px;
  width: 100%;
  min-height: 0;
  flex: 0 0 auto;
}

.performance-test__content {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  min-height: 0;
}

.performance-test__column {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
}

.performance-test__column h2 {
  margin: 0;
  color: var(--neutral-200);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.4;
}

.performance-test__logs-toggle {
  display: flex;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--neutral-200);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.4;
}

.performance-test__logs-toggle:hover {
  background: transparent;
}

.performance-test__logs-chevron {
  transition: transform 120ms ease;
}

.performance-test__logs-chevron--open {
  transform: rotate(90deg);
}

.performance-test__setting {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.performance-test__setting label {
  color: var(--neutral-200);
  font-size: 13px;
}

.performance-test__setting-input {
  width: 160px;
  margin-left: auto;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 14px;
}

.performance-test__selection-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.performance-test__selection-label {
  flex: 0 0 68px;
  color: var(--neutral-200);
  font-size: 13px;
}

.performance-test__selection-control {
  min-width: 0;
  flex: 1 1 auto;
}

.performance-test__drop-zone,
.performance-test__logs {
  padding: 20px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--chooser-surface-bg);
  color: var(--text-muted);
}

.performance-test__drop-zone {
  position: relative;
  flex: 0 0 auto;
  width: 100%;
  min-height: 104px;
  padding: 0;
  border-width: 1px;
  border-style: dotted;
  transition:
    border-color 120ms ease,
    background-color 120ms ease;
}

.performance-test__drop-zone:hover,
.performance-test__drop-zone:focus-within,
.performance-test__drop-zone--dragging {
  border-color: var(--chooser-surface-border-hover);
  background: var(--chooser-surface-bg-hover);
}

.performance-test__drop-zone:focus-within {
  outline: none;
}

.performance-test__drop-content {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 102px;
  padding: 20px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: center;
  cursor: pointer;
}

.performance-test__drop-zone--selected .performance-test__drop-content {
  justify-content: flex-start;
  padding-right: 56px;
  text-align: left;
}

.performance-test__workflow-file {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.performance-test__workflow-file strong {
  overflow: hidden;
  color: var(--text-primary);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.performance-test__workflow-file code {
  overflow-wrap: anywhere;
  color: var(--text-faint);
  font-size: 11px;
  font-family: inherit;
}

.performance-test__delete-workflow {
  position: absolute;
  top: 50%;
  right: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transform: translateY(-50%);
}

.performance-test__delete-workflow:hover {
  background: var(--chooser-surface-bg-hover);
  color: var(--accent-danger, #d92d20);
}

.performance-test__workflow-error {
  margin: -8px 0 0;
  color: var(--accent-danger, #d92d20);
  font-size: 12px;
  line-height: 1.4;
}

.performance-test__run-actions {
  display: flex;
  align-self: flex-end;
  gap: 8px;
  margin-top: auto;
}

.performance-test__run,
.performance-test__stop {
  min-width: 96px;
}

.performance-test__logs {
  flex: 0 0 clamp(140px, 25vh, 240px);
  min-height: 0;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.performance-test__logs-section {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  min-height: 0;
}

.performance-test__logs-section--collapsed {
  flex: 0 0 auto;
}

.performance-test__results-section {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.performance-test__results {
  padding: 20px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--chooser-surface-bg);
  color: var(--text-muted);
  font-size: 13px;
}

.performance-test__result-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 24px;
  margin: 0;
}

.performance-test__result-list div {
  min-width: 0;
}

.performance-test__result-list dt {
  color: var(--neutral-200);
}

.performance-test__result-list dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  font-size: 24px;
  line-height: 1.25;
}

.performance-test__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}

.performance-test__summary > .performance-test__result-list {
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
}

.performance-test__summary-column > .performance-test__result-list {
  grid-template-columns: minmax(0, 1fr);
}

.performance-test__aggregate-chart {
  display: grid;
  gap: 5px;
  margin-top: 14px;
}

.performance-test__aggregate-bar {
  display: grid;
  grid-template-columns: 110px minmax(40px, 1fr);
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.2;
}

.performance-test__aggregate-bar > div {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--chooser-surface-border);
}

.performance-test__aggregate-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--comfy-yellow);
}

.performance-test__result-list--compact {
  grid-template-columns: minmax(0, 1fr);
  gap: 8px 24px;
}

.performance-test__system-groups {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 24px;
}

.performance-test__system-group h4 {
  margin: 0 0 10px;
  color: var(--neutral-200);
  font-size: 12px;
  font-weight: 400;
}

.performance-test__result-list--compact div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--chooser-surface-border);
}

.performance-test__result-list--compact dt {
  flex: 0 0 auto;
  font-size: 12px;
}

.performance-test__result-list--compact dd {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.3;
  text-align: right;
}

.performance-test__results
  h3
  + .performance-test__result-list:not(.performance-test__result-list--compact)
  dd {
  color: var(--text-muted);
  font-size: 13px;
  line-height: inherit;
}

.performance-test__results h3 {
  margin: 20px 0 12px;
  color: var(--neutral-200);
  font-size: 13px;
  font-weight: 400;
}

.performance-test__results-placeholder {
  margin: 0;
}

.performance-test__account {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 2;
  display: flex;
  justify-content: flex-end;
  max-width: min(340px, 45%);
}

.performance-test__wordmark {
  display: block;
  width: clamp(120px, 8vw, 180px);
  height: auto;
  aspect-ratio: 173 / 48;
  color: var(--comfy-yellow);
  flex-shrink: 0;
  anchor-name: --brand-beam-target;
}

.performance-test__description {
  max-width: 560px;
  margin: 0;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1.5;
}

@media (max-width: 900px) {
  .performance-test__summary {
    grid-template-columns: minmax(0, 1fr);
  }

  .performance-test__result-list--compact {
    grid-template-columns: minmax(0, 1fr);
  }

  .performance-test__system-groups {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
