<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import { useEventListener } from '@vueuse/core'
import { computed, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInstallationStore } from '../stores/installationStore'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallContextMenu } from '../composables/useInstallContextMenu'
import { useInstallList } from '../composables/useInstallList'
import { useInstallingBuilds } from '../composables/useBuildProgress'
import { useModal } from '../composables/useModal'
import { useCloudGate } from '../composables/useCloudGate'
import { emitTelemetryAction } from '../lib/telemetry'
import { Plus, RefreshCw, Search, Server } from '@lucide/vue'
import WhyTryCloudModal from '../components/WhyTryCloudModal.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import BaseSelect from '../components/ui/BaseSelect.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import SplitButton from '../components/ui/SplitButton.vue'
import ChooserFamilyGrid from './chooser/ChooserFamilyGrid.vue'
import { focusRunningBuild } from '../lib/focusRunningBuild'
import { openInstallManager } from '../lib/openInstallManager'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import type { FilterKey } from '../composables/useInstallList'
import type { CloudUserTier, Installation, ShowProgressOpts } from '../types/ipc'
import { isInstallationInWorkspace } from '../../../shared/workspaces'

const props = withDefaults(
  defineProps<{
    visible?: boolean
  }>(),
  {
    visible: true
  }
)

const emit = defineEmits<{
  pick: [installation: Installation]
  'open-details': [installation: Installation]
  'show-new-install': []
  'show-build-import': [flow: 'track' | 'load-snapshot']
  'show-progress': [opts: ShowProgressOpts]
}>()

const { t } = useI18n()
const buildMenuOpen = ref(false)
useEventListener(window, 'blur', () => {
  buildMenuOpen.value = false
})
watch(
  () => props.visible,
  (visible) => {
    if (!visible) buildMenuOpen.value = false
  }
)
const installationStore = useInstallationStore()
const authStore = useAuthStore()
const modal = useModal()
const dashboardScope = useDashboardScopeStore()
void dashboardScope.initialize()

onMounted(() => {
  if (installationStore.installations.length === 0) {
    void installationStore.fetchInstallations()
  }
})

const installationsRef = toRef(installationStore, 'installations')
const { searchQuery, activeFilter, effectiveInstalls, visibleInstalls } = useInstallList({
  installations: installationsRef
})

defineExpose({ activeFilter })

const selectedManagedWorkspaceId = computed(() =>
  authStore.sessionWorkspaceFor(dashboardScope.selectedWorkspaceId)
)

let buildPrefetchGeneration = 0
watch(
  [() => authStore.isSignedIn, selectedManagedWorkspaceId],
  async ([signedIn, workspaceId]) => {
    const generation = ++buildPrefetchGeneration
    if (!signedIn || !workspaceId) return
    const intent = dashboardScope.takeChosenSelection() ? 'chosen' : 'restored'
    try {
      if (authStore.status.workspaceId !== workspaceId) {
        await authStore.switchWorkspace(workspaceId, intent)
      }
      if (
        generation !== buildPrefetchGeneration ||
        selectedManagedWorkspaceId.value !== workspaceId ||
        authStore.status.workspaceId !== workspaceId
      )
        return
      await authStore.fetchBuilds()
    } catch {}
  },
  { immediate: true }
)

function installationIsInSelectedScope(inst: Installation): boolean {
  return isInstallationInWorkspace(inst, dashboardScope.selectedWorkspaceId)
}

const sortOrder = ref<'used' | 'name'>('used')
const sortOptions = computed(() => [
  { value: 'used', label: t('chooser.sortLastUsed') },
  { value: 'name', label: t('chooser.sortName') }
])

const isInstalling = useInstallingBuilds()
const scopedVisibleInstalls = computed(() => {
  const inScope = visibleInstalls.value.filter(installationIsInSelectedScope)
  const sorted =
    sortOrder.value === 'name' ? [...inScope].sort((a, b) => a.name.localeCompare(b.name)) : inScope
  return [
    ...sorted.filter((inst) => isInstalling(inst.id)),
    ...sorted.filter((inst) => !isInstalling(inst.id))
  ]
})
const scopedInstalls = computed(() => effectiveInstalls.value.filter(installationIsInSelectedScope))

