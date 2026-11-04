<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import { computed, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInstallationStore } from '../stores/installationStore'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallContextMenu } from '../composables/useInstallContextMenu'
import { useInstallList } from '../composables/useInstallList'
import { useModal } from '../composables/useModal'
import { useCloudGate } from '../composables/useCloudGate'
import { emitTelemetryAction } from '../lib/telemetry'
import { Plus, RefreshCw, Search } from 'lucide-vue-next'
import ContextMenu from '../components/ContextMenu.vue'
import WhyTryCloudModal from '../components/WhyTryCloudModal.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import BaseSelect from '../components/ui/BaseSelect.vue'
import SegmentedControl from '../components/ui/SegmentedControl.vue'
import ChooserFamilyGrid from './chooser/ChooserFamilyGrid.vue'
import { focusRunningBuild } from '../lib/focusRunningBuild'
import { openInstallManager } from '../lib/openInstallManager'
import type { FilterKey } from '../composables/useInstallList'
import type { CloudUserTier, Installation, ShowProgressOpts } from '../types/ipc'
import { PERSONAL_WORKSPACE_ID } from '../../../shared/workspaces'

/**
 * Chooser view - recents grid.
 *
 * A golden-ratio tile grid the user picks from. The install-less host
 * window hosts this as the Comfy tab body when no install backs the
 * entry.
 *
 * Every user has a local Personal workspace. Signed-in users additionally see
 * authenticated team workspaces; the server Personal workspace merges into
 * the local Personal scope.
 * Available Builds belong in the workspace New Instance flow, not this grid.
 */

const props = withDefaults(
  defineProps<{
    visible?: boolean
  }>(),
  {
    visible: true
  }
)

const emit = defineEmits<{
  /** User picked an install - caller decides whether to swap-in-place,
   *  open a fresh window, or hand off to a launch flow. */
  pick: [installation: Installation]
  /** User asked to see or manage a build. */
  'open-details': [installation: Installation]
  /** User triggered the new-install flow in the current dashboard scope. */
  'show-new-install': []
  /** Forward a long-running dashboard action to PanelApp so it can wire
   *  the operation through `progressStore`. */
  'show-progress': [opts: ShowProgressOpts]
}>()

const { t } = useI18n()
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

// Filter / search / recency logic is shared with the title-bar
// instance picker popover via `useInstallList` so the two surfaces
// cannot drift. The chip UI is currently hidden in the brand redesign
// but the underlying `activeFilter` ref + filter switch stay wired;
// tests reach into `vm.activeFilter` to drive the filter-based
// regressions guard.
//
// "Local" includes both standalone local installs and Legacy Desktop
// installs (both report `sourceCategory === 'local'`) - they're
// conceptually the same family from the user's POV. Cloud installs
// flow through `visibleInstalls` like every other source - there is no
// special cloud surface anymore.
const installationsRef = toRef(installationStore, 'installations')
const { searchQuery, activeFilter, effectiveInstalls, visibleInstalls } = useInstallList({
  installations: installationsRef
})

// Explicitly expose `activeFilter` so the brand-redesign tests can
// drive the underlying filter state without the chip UI mounted.
// `<script setup>` would otherwise auto-hide it because the template
// doesn't reference the ref directly (chips are TODO(brand-cleanup)).
defineExpose({ activeFilter })

// --- Dashboard scope ---

/** Server workspace whose Builds belong to the selected dashboard scope. */
const selectedManagedWorkspaceId = computed(() => {
  if (!authStore.isSignedIn) return null
  if (dashboardScope.selectedWorkspaceId !== PERSONAL_WORKSPACE_ID) {
    return dashboardScope.selectedWorkspaceId
  }
  if (authStore.status.workspaceType === 'personal') return authStore.status.workspaceId ?? null
  return authStore.personalWorkspace?.id ?? null
})

// Warm the selected workspace's Build catalog while the user is still on the
// dashboard. New Instance can then choose its initial tab without waiting for
// a network request. A generation guard prevents a slower previous selection
// from fetching after the user has moved to another workspace.
let buildPrefetchGeneration = 0
watch(
  [() => authStore.isSignedIn, selectedManagedWorkspaceId],
  async ([signedIn, workspaceId]) => {
    const generation = ++buildPrefetchGeneration
    if (!signedIn || !workspaceId) return
    try {
      if (authStore.status.workspaceId !== workspaceId) {
        await authStore.switchWorkspace(workspaceId)
      }
      if (
        generation !== buildPrefetchGeneration ||
        selectedManagedWorkspaceId.value !== workspaceId
      )
        return
      await authStore.fetchBuilds()
    } catch {
      // The wizard retains its normal authorization and retry UI when a
      // background prefetch cannot complete.
    }
  },
  { immediate: true }
)

