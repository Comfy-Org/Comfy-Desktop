<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LoaderCircle, OctagonAlert } from '@lucide/vue'
import ComfyUISettingsContent from '../components/settings/ComfyUISettingsContent.vue'
import StatusChip from '../components/ui/StatusChip.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import BuildUninstallFailed from './BuildUninstallFailed.vue'
import HomeBuildCard from './home/HomeBuildCard.vue'
import { homeBuildStatus, homeBuildTones } from './home/homeBuild'
import type { StorageSnapshot } from '../views/comfyUISettings/StoragePane.vue'
import {
  buildFailure,
  operationFailureOf,
  operationTask,
  uninstallFailureOf,
  useBuildProgress
} from '../composables/useBuildProgress'
import { installTypeMetaForInstall } from '../lib/installTypeIcon'
import { useInstallationStore } from '../stores/installationStore'
import { useProgressStore } from '../stores/progressStore'
import { useSessionStore } from '../stores/sessionStore'
import type { Installation, ShowProgressOpts } from '../types/ipc'

const ACTIONS_ID = 'build-details-actions'
const TITLE_ID = 'build-details-title'

const { installation } = defineProps<{
  installation: Installation
}>()

const emit = defineEmits<{
  back: []
  launch: [installation: Installation]
  'show-progress': [opts: ShowProgressOpts]
  'view-error': [installation: Installation]
}>()

const { t } = useI18n()
const sessionStore = useSessionStore()
const progressStore = useProgressStore()
const installationStore = useInstallationStore()

const { progress, viewLogs } = useBuildProgress(() => installation)
const uninstalling = computed(() => progress.value?.kind === 'uninstall')
const updating = computed(() => progress.value?.kind === 'update')
const working = computed(() => progress.value?.kind === 'working')
const cardReplacesSettings = computed(() => uninstalling.value || updating.value || working.value)
const uninstallFailure = computed(() => uninstallFailureOf(progressStore, installation.id))
const operationFailure = computed(() => operationFailureOf(progressStore, installation.id))
const failedTaskTitle = computed(() => {
  const op = progressStore.operations.get(installation.id)
  return t('workingProgress.failedTitle', { task: op ? operationTask(op.title) : '' })
})
const settingsHidden = computed(
  () =>
    cardReplacesSettings.value || uninstallFailure.value !== null || operationFailure.value !== null
)
const tone = computed(() => homeBuildTones([installation], installationStore.installations)[0]!)

const typeMeta = computed(() => installTypeMetaForInstall(installation))

const whereLabel = computed(() => {
  if (installation.sourceCategory === 'cloud') return t('chooser.filterCloud')
  if (installation.sourceCategory === 'remote') return t('chooser.filterRemote')
  return t('chooser.filterThisComputer')
})
const metaLine = computed(() =>
  [whereLabel.value, t(typeMeta.value.labelKey), installation.version].filter(Boolean).join(' · ')
)

const failure = computed(() => buildFailure(installation, sessionStore, progressStore, t))
const failureHint = computed(() => {
  const kind = failure.value?.kind
  if (!kind || kind === 'broken' || cardReplacesSettings.value) return ''
  return kind === 'didnt-start' ? t('home.buildClickToViewLogs') : t('chooser.viewErrorTooltip')
})
function openFailure(): void {
  if (failure.value?.kind === 'didnt-start') viewLogs()
  else emit('view-error', installation)
}

const status = computed(() => {
  const id = installation.id
  if (uninstalling.value) {
    return { tone: 'quiet', label: 'uninstallProgress.status', spinning: true } as const
  }
  if (updating.value) {
    return { tone: 'quiet', label: 'updateProgress.status', spinning: true } as const
  }
  if (working.value) {
    return { tone: 'quiet', text: progress.value?.task ?? '', spinning: true } as const
  }
  if (failure.value) return { tone: 'bad', text: failure.value.label } as const
  if (sessionStore.isStopping(id))
    return { tone: 'quiet', label: 'chooser.statusStopping' } as const
  if (sessionStore.isLaunching(id)) {
    return { tone: 'quiet', label: 'chooser.statusLaunching', spinning: true } as const
  }
  if (sessionStore.isRunning(id)) return { tone: 'go', label: 'chooser.statusRunning' } as const
  return null
})

