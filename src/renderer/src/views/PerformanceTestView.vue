<script setup lang="ts">
import { computed, reactive, ref, toRef, useTemplateRef, watch } from 'vue'
import { I18nT, useI18n } from 'vue-i18n'
import { CircleAlert, FolderOpen, ImageDown, Play, Square, X } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import BrandBackground from '../components/BrandBackground.vue'
import BrandedPageHeader from '../components/BrandedPageHeader.vue'
import TemplatePickerStep from '../components/TemplatePickerStep.vue'
import BaseModal from '../components/ui/BaseModal.vue'
import { usePerformanceTestRun } from '../composables/usePerformanceTestRun'
import { usePerformanceTestWorkflow } from '../composables/usePerformanceTestWorkflow'
import { useWorkspaceInstallScope } from '../composables/useWorkspaceInstallScope'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'
import {
  RUN_COUNT_LIMITS,
  clampRunCount,
  durationRows,
  formatDuration,
  parentFolder,
  summaryDurations,
  systemFacts
} from '../lib/performanceTestResults'
import { createPerformanceTestResultsSvg, createResultsPng } from '../lib/performanceTestResultsSvg'
import type { PerformanceTestResultsSummary } from '../types/ipc'
import PerformanceTestBuildMenu, {
  type BuildOption
} from './performanceTest/PerformanceTestBuildMenu.vue'
import PerformanceTestCard from './performanceTest/PerformanceTestCard.vue'
import PerformanceTestLogs from './performanceTest/PerformanceTestLogs.vue'
import PerformanceTestProgress from './performanceTest/PerformanceTestProgress.vue'
import PerformanceTestResultSummary from './performanceTest/PerformanceTestResultSummary.vue'
import PerformanceTestRunCountField from './performanceTest/PerformanceTestRunCountField.vue'
import PerformanceTestSystemFacts from './performanceTest/PerformanceTestSystemFacts.vue'
import PerformanceTestWorkflowMenu from './performanceTest/PerformanceTestWorkflowMenu.vue'
import { durationLabels, systemFactLabels } from './performanceTest/labels'

const emit = defineEmits<{
  'run-active-change': [active: boolean]
}>()

const { t } = useI18n()
const authStore = useAuthStore()
const installationStore = useInstallationStore()
const { selectedWorkspaceId, scopedInstallations } = useWorkspaceInstallScope(
  toRef(installationStore, 'installations')
)

const builds = computed(() =>
  scopedInstallations.value.filter(
    (installation) =>
      installation.sourceCategory !== 'cloud' &&
      (authStore.isSignedIn || installation.status === 'installed')
  )
)
const buildOptions = computed<BuildOption[]>(() =>
  builds.value.map((installation) => ({
    value: installation.id,
    label: installation.name,
    description: [installation.sourceLabel, installation.version].filter(Boolean).join(' · ')
  }))
)
const selectedBuildId = ref<string | null>(null)
const selectedBuild = computed(
  () => builds.value.find(({ id }) => id === selectedBuildId.value) ?? null
)
watch(selectedWorkspaceId, () => {
  selectedBuildId.value = null
})

const run = reactive(usePerformanceTestRun(t))
const workflow = reactive(
  usePerformanceTestWorkflow({
    picker: useTemplateRef<InstanceType<typeof TemplatePickerStep>>('examplePicker'),
    selectedInstallationId: selectedBuildId,
    isSelectedInstallationInstalled: computed(() => selectedBuild.value?.status === 'installed'),
    isLocked: toRef(run, 'isBusy'),
    t
  })
)

const warmupRuns = ref(String(RUN_COUNT_LIMITS.warmup.fallback))
const measuredRuns = ref(String(RUN_COUNT_LIMITS.measured.fallback))
const logsExpanded = ref(false)
const isExportingResults = ref(false)
const exportResultsError = ref<string | null>(null)

const canRun = computed(() =>
  Boolean(selectedBuild.value && workflow.isReady && run.canStart(selectedBuild.value.id))
)
const summary = computed(() => run.result?.resultsSummary ?? null)
const resultsFolder = computed(() => {
  const resultPath = run.result?.resultsSummaryPath ?? run.result?.resultPath
  return resultPath ? parentFolder(resultPath) : null
})
const canExport = computed(() =>
  Boolean(run.result?.resultsSummaryPath && summary.value && summaryDurations(summary.value))
)
const facts = computed(() => (summary.value ? labelledSystemFacts(summary.value) : []))

watch(
  () => run.ownsBuild,
  (active) => emit('run-active-change', active)
)
watch(
  () => run.result,
  (result) => {
    if (result) logsExpanded.value = false
  }
)