function installationIsInSelectedScope(inst: Installation): boolean {
  return dashboardScope.selectedWorkspaceId === PERSONAL_WORKSPACE_ID
    ? inst.workspaceId === undefined || inst.workspaceId === PERSONAL_WORKSPACE_ID
    : inst.workspaceId === dashboardScope.selectedWorkspaceId
}

const sortOrder = ref<'used' | 'name'>('used')
const sortOptions = computed(() => [
  { value: 'used', label: t('chooser.sortLastUsed') },
  { value: 'name', label: t('chooser.sortName') }
])

const scopedVisibleInstalls = computed(() => {
  const inScope = visibleInstalls.value.filter(installationIsInSelectedScope)
  return sortOrder.value === 'name'
    ? [...inScope].sort((a, b) => a.name.localeCompare(b.name))
    : inScope
})
const scopedInstalls = computed(() => effectiveInstalls.value.filter(installationIsInSelectedScope))

/** Cloud and Remote only get a tab when the scope has one. */
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
const showNoMatches = computed(() => scopedVisibleInstalls.value.length === 0 && hasFilters.value)
const showNoBuilds = computed(() => scopedVisibleInstalls.value.length === 0 && !hasFilters.value)

function clearFilters(): void {
  searchQuery.value = ''
  activeFilter.value = 'all'
}

const refreshingWorkspace = computed(() => authStore.loadingWorkspaces || authStore.loadingBuilds)

async function refreshWorkspace(): Promise<void> {
  emitTelemetryAction('comfy.desktop.workspace.refresh', {})
  await Promise.all([authStore.fetchWorkspaces(), authStore.fetchBuilds()])
}

// --- Manage / context menu ---

function canPromoteToWorkspace(inst: Installation): boolean {
  return (
    authStore.isSignedIn &&
    Boolean(authStore.status.workspaceId) &&
    inst.status === 'installed' &&
    inst.sourceCategory === 'local' &&
    Boolean(inst.installPath)
  )
}

const {
  ctxMenu,
  ctxMenuItems,
  openCardMenu,
  openKebabMenu,
  handleCtxMenuSelect,
  closeMenu,
  triggerAction,
  viewError,
  viewDanger,
  isStoppedActionGated,
  isPromotingToWorkspace
} = useInstallContextMenu({
  onManage: (inst, options) =>
    options ? openInstallManager(inst, options) : emit('open-details', inst),
  // Fast-path for Delete: forwards to PanelApp so the same ProgressModal
  // pipeline used by every other long op fires here too.
  onShowProgress: (showOpts) => emit('show-progress', showOpts),
  canPromoteToWorkspace
})

async function pickInstall(inst: Installation): Promise<void> {
  // The instance window owns lifecycle, so an install with a window is brought
  // forward instead of starting a second launch with a dashboard takeover.
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
  'open-card-menu': openCardMenu,
  'open-kebab-menu': openKebabMenu,
  'trigger-action': (action: 'update' | 'migrate', inst: Installation) =>
    triggerAction(action, inst),
  'view-error': viewError,
  'view-danger': viewDanger,
  'why-cloud': openWhyCloud
}
</script>

<template>
  <div
    v-show="props.visible"
    class="chooser-view chooser-view--workspace flex min-h-0 w-full flex-auto flex-col overflow-y-auto bg-[radial-gradient(62%_100%_at_50%_0%,oklch(1_0_0/0.06),oklch(1_0_0/0.025)_50%,transparent_100%)]"
  >
    <div class="mx-auto w-full max-w-300 px-10 pb-24">
      <header class="chooser-header flex items-end justify-between gap-6 pt-9 pb-6">
        <h1 class="m-0 text-[22px]/[1.4] font-semibold tracking-[-0.01em] text-foreground">
          {{ t('chooser.buildsTitle') }}
        </h1>
        <Button
          type="button"
          variant="inverted"
          size="md"
          class="chooser-tile-new shrink-0 gap-1.5 px-3 text-[13px]/5"
          :aria-label="t('chooser.newBuildLabel')"
          @click="handleNewInstallClick"
        >
          <Plus :size="15" aria-hidden="true" />
          {{ t('chooser.newBuild') }}
        </Button>
      </header>

      <div class="chooser-toolbar mb-5 flex min-h-8 flex-wrap items-center gap-2">
        <SegmentedControl
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
          <div class="w-38">
            <BaseSelect
              v-model="sortOrder"
              :options="sortOptions"
              :aria-label="t('chooser.sortLabel')"
              compact
            />
          </div>
          <div class="chooser-search w-[220px]">
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
        :is-stopped-action-gated="isStoppedActionGated"
        :is-promoting-to-workspace="isPromotingToWorkspace"
        v-on="gridHandlers"
      />
    </div>

    <ContextMenu
      :open="ctxMenu.open"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenuItems"
      @close="closeMenu"
      @select="handleCtxMenuSelect"
    />

    <WhyTryCloudModal
      v-if="whyCloudOpen"
      @close="dismissWhyCloud"
      @try-cloud="onWhyCloudTryCloud"
    />
  </div>
</template>
