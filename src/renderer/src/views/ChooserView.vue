<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallContextMenu } from '../composables/useInstallContextMenu'
import { useInstallList } from '../composables/useInstallList'
import { useModal } from '../composables/useModal'
import { useCloudGate } from '../composables/useCloudGate'
import { emitTelemetryAction } from '../lib/telemetry'
import { RefreshCw, Search } from 'lucide-vue-next'
import ContextMenu from '../components/ContextMenu.vue'
import WhyTryCloudModal from '../components/WhyTryCloudModal.vue'
import BrandBackground from '../components/BrandBackground.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import ComfyWordmark from '../components/icons/ComfyWordmark.vue'
import ChooserFamilyGrid from './chooser/ChooserFamilyGrid.vue'
import DevPlatformAccountChip from './devplatform/DevPlatformAccountChip.vue'
import DevPlatformWorkspaceSelector from './devplatform/DevPlatformWorkspaceSelector.vue'
import { openInstallManager } from '../lib/openInstallManager'
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
  /** User triggered the new-install flow in the current dashboard scope. */
  'show-new-install': []
  /** A long-running action was kicked off from the inline Manage...
   *  DetailModal. Forwarded to PanelApp so it can wire the operation
   *  through `progressStore`. */
  'show-progress': [opts: ShowProgressOpts]
}>()

const { t } = useI18n()
const installationStore = useInstallationStore()
const sessionStore = useSessionStore()
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
const { searchQuery, activeFilter, visibleInstalls } = useInstallList({
  installations: installationsRef
})

// Explicitly expose `activeFilter` so the brand-redesign tests can
// drive the underlying filter state without the chip UI mounted.
// `<script setup>` would otherwise auto-hide it because the template
// doesn't reference the ref directly (chips are TODO(brand-cleanup)).
defineExpose({ activeFilter })

// --- Dashboard scope ---

const selectedWorkspaceModel = computed({
  get: () => dashboardScope.selectedWorkspaceId,
  set: dashboardScope.selectWorkspace
})

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

const scopedVisibleInstalls = computed(() =>
  visibleInstalls.value.filter(installationIsInSelectedScope)
)
const scopedInstallCount = computed(
  () => installationStore.installations.filter(installationIsInSelectedScope).length
)
const showNoMatches = computed(
  () =>
    scopedVisibleInstalls.value.length === 0 &&
    (searchQuery.value.trim().length > 0 || activeFilter.value !== 'all')
)

const refreshingWorkspace = computed(() => authStore.loadingWorkspaces || authStore.loadingBuilds)

async function refreshWorkspace(): Promise<void> {
  emitTelemetryAction('comfy.desktop.workspace.refresh', {})
  await Promise.all([authStore.fetchWorkspaces(), authStore.fetchBuilds()])
}

// --- Cluster top offset ---

const TILES_PER_ROW = 4

/** Search-independent height reservation for New Instance plus scoped installs. */
const clusterRows = computed(() => Math.ceil((1 + scopedInstallCount.value) / TILES_PER_ROW))

// --- Manage / context menu ---
// All Manage routes go through `window.api.openInstancePicker` (the
// picker popup) - the legacy `useOverlay`-driven `ManageInstallModal`
// route is retired.

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
  onManage: openInstallManager,
  // Fast-path for Delete: forwards to PanelApp so the same ProgressModal
  // pipeline used by every other long op fires here too, without the
  // brief ManageInstallModal flash that the autoAction route produced.
  onShowProgress: (showOpts) => emit('show-progress', showOpts),
  canPromoteToWorkspace
})

