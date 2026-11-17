<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import { useElementSize, useEventListener } from '@vueuse/core'
import { computed, nextTick, onMounted, ref, toRef, useTemplateRef, watch } from 'vue'
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
import { Plus, RefreshCw, Search } from '@lucide/vue'
import WhyTryCloudModal from '../components/WhyTryCloudModal.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import BaseSelect from '../components/ui/BaseSelect.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import SplitButton from '../components/ui/SplitButton.vue'
import ChooserFamilyGrid from './chooser/ChooserFamilyGrid.vue'
import { focusRunningBuild } from '../lib/focusRunningBuild'
import { provideBuildMenuHost, useBuildMenuHost } from '../panel/home/useBuildMenu'
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
  const options: { value: FilterKey; label: string }[] = [
    { value: 'all', label: t('chooser.filterAll') },
    { value: 'local', label: t('chooser.filterThisComputer') }
  ]
  if (count('cloud') > 0) options.push({ value: 'cloud', label: t('chooser.filterCloud') })
  if (count('remote') > 0) options.push({ value: 'remote', label: t('chooser.filterRemote') })
  return options
})
watch(whereOptions, (options) => {
  if (!options.some((option) => option.value === activeFilter.value)) activeFilter.value = 'all'
})

const hasFilters = computed(
  () => searchQuery.value.trim().length > 0 || activeFilter.value !== 'all'
)
const showNoMatches = computed(() => scopedVisibleInstalls.value.length === 0 && hasFilters.value)
const showNoBuilds = computed(() => scopedVisibleInstalls.value.length === 0 && !hasFilters.value)

function clearFilters(): void {
  searchQuery.value = ''
  activeFilter.value = 'all'
}

const TOOLBAR_GAP = 8
const SORT_WIDTH = 152
const SEARCH_WIDTH = 220
const ICON_WIDTH = 32
const { width: toolbarWidth } = useElementSize(useTemplateRef<HTMLElement>('toolbar'))
const { width: tabsWidth } = useElementSize(useTemplateRef<HTMLElement>('toolbarTabs'))
const toolbarLayout = computed<'full' | 'icon' | 'stacked'>(() => {
  const refresh = authStore.isSignedIn ? ICON_WIDTH + TOOLBAR_GAP : 0
  const line = tabsWidth.value + TOOLBAR_GAP + refresh + SORT_WIDTH + TOOLBAR_GAP
  if (toolbarWidth.value >= line + SEARCH_WIDTH) return 'full'
  if (toolbarWidth.value >= line + ICON_WIDTH) return 'icon'
  return 'stacked'
})
const searchOpen = ref(false)
const searchFolded = computed(() => toolbarLayout.value === 'icon' && !searchOpen.value)
const searchField = useTemplateRef<HTMLElement>('searchField')

async function openSearch(): Promise<void> {
  searchOpen.value = true
  await nextTick()
  searchField.value?.querySelector('input')?.focus()
}

function closeSearchIfEmpty(event: FocusEvent): void {
  const next = event.relatedTarget as Node | null
  if (next && searchField.value?.contains(next)) return
  if (!searchQuery.value.trim()) searchOpen.value = false
}

function closeSearch(): void {
  searchQuery.value = ''
  searchOpen.value = false
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

function canPromoteToWorkspace(inst: Installation): boolean {
  return (
    authStore.isSignedIn &&
    Boolean(authStore.status.workspaceId) &&
    inst.status === 'installed' &&
    inst.sourceCategory === 'local' &&
    Boolean(inst.installPath)
  )
}

provideBuildMenuHost({ ...useBuildMenuHost(), canPromoteToWorkspace })

const { viewError, viewDanger, isPromotingToWorkspace } = useInstallContextMenu({
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

      <div
        ref="toolbar"
        class="chooser-toolbar mb-5 flex min-h-8 flex-wrap items-center gap-2"
        :data-layout="toolbarLayout"
      >
        <div ref="toolbarTabs" class="shrink-0">
          <SegmentedControl
            v-model="activeFilter"
            :options="whereOptions"
            :label="t('chooser.whereLabel')"
          />
        </div>
        <div
          class="flex min-w-0 items-center gap-2"
          :class="toolbarLayout === 'stacked' ? 'basis-full' : 'ml-auto'"
        >
          <Button
            v-if="authStore.isSignedIn"
            variant="muted-textonly"
            size="icon"
            type="button"
            class="chooser-workspace-refresh shrink-0"
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
          <div v-show="toolbarLayout !== 'icon' || !searchOpen" class="w-38 shrink-0">
            <BaseSelect
              v-model="sortOrder"
              :options="sortOptions"
              :aria-label="t('chooser.sortLabel')"
              compact
            />
          </div>
          <Button
            v-if="searchFolded"
            variant="muted-textonly"
            size="icon"
            type="button"
            class="chooser-search-toggle shrink-0"
            :aria-label="t('chooser.searchBuilds')"
            :title="t('chooser.searchBuilds')"
            data-testid="chooser-search-toggle"
            @click="openSearch"
          >
            <Search :size="14" />
          </Button>
          <div
            v-else
            ref="searchField"
            class="chooser-search"
            :class="{
              'w-[220px]': toolbarLayout === 'full',
              'w-[192px]': toolbarLayout === 'icon',
              'min-w-0 flex-1': toolbarLayout === 'stacked'
            }"
            @focusout="closeSearchIfEmpty"
            @keydown.esc="closeSearch"
          >
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

      <section
        v-else-if="showNoMatches"
        class="chooser-empty flex flex-col items-center gap-3 px-6 py-16 text-center"
      >
        <div class="flex flex-col gap-1.5">
          <h2 class="m-0 text-[16px]/6 font-semibold text-foreground">
            {{ t('chooser.nothingMatches') }}
          </h2>
          <p class="m-0 text-[13px]/5 text-muted-foreground">
            {{ t('chooser.nothingMatchesHint') }}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="md"
          class="px-3 text-[13px]/5"
          @click="clearFilters"
        >
          {{ t('chooser.clearFilters') }}
        </Button>
      </section>

      <section
        v-else-if="showNoBuilds"
        class="chooser-no-builds flex flex-col items-center gap-3 px-6 py-16 text-center"
      >
        <div class="flex max-w-[420px] flex-col gap-1.5">
          <h2 class="m-0 text-[16px]/6 font-semibold text-foreground">
            {{ t('chooser.noBuildsTitle') }}
          </h2>
          <p class="m-0 text-[13px]/5 text-muted-foreground">
            {{ t('chooser.noBuildsBody') }}
          </p>
        </div>
        <Button
          type="button"
          variant="inverted"
          size="md"
          class="gap-1.5 px-3 text-[13px]/5"
          @click="handleNewInstallClick"
        >
          <Plus :size="15" aria-hidden="true" />
          {{ t('chooser.newBuild') }}
        </Button>
      </section>

      <ChooserFamilyGrid
        v-else
        :installations="scopedVisibleInstalls"
        :show-free-runs-pill="showCloudFreeRunsPill"
        :show-why-cloud="showWhyCloud"
        :is-promoting-to-workspace="isPromotingToWorkspace"
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
