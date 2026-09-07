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
import WorkspaceSelectorBar from './devplatform/WorkspaceSelectorBar.vue'

const { t } = useI18n()
const authStore = useAuthStore()
const installationStore = useInstallationStore()
const sessionStore = useSessionStore()
const { selectedWorkspaceId, scopedInstallations } = useWorkspaceInstallScope(
  toRef(installationStore, 'installations')
)
const benchmarkInstallations = computed(() =>
  scopedInstallations.value.filter((installation) => installation.sourceCategory !== 'cloud')
)
const instanceOptions = computed<BaseSelectOption[]>(() =>
  benchmarkInstallations.value.map((installation) => ({
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
const measuredRuns = ref('5')
const logInstallationId = ref<string | null>(null)
const benchmarkInstallationId = ref<string | null>(null)
const logsElement = ref<HTMLElement | null>(null)
type BenchmarkRunResult = Awaited<ReturnType<typeof window.api.runBenchmarkWorkflow>>
const benchmarkResult = ref<BenchmarkRunResult | null>(null)
const benchmarkLogs = computed(() => {
  if (!logInstallationId.value) return ''
  return sessionStore.getSession(logInstallationId.value)?.output ?? ''
})
const workflowFileName = computed(() => workflowFilePath.value?.split(/[\\/]/).pop() ?? '')
const benchmarkSessionId = (installationId: string): string => `benchmark:${installationId}`
const canRun = computed(() => {
  const installationId = selectedInstallationId.value
  const sessionId = installationId ? benchmarkSessionId(installationId) : ''
  return Boolean(
    installationId &&
    workflowFilePath.value &&
    !isLaunching.value &&
    !isStopping.value &&
    !sessionStore.isRunning(sessionId) &&
    !sessionStore.isLaunching(sessionId)
  )
})
const canStop = computed(() => {
  return Boolean(benchmarkInstallationId.value && !isStopping.value)
})
let activeLaunchPromise: Promise<ActionResult> | null = null

watch(selectedWorkspaceId, () => {
  selectedInstallationId.value = null
})

function correctMeasuredRuns(): void {
  const rawValue = String(measuredRuns.value).trim()
  const value = rawValue === '' ? Number.NaN : Number(rawValue)
  measuredRuns.value = String(
    Number.isFinite(value) ? Math.min(100, Math.max(1, Math.round(value))) : 5
  )
}

async function importWorkflow(sourcePath?: string): Promise<void> {
  if (isWorkflowImporting.value || isWorkflowDeleting.value) return
  isWorkflowImporting.value = true
  workflowImportError.value = null
  try {
    const result = await window.api.importBenchmarkWorkflow(sourcePath)
    if (result.ok && result.filePath) {
      workflowFilePath.value = result.filePath
    } else if (!result.canceled) {
      workflowImportError.value = result.message || t('performanceBenchmarks.importFailed')
    }
  } catch (error) {
    workflowImportError.value = (error as Error)?.message || t('performanceBenchmarks.importFailed')
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
    const result = await window.api.deleteBenchmarkWorkflow(filePath)
    if (result.ok) {
      if (workflowFilePath.value === filePath) workflowFilePath.value = null
    } else {
      workflowImportError.value = result.message || t('performanceBenchmarks.deleteFailed')
    }
  } catch (error) {
    workflowImportError.value = (error as Error)?.message || t('performanceBenchmarks.deleteFailed')
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

async function runBenchmark(): Promise<void> {
  const installationId = selectedInstallationId.value
  const filePath = workflowFilePath.value
  if (!installationId || !filePath || isLaunching.value) return

  correctMeasuredRuns()
  const runs = Number(measuredRuns.value)
  const sessionId = benchmarkSessionId(installationId)
  isLaunching.value = true
  benchmarkResult.value = null
  logInstallationId.value = sessionId
  benchmarkInstallationId.value = installationId
  sessionStore.startSession(sessionId)
  try {
    const launchPromise = window.api.runAction(installationId, 'launch', {
      launchModeOverride: 'console',
      autoPortOnConflict: true,
      sessionIdOverride: sessionId
    })
    activeLaunchPromise = launchPromise
    const result = await launchPromise
    activeLaunchPromise = null
    if (!result.ok && !result.cancelled) {
      sessionStore.appendOutput(
        sessionId,
        result.message || t('performanceBenchmarks.launchFailed')
      )
    }
    if (!result.ok) {
      benchmarkInstallationId.value = null
      return
    }

    sessionStore.appendOutput(
      sessionId,
      `\n${t('performanceBenchmarks.submittingRuns', { count: runs, preparationCount: 2 })}\n`
    )
    try {
      const submission = await window.api.runBenchmarkWorkflow(sessionId, filePath, runs)
      if (submission.ok) benchmarkResult.value = submission
      sessionStore.appendOutput(
        sessionId,
        submission.ok
          ? `${t('performanceBenchmarks.completedRuns', {
              count: submission.submitted,
              unsuccessful: submission.unsuccessfulJobs,
              path: submission.resultPath
            })}\n`
          : `${submission.message || t('performanceBenchmarks.submitFailed')}\n`
      )
      if (submission.ok) await stopBenchmark()
    } catch (error) {
      sessionStore.appendOutput(
        sessionId,
        `${(error as Error)?.message || t('performanceBenchmarks.submitFailed')}\n`
      )
    }
  } catch (error) {
    sessionStore.appendOutput(
      sessionId,
      (error as Error)?.message || t('performanceBenchmarks.launchFailed')
    )
    benchmarkInstallationId.value = null
  } finally {
    activeLaunchPromise = null
    isLaunching.value = false
  }
}

function formatDuration(seconds: number): string {
  return `${seconds.toFixed(3)} s`
}

function formatOperatingSystem(info: NonNullable<BenchmarkRunResult['systemInfo']>): string {
  return (
    [info.os_distro, info.os_release].filter(Boolean).join(' ') ||
    `${info.platform} ${info.os_version}`
  )
}

function getGpuDriver(info: NonNullable<BenchmarkRunResult['systemInfo']>): string | null {
  return info.nvidia_driver_version ?? info.amd_driver_version ?? info.intel_driver_version
}

async function stopBenchmark(): Promise<void> {
  const installationId = benchmarkInstallationId.value
  if (!installationId || !canStop.value) return
  const sessionId = benchmarkSessionId(installationId)

  isStopping.value = true
  try {
    if (activeLaunchPromise) {
      await window.api.cancelOperation(sessionId)
      await activeLaunchPromise.catch(() => undefined)
    }
    await window.api.stopComfyUI(sessionId)
    if (benchmarkInstallationId.value === installationId) benchmarkInstallationId.value = null
  } catch (error) {
    sessionStore.appendOutput(
      sessionId,
      `\n${(error as Error)?.message || t('performanceBenchmarks.stopFailed')}\n`
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

watch(benchmarkLogs, async () => {
  await nextTick()
  if (logsElement.value) logsElement.value.scrollTop = logsElement.value.scrollHeight
})
</script>

<template>
  <BrandBackground class="performance-benchmarks" data-testid="performance-benchmarks">
    <div class="performance-benchmarks__layout">
      <div class="performance-benchmarks__intro">
        <ComfyWordmark
          class="performance-benchmarks__wordmark"
          data-testid="performance-benchmarks-logo"
          aria-hidden="true"
        />
        <p class="performance-benchmarks__description">
          {{ t('performanceBenchmarks.description') }}
        </p>
        <WorkspaceSelectorBar v-if="authStore.isSignedIn" v-model="selectedWorkspaceId" />
        <div v-if="authStore.isSignedIn" class="performance-benchmarks__content">
          <div class="performance-benchmarks__columns">
            <section class="performance-benchmarks__column">
              <h2>{{ t('performanceBenchmarks.selectInstance') }}</h2>
              <div class="performance-benchmarks__instance-select">
                <BaseSelect
                  :model-value="selectedInstallationId ?? ''"
                  :options="instanceOptions"
                  :placeholder="t('performanceBenchmarks.selectInstancePlaceholder')"
                  :aria-label="t('performanceBenchmarks.selectInstancePlaceholder')"
                  :disabled="instanceOptions.length === 0"
                  @update:model-value="selectedInstallationId = $event"
                />
              </div>
            </section>

            <section class="performance-benchmarks__column">
              <h2>{{ t('performanceBenchmarks.dropWorkflow') }}</h2>
              <div
                class="performance-benchmarks__drop-zone"
                :class="{
                  'performance-benchmarks__drop-zone--dragging': isWorkflowDragging,
                  'performance-benchmarks__drop-zone--selected': workflowFilePath
                }"
                :aria-busy="isWorkflowImporting || isWorkflowDeleting"
                @dragenter.prevent="isWorkflowDragging = true"
                @dragover.prevent="isWorkflowDragging = true"
                @dragleave.prevent="isWorkflowDragging = false"
                @drop.prevent="dropWorkflow"
              >
                <button
                  class="performance-benchmarks__drop-content"
                  type="button"
                  @click="importWorkflow()"
                >
                  <span v-if="!workflowFilePath">
                    {{
                      isWorkflowImporting
                        ? t('performanceBenchmarks.importingWorkflow')
                        : t('performanceBenchmarks.dropWorkflowHint')
                    }}
                  </span>
                  <span v-else class="performance-benchmarks__workflow-file">
                    <strong>{{ workflowFileName }}</strong>
                    <code>{{ workflowFilePath }}</code>
                  </span>
                </button>
                <button
                  v-if="workflowFilePath"
                  class="performance-benchmarks__delete-workflow"
                  type="button"
                  :aria-label="t('performanceBenchmarks.deleteWorkflow')"
                  :title="t('performanceBenchmarks.deleteWorkflow')"
                  :disabled="isWorkflowDeleting"
                  @click="deleteWorkflow"
                >
                  <Trash2 :size="18" aria-hidden="true" />
                </button>
              </div>
              <p
                v-if="workflowImportError"
                class="performance-benchmarks__workflow-error"
                role="alert"
              >
                {{ workflowImportError }}
              </p>
            </section>

            <section class="performance-benchmarks__column">
              <h2>{{ t('performanceBenchmarks.measurementSettings') }}</h2>
              <div class="performance-benchmarks__setting">
                <label for="benchmark-measured-runs">
                  {{ t('performanceBenchmarks.measuredRuns') }}
                </label>
                <div class="brand-input performance-benchmarks__setting-input">
                  <input
                    id="benchmark-measured-runs"
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
              <div class="performance-benchmarks__run-actions">
                <button
                  class="danger-solid performance-benchmarks__stop"
                  type="button"
                  :disabled="!canStop"
                  @click="stopBenchmark"
                >
                  {{
                    isStopping
                      ? t('performanceBenchmarks.stopping')
                      : t('performanceBenchmarks.stop')
                  }}
                </button>
                <button
                  class="brand-primary performance-benchmarks__run"
                  type="button"
                  :disabled="!canRun"
                  @click="runBenchmark"
                >
                  {{
                    isLaunching
                      ? t('performanceBenchmarks.starting')
                      : t('performanceBenchmarks.run')
                  }}
                </button>
              </div>
            </section>
          </div>

          <section
            class="performance-benchmarks__logs-section"
            :class="{ 'performance-benchmarks__logs-section--collapsed': !logsExpanded }"
          >
            <button
              class="performance-benchmarks__logs-toggle"
              type="button"
              :aria-expanded="logsExpanded"
              @click="toggleLogs"
            >
              <ChevronRight
                :size="16"
                class="performance-benchmarks__logs-chevron"
                :class="{ 'performance-benchmarks__logs-chevron--open': logsExpanded }"
                aria-hidden="true"
              />
              {{ t('settings.logs') }}
            </button>
            <div
              v-show="logsExpanded"
              ref="logsElement"
              class="performance-benchmarks__logs"
              aria-live="polite"
            >
              {{ benchmarkLogs || t('performanceBenchmarks.logsPlaceholder') }}
            </div>
          </section>
          <section class="performance-benchmarks__results-section">
            <button
              class="performance-benchmarks__logs-toggle"
              type="button"
              :aria-expanded="resultsExpanded"
              @click="resultsExpanded = !resultsExpanded"
            >
              <ChevronRight
                :size="16"
                class="performance-benchmarks__logs-chevron"
                :class="{ 'performance-benchmarks__logs-chevron--open': resultsExpanded }"
                aria-hidden="true"
              />
              {{ t('performanceBenchmarks.results') }}
            </button>
            <div v-show="resultsExpanded" class="performance-benchmarks__results">
              <template v-if="benchmarkResult?.statistics">
                <dl class="performance-benchmarks__result-list">
                  <div>
                    <dt>{{ t('performanceBenchmarks.fastestJob') }}</dt>
                    <dd>
                      {{ formatDuration(benchmarkResult.statistics.fastest.durationSeconds) }}
                    </dd>
                  </div>
                  <div>
                    <dt>{{ t('performanceBenchmarks.slowestJob') }}</dt>
                    <dd>
                      {{ formatDuration(benchmarkResult.statistics.slowest.durationSeconds) }}
                    </dd>
                  </div>
                  <div>
                    <dt>{{ t('performanceBenchmarks.averageDuration') }}</dt>
                    <dd>
                      {{ formatDuration(benchmarkResult.statistics.averageDurationSeconds) }}
                    </dd>
                  </div>
                  <div>
                    <dt>{{ t('performanceBenchmarks.medianDuration') }}</dt>
                    <dd>{{ formatDuration(benchmarkResult.statistics.medianDurationSeconds) }}</dd>
                  </div>
                </dl>
              </template>
              <p v-else class="performance-benchmarks__results-placeholder">
                {{ t('performanceBenchmarks.resultsPlaceholder') }}
              </p>

              <template v-if="benchmarkResult?.hardware">
                <h3>{{ t('performanceBenchmarks.hardware') }}</h3>
                <dl class="performance-benchmarks__result-list">
                  <div>
                    <dt>{{ t('performanceBenchmarks.device') }}</dt>
                    <dd>
                      {{
                        benchmarkResult.hardware.deviceName || benchmarkResult.hardware.deviceType
                      }}
                    </dd>
                  </div>
                  <div v-if="benchmarkResult.hardware.vramMb != null">
                    <dt>{{ t('performanceBenchmarks.vram') }}</dt>
                    <dd>{{ benchmarkResult.hardware.vramMb }} MB</dd>
                  </div>
                  <div v-if="benchmarkResult.hardware.ramMb != null">
                    <dt>{{ t('performanceBenchmarks.ram') }}</dt>
                    <dd>{{ benchmarkResult.hardware.ramMb }} MB</dd>
                  </div>
                  <div v-if="benchmarkResult.hardware.pytorchVersion">
                    <dt>{{ t('performanceBenchmarks.pytorch') }}</dt>
                    <dd>{{ benchmarkResult.hardware.pytorchVersion }}</dd>
                  </div>
                  <div v-if="benchmarkResult.hardware.xformersVersion">
                    <dt>{{ t('performanceBenchmarks.xformers') }}</dt>
                    <dd>{{ benchmarkResult.hardware.xformersVersion }}</dd>
                  </div>
                </dl>
              </template>
              <template v-if="benchmarkResult?.systemInfo">
                <h3>{{ t('performanceBenchmarks.systemInformation') }}</h3>
                <dl class="performance-benchmarks__result-list">
                  <div>
                    <dt>{{ t('performanceBenchmarks.operatingSystem') }}</dt>
                    <dd>{{ formatOperatingSystem(benchmarkResult.systemInfo) }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('performanceBenchmarks.architecture') }}</dt>
                    <dd>{{ benchmarkResult.systemInfo.arch }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('performanceBenchmarks.cpu') }}</dt>
                    <dd>{{ benchmarkResult.systemInfo.cpu_model }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('performanceBenchmarks.logicalCpuCores') }}</dt>
                    <dd>{{ benchmarkResult.systemInfo.cpu_cores }}</dd>
                  </div>
                  <div v-if="benchmarkResult.systemInfo.cpu_physical_cores != null">
                    <dt>{{ t('performanceBenchmarks.physicalCpuCores') }}</dt>
                    <dd>{{ benchmarkResult.systemInfo.cpu_physical_cores }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('performanceBenchmarks.systemMemory') }}</dt>
                    <dd>{{ benchmarkResult.systemInfo.total_memory_gb }} GB</dd>
                  </div>
                  <div v-if="benchmarkResult.systemInfo.gpu_model">
                    <dt>{{ t('performanceBenchmarks.systemGpu') }}</dt>
                    <dd>{{ benchmarkResult.systemInfo.gpu_model }}</dd>
                  </div>
                  <div v-if="benchmarkResult.systemInfo.gpu_vram_mb != null">
                    <dt>{{ t('performanceBenchmarks.vram') }}</dt>
                    <dd>{{ benchmarkResult.systemInfo.gpu_vram_mb }} MB</dd>
                  </div>
                  <div v-if="getGpuDriver(benchmarkResult.systemInfo)">
                    <dt>{{ t('performanceBenchmarks.gpuDriver') }}</dt>
                    <dd>{{ getGpuDriver(benchmarkResult.systemInfo) }}</dd>
                  </div>
                </dl>
              </template>
            </div>
          </section>
        </div>
      </div>

      <div class="performance-benchmarks__account">
        <DevPlatformAccountChip />
      </div>
    </div>
  </BrandBackground>
</template>

<style scoped>
.performance-benchmarks {
  min-height: 0;
}

.performance-benchmarks__layout {
  position: relative;
  width: 100%;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
}

.performance-benchmarks__intro {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  height: 100%;
  gap: 24px;
  text-align: left;
}

.performance-benchmarks__columns {
  display: grid;
  grid-template-columns: minmax(240px, 3fr) repeat(2, minmax(0, 3.5fr));
  gap: 24px;
  width: 100%;
  min-height: 0;
  flex: 0 0 auto;
}

.performance-benchmarks__content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  min-height: 0;
}

.performance-benchmarks__column {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
}

.performance-benchmarks__column h2 {
  margin: 0;
  color: var(--neutral-200);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.4;
}

.performance-benchmarks__logs-toggle {
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

.performance-benchmarks__logs-toggle:hover {
  background: transparent;
}

.performance-benchmarks__logs-chevron {
  transition: transform 120ms ease;
}

.performance-benchmarks__logs-chevron--open {
  transform: rotate(90deg);
}

.performance-benchmarks__setting {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
}

.performance-benchmarks__setting label {
  color: var(--neutral-200);
  font-size: 13px;
}

.performance-benchmarks__setting-input {
  width: 180px;
  margin-left: auto;
}

.performance-benchmarks__instance-select {
  width: 100%;
}

.performance-benchmarks__drop-zone,
.performance-benchmarks__logs {
  padding: 20px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--chooser-surface-bg);
  color: var(--text-muted);
}

.performance-benchmarks__drop-zone {
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

.performance-benchmarks__drop-zone:hover,
.performance-benchmarks__drop-zone:focus-within,
.performance-benchmarks__drop-zone--dragging {
  border-color: var(--chooser-surface-border-hover);
  background: var(--chooser-surface-bg-hover);
}

.performance-benchmarks__drop-zone:focus-within {
  outline: none;
}

.performance-benchmarks__drop-content {
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

.performance-benchmarks__drop-zone--selected .performance-benchmarks__drop-content {
  justify-content: flex-start;
  padding-right: 56px;
  text-align: left;
}

.performance-benchmarks__workflow-file {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.performance-benchmarks__workflow-file strong {
  overflow: hidden;
  color: var(--text-primary);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.performance-benchmarks__workflow-file code {
  overflow-wrap: anywhere;
  color: var(--text-faint);
  font-size: 11px;
  font-family: inherit;
}

.performance-benchmarks__delete-workflow {
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

.performance-benchmarks__delete-workflow:hover {
  background: var(--chooser-surface-bg-hover);
  color: var(--accent-danger, #d92d20);
}

.performance-benchmarks__workflow-error {
  margin: -8px 0 0;
  color: var(--accent-danger, #d92d20);
  font-size: 12px;
  line-height: 1.4;
}

.performance-benchmarks__run-actions {
  display: flex;
  align-self: flex-end;
  gap: 8px;
  margin-top: auto;
}

.performance-benchmarks__run,
.performance-benchmarks__stop {
  min-width: 96px;
}

.performance-benchmarks__logs {
  flex: 1 1 auto;
  min-height: 180px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.performance-benchmarks__logs-section {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  min-height: 0;
}

.performance-benchmarks__logs-section--collapsed {
  flex: 0 0 auto;
}

.performance-benchmarks__results-section {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.performance-benchmarks__results {
  padding: 20px;
  border: 1px solid var(--chooser-surface-border);
  border-radius: 8px;
  background: var(--chooser-surface-bg);
  color: var(--text-muted);
  font-size: 13px;
}

.performance-benchmarks__result-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 24px;
  margin: 0;
}

.performance-benchmarks__result-list div {
  min-width: 0;
}

.performance-benchmarks__result-list dt {
  color: var(--neutral-200);
}

.performance-benchmarks__result-list dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  font-size: 24px;
  line-height: 1.25;
}

.performance-benchmarks__results h3 + .performance-benchmarks__result-list dd {
  color: var(--text-muted);
  font-size: 13px;
  line-height: inherit;
}

.performance-benchmarks__results h3 {
  margin: 20px 0 12px;
  color: var(--neutral-200);
  font-size: 13px;
  font-weight: 400;
}

.performance-benchmarks__results-placeholder {
  margin: 0;
}

.performance-benchmarks__account {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 2;
  display: flex;
  justify-content: flex-end;
  max-width: min(340px, 45%);
}

.performance-benchmarks__wordmark {
  display: block;
  width: clamp(120px, 8vw, 180px);
  height: auto;
  aspect-ratio: 173 / 48;
  color: var(--comfy-yellow);
  flex-shrink: 0;
  anchor-name: --brand-beam-target;
}

.performance-benchmarks__description {
  max-width: 560px;
  margin: 0;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1.5;
}
</style>