function labelledSystemFacts(source: PerformanceTestResultsSummary) {
  const labels = systemFactLabels(t)
  return systemFacts(source.hardware, source.systemInfo).map((fact) => ({
    label: labels[fact.key],
    value: fact.value
  }))
}

function startRun(): void {
  const build = selectedBuild.value
  const workflowPath = workflow.filePath
  if (!build || !workflowPath || !canRun.value) return
  const warmups = clampRunCount(warmupRuns.value, RUN_COUNT_LIMITS.warmup)
  const measured = clampRunCount(measuredRuns.value, RUN_COUNT_LIMITS.measured)
  warmupRuns.value = String(warmups)
  measuredRuns.value = String(measured)
  logsExpanded.value = true
  exportResultsError.value = null
  void run.start({
    installationId: build.id,
    buildName: build.name,
    workflowPath,
    workflowName: workflow.label,
    telemetryWorkflowName: workflow.telemetryName,
    warmupRuns: warmups,
    measuredRuns: measured
  })
}

function openResultsFolder(): void {
  if (resultsFolder.value) void window.api.openPath(resultsFolder.value)
}

async function exportResultsImage(): Promise<void> {
  const summaryPath = run.result?.resultsSummaryPath
  const folder = resultsFolder.value
  if (!summaryPath || !folder || isExportingResults.value) return
  isExportingResults.value = true
  exportResultsError.value = null
  try {
    const saved = await window.api.readPerformanceTestResultsSummary(summaryPath)
    const durations = summaryDurations(saved)
    if (!durations) throw new Error(t('performanceTest.exportImageFailed'))
    const labels = durationLabels(t)
    const svg = createPerformanceTestResultsSvg({
      title: t('performanceTest.imageTitle', { workflowName: saved.workflowName }),
      aggregateTitle: t('performanceTest.runDurationChart'),
      systemInformationTitle: t('performanceTest.systemInformation'),
      testDateTime: new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(saved.createdAt)),
      headline: {
        label: t('performanceTest.medianSummary', {
          count: saved.measuredJobCount,
          failed: saved.failedRunCount
        }),
        value: formatDuration(durations.median)
      },
      durations: durationRows(durations).map((row) => ({
        label: labels[row.key],
        value: formatDuration(row.seconds),
        durationSeconds: row.seconds,
        highlight: row.highlight
      })),
      system: labelledSystemFacts(saved)
    })
    const png = await createResultsPng(svg)
    const exported = await window.api.exportResultsImage(png, 'performance-test', folder)
    if (!exported.ok && !exported.canceled) {
      exportResultsError.value = exported.message || t('performanceTest.exportImageFailed')
    }
  } catch (error) {
    exportResultsError.value = (error as Error)?.message || t('performanceTest.exportImageFailed')
  } finally {
    isExportingResults.value = false
  }
}
</script>