const whereOptions = computed(() => {
  const count = (category: string): number =>
    scopedInstalls.value.filter((inst) => inst.sourceCategory === category).length
  const options: { value: FilterKey; label: string; count: number }[] = [
    { value: 'all', label: t('chooser.filterAll'), count: scopedInstalls.value.length },
    { value: 'local', label: t('chooser.filterThisComputer'), count: count('local') }
  ]
  if (count('cloud') > 0) {
    options.push({ value: 'cloud', label: t('chooser.filterCloud'), count: count('cloud') })
  }
  if (count('remote') > 0) {
    options.push({ value: 'remote', label: t('chooser.filterRemote'), count: count('remote') })
  }
  return options
})
watch(whereOptions, (options) => {
  if (!options.some((option) => option.value === activeFilter.value)) activeFilter.value = 'all'
})

const hasFilters = computed(
  () => searchQuery.value.trim().length > 0 || activeFilter.value !== 'all'
)
const hasNoBuilds = computed(() => scopedInstalls.value.length === 0)
const showNoMatches = computed(
  () => !hasNoBuilds.value && scopedVisibleInstalls.value.length === 0 && hasFilters.value
)
const showNoBuilds = computed(
  () => hasNoBuilds.value || (scopedVisibleInstalls.value.length === 0 && !hasFilters.value)
)

function clearFilters(): void {
  searchQuery.value = ''
  activeFilter.value = 'all'
}

const refreshingWorkspace = computed(() => authStore.loadingWorkspaces || authStore.loadingBuilds)

async function refreshWorkspace(): Promise<void> {
  emitTelemetryAction('comfy.desktop.workspace.refresh', {})
  const selected = selectedManagedWorkspaceId.value
  if (selected && authStore.status.workspaceId !== selected) {
    await authStore.switchWorkspace(selected).catch(() => {})
  }
  await Promise.all([authStore.fetchWorkspaces(), authStore.fetchBuilds()])
}

const { viewError, viewDanger } = useInstallContextMenu({
  onManage: (inst, options) =>
    options ? openInstallManager(inst, options) : emit('open-details', inst),
  onShowProgress: (showOpts) => emit('show-progress', showOpts)
})

async function pickInstall(inst: Installation): Promise<void> {
  if (await focusRunningBuild(inst)) return
  emit('pick', inst)
}

const cloudGate = useCloudGate({ immediate: false })

const cloudFreeRunsEnabled = ref(false)
const cloudUserTier = ref<CloudUserTier>('unknown')
const cloudUserTierResolved = ref(false)
const showCloudFreeRunsPill = computed(
  () => cloudFreeRunsEnabled.value && cloudUserTier.value !== 'paid'
)

const showWhyCloud = computed(() => cloudUserTierResolved.value && cloudUserTier.value !== 'paid')

const whyCloudOpen = ref(false)

function openWhyCloud(): void {
  whyCloudOpen.value = true
  emitTelemetryAction('comfy.desktop.dashboard.why_cloud_opened', {})
}

function dismissWhyCloud(): void {
  whyCloudOpen.value = false
  emitTelemetryAction('comfy.desktop.dashboard.why_cloud_action', { action: 'dismiss' })
}

async function onWhyCloudTryCloud(): Promise<void> {
  emitTelemetryAction('comfy.desktop.dashboard.why_cloud_action', { action: 'try_cloud' })
  if (await cloudGate.openCloud()) {
    whyCloudOpen.value = false
    return
  }
  await modal.alert({
    title: t('installShowcase.cloudFailedTitle'),
    message: t('installShowcase.cloudFailedMessage')
  })
}
onMounted(async () => {
  const [freeRunsResult, userTierResult] = await Promise.allSettled([
    window.api.getCloudFreeRunsEnabled(),
    window.api.getCloudUserTier()
  ])
  if (freeRunsResult.status === 'fulfilled') {
    cloudFreeRunsEnabled.value = freeRunsResult.value
  }
  if (userTierResult.status === 'fulfilled') {
    cloudUserTier.value = userTierResult.value
    cloudUserTierResolved.value = true
  }
})
function handleNewInstallClick(): void {
  emit('show-new-install')
}

const gridHandlers = {
  pick: pickInstall,
  'open-details': (inst: Installation) => emit('open-details', inst),
  'view-error': viewError,
  'view-danger': viewDanger,
  'why-cloud': openWhyCloud
}
</script>