async function pickInstall(inst: Installation): Promise<void> {
  // The instance window owns lifecycle. If a host window already exists for
  // this install - running, launching, OR crashed (the window stays open on
  // its lifecycle/error surface) - bring it forward instead of kicking off a
  // second launch with a dashboard takeover. Restart, stop, and crash details
  // all live inside that window.
  if (
    sessionStore.isRunning(inst.id) ||
    sessionStore.isLaunching(inst.id) ||
    sessionStore.errorInstances.has(inst.id)
  ) {
    const focused = await window.api.focusComfyWindow(inst.id)
    // `errorInstances` can be hydrated from the retained crash buffer after
    // the window was closed, so a focus may find nothing - fall through and
    // launch normally in that case.
    if (focused) return
  }
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
  'new-install': handleNewInstallClick,
  pick: pickInstall,
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
  <BrandBackground
    v-show="props.visible"
    class="chooser-bg [&_.brand-inner-frame]:p-0 [&_.brand-outer-frame]:bg-transparent [&_.brand-outer-frame]:p-0 [&_.brand-beam--2]:[left:anchor(center,clamp(39%,calc(52.5vw_-_135px),44%))]"
  >
    <div
      class="chooser-view chooser-view--workspace grid min-h-0 w-full max-w-[1280px] flex-auto grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto_auto_auto_minmax(0,auto)_minmax(0,1fr)] justify-items-center gap-y-[var(--chooser-row-gap)] px-6 py-[var(--chooser-pad-y)] [--chooser-pad-y:clamp(12px,2.5vh,24px)] [--chooser-row-gap:clamp(16px,3.5vh,32px)]"
      :style="{ '--rows': clusterRows }"
    >
      <!-- Signed-in account identity, pinned outside the centered content column. -->
      <div
        class="chooser-account absolute top-[var(--chooser-pad-y)] right-6 z-2 flex max-w-[min(340px,45%)] justify-end"
      >
        <DevPlatformAccountChip />
      </div>

      <ComfyWordmark
        class="chooser-wordmark row-start-2 block aspect-[173/48] h-auto w-[clamp(120px,8vw,180px)] shrink-0 self-center text-comfy-yellow [anchor-name:--brand-beam-target]"
        aria-hidden="true"
      />
      <div
        class="chooser-toolbar row-start-3 flex w-full max-w-[900px] shrink-0 items-center justify-center gap-2.5"
      >
        <div class="chooser-search flex min-w-[180px] flex-[1_1_600px]">
          <BaseInput
            v-model="searchQuery"
            class="rounded-xl [&.ui-input]:border-[var(--chooser-surface-border)] [&.ui-input]:bg-[var(--chooser-surface-bg)] p-2 [&_.ui-input-control]:pt-0 [&_.ui-input-control]:text-[14px]"
            :placeholder="t('chooser.searchPlaceholder')"
            :aria-label="t('chooser.searchPlaceholder')"
          >
            <template #leading><Search :size="16" /></template>
          </BaseInput>
        </div>
      </div>

      <div
        class="chooser-workspace-viewport @container row-start-4 box-border w-full max-w-[1168px] justify-self-center"
      >
        <div
          class="chooser-workspace-bar mx-auto flex w-full max-w-[280px] items-center gap-3 @min-[576px]:max-w-[576px] @min-[872px]:max-w-[872px] @min-[1168px]:max-w-[1168px] [@media(width<=640px)]:flex-wrap"
        >
          <div
            class="chooser-workspace-controls grid min-w-0 shrink items-center [--chooser-workspace-refresh-size:30px] [--chooser-workspace-refresh-gap:8px] [&_.workspace-selector]:w-full [&_.workspace-selector]:min-w-0 [&_.workspace-selector\_\_face]:box-border [&_.workspace-selector\_\_face]:w-full [&_.workspace-selector\_\_face]:min-w-0 [&_.workspace-selector\_\_face]:px-2 [&_.workspace-selector\_\_face]:py-0 [&_.workspace-selector\_\_menu]:box-border [&_.workspace-selector\_\_menu]:w-full [&_.workspace-selector\_\_menu]:min-w-0 [&_.workspace-selector\_\_menu]:max-w-none"
            :class="
              authStore.isSignedIn
                ? 'basis-[290px] grid-cols-[minmax(0,1fr)_var(--chooser-workspace-refresh-size)] gap-[var(--chooser-workspace-refresh-gap)] [@media(width<=640px)]:basis-full'
                : 'chooser-workspace-controls--no-refresh basis-[calc(290px-var(--chooser-workspace-refresh-size)-var(--chooser-workspace-refresh-gap))] grid-cols-[minmax(0,1fr)] gap-0 [@media(width<=640px)]:basis-[calc(100%-var(--chooser-workspace-refresh-size)-var(--chooser-workspace-refresh-gap))]'
            "
          >
            <DevPlatformWorkspaceSelector v-model="selectedWorkspaceModel" />
            <button
              v-if="authStore.isSignedIn"
              type="button"
              class="chooser-workspace-refresh inline-flex size-[var(--chooser-workspace-refresh-size)] items-center justify-center rounded-md border border-solid border-transparent bg-transparent p-0 text-text-muted cursor-pointer enabled:hover:border-[var(--chooser-surface-border-hover)] enabled:hover:bg-[var(--chooser-surface-bg-hover)] enabled:hover:text-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] focus-visible:[outline-style:solid] disabled:opacity-60 disabled:cursor-default"
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
            </button>
          </div>
          <div
            class="chooser-workspace-divider h-px min-w-4 flex-auto bg-[var(--chooser-surface-border)] [@media(width<=640px)]:hidden"
            aria-hidden="true"
          />
          <div
            class="chooser-workspace-count ml-auto flex flex-none items-baseline gap-1 text-[12px] text-text-muted [@media(width<=640px)]:w-full [@media(width<=640px)]:justify-end"
          >
            <span>{{ t('devPlatform.workspace.instanceCountLabel') }}</span>
            <strong class="font-semibold text-neutral-100">{{ scopedInstallCount }}</strong>
          </div>
        </div>
      </div>

      <div
        v-if="
          !dashboardScope.initialized ||
          (installationStore.loading && installationStore.installations.length === 0)
        "
        class="chooser-loading row-start-5 flex items-center justify-center p-6 opacity-60"
      >
        {{ t('common.loading') }}
      </div>

      <div
        v-else-if="showNoMatches"
        class="chooser-empty row-start-5 flex items-center justify-center p-6 opacity-60"
      >
        {{ t('chooser.noMatches') }}
      </div>

      <div
        v-else
        class="chooser-shelves @container row-start-5 flex max-h-full min-h-[min(100%,calc(var(--rows)*var(--tile-h)+max(0,var(--rows)-1)*16px+2*var(--chooser-fade)))] w-full max-w-[1168px] flex-col gap-7 justify-self-center overflow-y-auto py-[var(--chooser-fade)] [--tile-h:178px] [--chooser-fade:clamp(12px,2.5vh,24px)] supports-[mask-image:linear-gradient(black,black)]:[mask-image:linear-gradient(to_bottom,transparent_0,black_var(--chooser-fade),black_calc(100%-var(--chooser-fade)),transparent_100%)]"
      >
        <section
          class="chooser-shelf m-0 flex w-full max-w-[280px] flex-col gap-4 self-center @min-[576px]:max-w-[576px] @min-[872px]:max-w-[872px] @min-[1168px]:max-w-[1168px]"
        >
          <ChooserFamilyGrid
            show-new
            :installations="scopedVisibleInstalls"
            :show-free-runs-pill="showCloudFreeRunsPill"
            :show-why-cloud="showWhyCloud"
            :is-stopped-action-gated="isStoppedActionGated"
            :is-promoting-to-workspace="isPromotingToWorkspace"
            v-on="gridHandlers"
          />
        </section>
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
  </BrandBackground>
</template>

<style>
/* Register the measured row count so the scroll viewport can reserve its
 * unfiltered height while search changes the visible tiles. */
@property --rows {
  syntax: '<integer>';
  inherits: true;
  initial-value: 1;
}
</style>