<template>
  <BrandBackground
    class="performance-test min-h-0 [&_.brand-inner-frame]:min-h-0 [&_.brand-inner-frame]:p-0 [&_.brand-outer-frame]:min-h-0"
    data-testid="performance-test"
  >
    <div
      class="performance-test__layout @container relative h-full min-h-0 w-full overflow-x-hidden overflow-y-auto"
    >
      <div
        class="performance-test__page mx-auto flex min-h-full w-full max-w-300 flex-col items-start gap-5 px-10 pt-9 pb-24 text-left"
      >
        <BrandedPageHeader :title="t('performanceTest.title')" />
        <div
          class="performance-test__content @container/setup flex min-h-0 w-full flex-none flex-col"
        >
          <div class="performance-test__setup flex w-full flex-none flex-wrap items-center gap-2">
            <section class="performance-test__step flex min-w-0 @max-[36rem]/setup:basis-full">
              <h2 class="sr-only">{{ t('performanceTest.selectInstance') }}</h2>
              <PerformanceTestBuildMenu v-model="selectedBuildId" :options="buildOptions" />
            </section>
            <PerformanceTestWorkflowMenu
              :label="workflow.label"
              :source="workflow.source"
              :file-path="workflow.filePath"
              :locked="run.isBusy"
              :importing="workflow.isImporting"
              :deleting="workflow.isDeleting"
              :can-choose-example="selectedBuildId !== null"
              :loading-examples="workflow.example.isPickerLoading"
              :downloading="workflow.example.download !== null"
              @choose-example="workflow.example.openPicker()"
              @import="workflow.importFrom()"
              @import-file="workflow.importFile"
              @remove="workflow.remove()"
            />
            <section class="performance-test__step flex min-w-0">
              <h2 class="sr-only">{{ t('performanceTest.measurementSettings') }}</h2>
              <div class="performance-test__settings flex flex-wrap items-center gap-2">
                <PerformanceTestRunCountField
                  id="performance-test-warmup-runs"
                  v-model="warmupRuns"
                  :label="t('performanceTest.warmupRuns')"
                  :hint="t('performanceTest.warmupRunsHint')"
                  :limits="RUN_COUNT_LIMITS.warmup"
                />
                <PerformanceTestRunCountField
                  id="performance-test-measured-runs"
                  v-model="measuredRuns"
                  :label="t('performanceTest.measuredRuns')"
                  :hint="t('performanceTest.measuredRunsHint')"
                  :limits="RUN_COUNT_LIMITS.measured"
                />
              </div>
            </section>
            <Button
              v-if="run.ownsBuild"
              class="performance-test__stop ml-auto min-w-20 gap-1.5 px-3 text-[13px]/5"
              variant="secondary"
              size="md"
              type="button"
              :disabled="!run.canStop"
              @click="run.stopFromUser()"
            >
              <Square :size="13" fill="currentColor" aria-hidden="true" />
              {{
                run.stage === 'stopping' ? t('performanceTest.stopping') : t('performanceTest.stop')
              }}
            </Button>
            <Button
              v-else
              class="performance-test__run ml-auto min-w-20 gap-1.5 px-3 text-[13px]/5"
              variant="inverted"
              size="md"
              type="button"
              :disabled="!canRun"
              @click="startRun"
            >
              <Play :size="14" fill="currentColor" aria-hidden="true" />
              {{ t('performanceTest.run') }}
            </Button>
          </div>

          <p
            v-if="workflow.error"
            class="performance-test__status performance-test__workflow-error m-0 mt-2.5 flex items-center gap-1.5 text-[12px] leading-[1.4] text-danger"
            role="alert"
          >
            <CircleAlert :size="13" class="shrink-0" aria-hidden="true" />
            {{ workflow.error }}
          </p>
          <div
            v-if="workflow.example.pendingLabel || workflow.example.download"
            class="performance-test__status mt-2.5 flex min-w-0 items-center gap-2 text-[12px] leading-[1.4] text-text-muted"
          >
            <template v-if="workflow.example.pendingLabel">
              {{ t('performanceTest.preparingExampleWorkflow') }}
            </template>
            <template v-else-if="workflow.example.download">
              <span class="truncate">{{ workflow.example.download.message }}</span>
              <span
                class="performance-test__example-download-bar block h-[3px] w-36 flex-none overflow-hidden rounded-[2px] bg-white/10"
                role="progressbar"
                :aria-valuenow="
                  workflow.example.download.percent >= 0
                    ? workflow.example.download.percent
                    : undefined
                "
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-label="t('performanceTest.exampleModelsDownload')"
              >
                <span
                  v-if="workflow.example.download.percent >= 0"
                  class="block h-full rounded-[inherit] bg-neutral-100 transition-[width] duration-[400ms]"
                  :style="{ width: `${workflow.example.download.percent}%` }"
                />
                <span
                  v-else
                  class="performance-test__example-download-bar--indeterminate block h-full w-[30%] animate-[performance-test-download-pulse_1.2s_ease-in-out_infinite_alternate] rounded-[inherit] bg-neutral-100"
                />
              </span>
              <Button
                class="performance-test__cancel-download h-6 gap-1 rounded-md px-1.5 text-[12px] font-normal"
                variant="muted-textonly"
                size="unset"
                type="button"
                :disabled="workflow.isDeleting"
                @click="workflow.remove()"
              >
                <X :size="13" aria-hidden="true" />
                {{ t('performanceTest.cancelExampleDownload') }}
              </Button>
            </template>
          </div>

          <PerformanceTestCard
            class="performance-test__results-section mt-6"
            :title="t('performanceTest.results')"
          >
            <template #header>
              <I18nT
                v-if="run.request"
                keypath="performanceTest.resultContext"
                tag="span"
                scope="global"
                class="performance-test__run-label ml-3 min-w-0 truncate"
              >
                <template #workflow>
                  <span class="text-foreground">{{ run.request.workflowName }}</span>
                </template>
                <template #build>{{ run.request.buildName }}</template>
              </I18nT>
              <div
                v-if="resultsFolder"
                class="performance-test__results-actions ml-auto -mr-2 flex shrink-0 items-center gap-0.5"
              >
                <span
                  v-if="exportResultsError"
                  class="performance-test__export-error mr-2 text-[12px] text-danger"
                  role="alert"
                >
                  {{ exportResultsError }}
                </span>
                <Button
                  class="performance-test__open-results h-[30px] gap-1.5 rounded-lg px-2 text-[12.5px]/5 font-normal"
                  variant="muted-textonly"
                  size="unset"
                  type="button"
                  :title="t('performanceTest.openResultsFolder')"
                  @click="openResultsFolder"
                >
                  <FolderOpen :size="15" aria-hidden="true" />
                  <span class="@max-[640px]:sr-only">{{
                    t('performanceTest.openResultsFolder')
                  }}</span>
                </Button>
                <Button
                  v-if="canExport"
                  class="performance-test__export-results h-[30px] gap-1.5 rounded-lg px-2 text-[12.5px]/5 font-normal"
                  variant="muted-textonly"
                  size="unset"
                  type="button"
                  :title="t('performanceTest.exportResultsImage')"
                  :disabled="isExportingResults"
                  @click="exportResultsImage"
                >
                  <ImageDown :size="15" aria-hidden="true" />
                  <span class="@max-[640px]:sr-only">{{
                    isExportingResults
                      ? t('performanceTest.exportingImage')
                      : t('performanceTest.exportResultsImage')
                  }}</span>
                </Button>
              </div>
            </template>
            <div class="performance-test__results">
              <PerformanceTestResultSummary v-if="summary" :summary="summary" />
              <div
                v-else-if="run.failure"
                class="performance-test__failure flex items-start gap-2.5 pt-1 pb-1.5"
                role="alert"
              >
                <CircleAlert :size="16" class="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                <div class="min-w-0">
                  <p class="m-0 mb-1 text-[15px] font-medium text-foreground">
                    {{ t('performanceTest.runFailedTitle') }}
                  </p>
                  <p
                    class="performance-test__failure-message m-0 line-clamp-2 [overflow-wrap:anywhere]"
                    :title="run.failure"
                  >
                    {{ run.failure }}
                  </p>
                  <p class="m-0 mt-1">{{ t('performanceTest.runFailedHint') }}</p>
                </div>
              </div>
              <PerformanceTestProgress
                v-else-if="run.isBusy && run.request"
                :stage="run.stage"
                :completed-runs="run.completedRuns"
                :total-runs="run.totalRuns"
                :warmup-runs="run.request.warmupRuns"
              />
              <div v-else class="performance-test__results-placeholder pt-1 pb-1.5">
                <p class="m-0 mb-1.5 text-[15px] font-medium text-foreground">
                  {{ t('performanceTest.resultsEmptyTitle') }}
                </p>
                <p class="m-0">{{ t('performanceTest.resultsPlaceholder') }}</p>
              </div>
            </div>
          </PerformanceTestCard>

          <PerformanceTestSystemFacts v-if="facts.length > 0" :facts="facts" />

          <PerformanceTestLogs v-model:expanded="logsExpanded" :logs="run.logs" />
        </div>
      </div>
    </div>

    <BaseModal
      :open="workflow.example.isPickerOpen"
      size="xl"
      :aria-label="t('performanceTest.exampleWorkflowPickerTitle')"
      content-class="performance-test__example-modal"
      @close="workflow.example.isPickerOpen = false"
    >
      <template #header>
        <div>
          <h2 class="m-0 text-base leading-[1.3] font-semibold text-neutral-100">
            {{ t('performanceTest.exampleWorkflowPickerTitle') }}
          </h2>
          <p class="m-0 mt-1.5 text-[13px] text-text-muted">
            {{ t('performanceTest.exampleWorkflowPickerDescription') }}
          </p>
        </div>
      </template>
      <p
        v-if="workflow.example.diskError"
        class="performance-test__example-disk-error mt-0 mr-0 mb-3 ml-0 text-[12px] text-danger"
        role="alert"
      >
        {{ workflow.example.diskError }}
      </p>
      <TemplatePickerStep
        ref="examplePicker"
        :options="workflow.example.options"
        :selected-value="workflow.example.selectedId"
        :disk-space="workflow.example.diskSpace"
        :disk-space-loading="false"
        compact
        @select="workflow.example.selectedId = $event.value"
      />
      <template #footer>
        <Button
          variant="secondary"
          size="lg"
          type="button"
          @click="workflow.example.isPickerOpen = false"
        >
          {{ t('common.cancel') }}
        </Button>
        <Button
          variant="inverted"
          size="lg"
          type="button"
          :disabled="!workflow.example.selectedId || !!workflow.example.diskError"
          data-testid="performance-test-use-example"
          @click="workflow.example.prepare()"
        >
          {{ t('performanceTest.useExampleWorkflow') }}
        </Button>
      </template>
    </BaseModal>
  </BrandBackground>
</template>

<style>
@keyframes performance-test-download-pulse {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(333%);
  }
}
</style>