const storage = ref<StorageSnapshot | undefined>()

async function loadStorage(): Promise<void> {
  storage.value = await window.api.getBuildStorageSnapshot()
}

let unsubscribeSettings: (() => void) | undefined
onMounted(() => {
  void loadStorage()
  unsubscribeSettings = window.api.onSettingsChanged(() => void loadStorage())
})
onUnmounted(() => unsubscribeSettings?.())
</script>

<template>
  <div class="build-details flex min-h-0 w-full flex-auto flex-col" data-testid="build-details">
    <div class="mx-auto flex min-h-0 w-full max-w-300 flex-auto flex-col px-10">
      <header class="flex shrink-0 flex-wrap items-center gap-x-[18px] gap-y-3 pt-9 pb-6">
        <div class="min-w-0 flex-1 basis-60">
          <div class="flex min-w-0 items-center gap-2">
            <h1
              :id="TITLE_ID"
              class="m-0 flex min-w-0 text-display font-semibold tracking-[-0.055em] text-foreground"
            >
              <span v-if="settingsHidden" class="truncate">{{ installation.name }}</span>
            </h1>
            <Tooltip v-if="failureHint" :text="failureHint" side="top" :delay-ms="500">
              <button
                type="button"
                class="build-details-failure flex cursor-pointer rounded-full transition-opacity outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="build-details-failure"
                @click="openFailure"
              >
                <StatusChip class="build-details-status" tone="bad">
                  <template #icon><OctagonAlert :size="11" aria-hidden="true" /></template>
                  {{ failure?.label }}
                </StatusChip>
              </button>
            </Tooltip>
            <StatusChip v-else-if="status" class="build-details-status" :tone="status.tone">
              <template v-if="status.tone === 'bad'" #icon>
                <OctagonAlert :size="11" aria-hidden="true" />
              </template>
              <template v-else-if="'spinning' in status" #icon>
                <LoaderCircle
                  :size="11"
                  class="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              </template>
              {{ 'text' in status ? status.text : t(status.label) }}
            </StatusChip>
          </div>
          <p
            class="build-details-meta m-0 mt-1.5 flex min-w-0 items-center gap-1.5 text-[13px]/5 text-muted-foreground"
          >
            <component :is="typeMeta.icon" :size="14" class="shrink-0" aria-hidden="true" />
            <span class="truncate">{{ metaLine }}</span>
          </p>
        </div>
        <div :id="ACTIONS_ID" class="flex shrink-0 items-center gap-2" />
      </header>

      <HomeBuildCard
        v-if="cardReplacesSettings"
        class="shrink-0"
        :build="installation"
        :status="homeBuildStatus(installation, sessionStore)"
        :tone="tone"
      />
      <BuildUninstallFailed
        v-else-if="uninstallFailure !== null"
        :reason="uninstallFailure"
        @retry="progressStore.retryOperation(installation.id)"
        @dismiss="progressStore.dismissOperation(installation.id)"
      />
      <BuildUninstallFailed
        v-else-if="operationFailure !== null"
        kind="operation"
        :title="failedTaskTitle"
        :reason="operationFailure"
        @retry="progressStore.retryOperation(installation.id)"
        @dismiss="progressStore.dismissOperation(installation.id)"
      />
      <ComfyUISettingsContent
        v-else
        :installation="installation"
        :global-settings-snapshot="storage"
        :page-actions-target="`#${ACTIONS_ID}`"
        :page-title-target="`#${TITLE_ID}`"
        class="min-h-0 flex-auto"
        @show-progress="emit('show-progress', $event)"
        @navigate-list="emit('back')"
        @request-close="emit('back')"
        @request-dismiss="emit('back')"
        @primary-action="emit('launch', installation)"
      />
    </div>
  </div>
</template>