<template>
  <div
    v-show="props.visible"
    class="chooser-view chooser-view--workspace flex min-h-0 w-full flex-auto flex-col overflow-y-auto"
    :class="PAGE_SPOTLIGHT_CLASS"
  >
    <div class="mx-auto w-full max-w-300 px-10 pb-24">
      <header class="chooser-header flex items-end justify-between gap-6 pt-9 pb-6">
        <h1 class="m-0 text-[22px]/[1.4] font-semibold tracking-[-0.01em] text-foreground">
          {{ t('chooser.buildsTitle') }}
        </h1>
        <SplitButton
          v-model:open="buildMenuOpen"
          class="shrink-0"
          :label="t('chooser.newBuildLabel')"
          :menu-label="t('chooser.moreBuildOptions')"
          menu-testid="build-actions-menu-trigger"
          @run="handleNewInstallClick"
        >
          <span class="chooser-tile-new inline-flex items-center gap-1">
            <Plus :size="14" aria-hidden="true" />
            {{ t('chooser.newBuild') }}
          </span>
          <template #menu>
            <MenuItem
              as="button"
              type="button"
              class="w-full"
              data-testid="build-actions-add-existing"
              @select="emit('show-build-import', 'track')"
              >{{ t('chooser.addExistingBuild') }}</MenuItem
            >
            <MenuItem
              as="button"
              type="button"
              class="w-full"
              data-testid="build-actions-load-snapshot"
              @select="emit('show-build-import', 'load-snapshot')"
              >{{ t('fileMenu.loadSnapshot') }}</MenuItem
            >
          </template>
        </SplitButton>
      </header>

      <div class="chooser-toolbar mb-5 flex min-h-8 flex-wrap items-center gap-2">
        <SegmentedControl
          v-if="!hasNoBuilds"
          v-model="activeFilter"
          :options="whereOptions"
          :label="t('chooser.whereLabel')"
        />
        <div class="ml-auto flex items-center gap-2">
          <Button
            v-if="authStore.isSignedIn"
            variant="muted-textonly"
            size="icon"
            type="button"
            class="chooser-workspace-refresh"
            :disabled="refreshingWorkspace"
            :aria-label="t('devPlatform.workspace.refresh')"
            :title="t('devPlatform.workspace.refresh')"
            data-testid="chooser-workspace-refresh"
            @click="refreshWorkspace"
          >
            <RefreshCw
              :size="13"
              :class="{
                'chooser-workspace-refresh__icon--busy animate-spin [animation-duration:900ms]':
                  refreshingWorkspace
              }"
            />
          </Button>
          <div v-if="!hasNoBuilds" class="w-38">
            <BaseSelect
              v-model="sortOrder"
              :options="sortOptions"
              :aria-label="t('chooser.sortLabel')"
              compact
            />
          </div>
          <div v-if="!hasNoBuilds" class="chooser-search w-[220px]">
            <BaseInput
              v-model="searchQuery"
              class="h-8 [&_input]:text-[13px]"
              :placeholder="t('chooser.searchBuilds')"
              :aria-label="t('chooser.searchBuilds')"
            >
              <template #leading><Search :size="14" /></template>
            </BaseInput>
          </div>
        </div>
        <p
          v-if="authStore.workspaceSwitchFailure"
          class="m-0 basis-full text-[13px]/5 text-muted-foreground"
          role="status"
          data-testid="chooser-workspace-switch-failure"
        >
          {{
            authStore.workspaceSwitchFailure === 'unavailable'
              ? t('devPlatform.workspace.switchUnavailable')
              : t('devPlatform.workspace.switchRetryable')
          }}
        </p>
      </div>

      <div
        v-if="
          !dashboardScope.initialized ||
          (installationStore.loading && installationStore.installations.length === 0)
        "
        class="chooser-loading flex items-center justify-center p-6 opacity-60"
      >
        {{ t('common.loading') }}
      </div>

      <EmptyState
        v-else-if="showNoMatches"
        class="chooser-empty px-6 py-16"
        :icon="Server"
        :title="t('chooser.nothingMatches')"
        :text="t('chooser.nothingMatchesHint')"
      >
        <Button
          type="button"
          variant="secondary"
          size="md"
          class="px-3 text-[13px]/5"
          @click="clearFilters"
        >
          {{ t('chooser.clearFilters') }}
        </Button>
      </EmptyState>

      <EmptyState
        v-else-if="showNoBuilds"
        class="chooser-no-builds px-6 py-16"
        :icon="Server"
        :title="t('chooser.noBuildsTitle')"
        :text="t('chooser.noBuildsBody')"
      />

      <ChooserFamilyGrid
        v-else
        :installations="scopedVisibleInstalls"
        :show-free-runs-pill="showCloudFreeRunsPill"
        :show-why-cloud="showWhyCloud"
        v-on="gridHandlers"
      />
    </div>

    <WhyTryCloudModal
      v-if="whyCloudOpen"
      @close="dismissWhyCloud"
      @try-cloud="onWhyCloudTryCloud"
    />
  </div>
</template>
