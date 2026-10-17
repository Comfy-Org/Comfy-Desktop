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
import { RefreshCw } from 'lucide-vue-next'
import ContextMenu from '../components/ContextMenu.vue'
import WhyTryCloudModal from '../components/WhyTryCloudModal.vue'
import ComfyCLogo from '../components/icons/ComfyCLogo.vue'
import Button from '../design-system/components/Button.vue'
import SearchInput from '../design-system/components/SearchInput.vue'
import { providePaletteScope } from '../composables/usePaletteScope'
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
// The dashboard is in the Void palette's scope; its teleported menus inherit it.
const paletteScope = providePaletteScope()
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
  <div
    v-show="props.visible"
    class="ds-root ds-page relative flex size-full min-h-0 flex-1 overflow-hidden bg-app-background"
    :class="paletteScope"
  >
    <main class="ds-content relative min-w-0 flex-1 overflow-y-auto scrollbar-quiet">
      <!-- Signed-in account identity, pinned top right outside the content column. -->
      <div class="chooser-account absolute top-4 right-5">
        <DevPlatformAccountChip />
      </div>

      <div
        class="chooser-view mx-auto flex w-full max-w-240 flex-col items-center px-10 pt-20 pb-16"
      >
        <h1 class="flex items-center gap-2.5 text-display font-semibold heading-gradient">
          <!-- The gradient fills text only; the mark keeps a solid colour. -->
          <ComfyCLogo :size="34" class="text-base-foreground" />{{ t('chooser.wordmark') }}
        </h1>
        <div class="chooser-toolbar mt-8 flex w-full max-w-120">
          <SearchInput
            v-model="searchQuery"
            class="chooser-search w-full"
            :placeholder="t('chooser.searchPlaceholder')"
            :clear-label="t('common.clear')"
          />
        </div>

        <!-- Workspace bar: which workspace, and how many instances in it. -->
        <div
          class="chooser-workspace-bar mt-5 flex items-center gap-3 rounded-control border border-border-default bg-secondary-background py-1 pr-3.5 pl-1"
        >
          <div class="chooser-workspace-controls flex items-center gap-1">
            <DevPlatformWorkspaceSelector v-model="selectedWorkspaceModel" />
            <Button
              v-if="authStore.isSignedIn"
              variant="ghost"
              size="icon-sm"
              :disabled="refreshingWorkspace"
              :aria-label="t('devPlatform.workspace.refresh')"
              :title="t('devPlatform.workspace.refresh')"
              data-testid="chooser-workspace-refresh"
              @click="refreshWorkspace"
            >
              <RefreshCw
                :size="13"
                :class="{ 'animate-spin motion-reduce:animate-none': refreshingWorkspace }"
              />
            </Button>
          </div>
          <span class="h-4 w-px bg-border-default" aria-hidden="true" />
          <div class="chooser-workspace-count flex items-baseline gap-1.5 text-ui">
            <span class="tracking-wider text-subtle-foreground">{{
              t('devPlatform.workspace.instanceCountLabel')
            }}</span>
            <strong class="font-semibold tabular-nums">{{ scopedInstallCount }}</strong>
          </div>
        </div>

        <p
          v-if="
            !dashboardScope.initialized ||
            (installationStore.loading && installationStore.installations.length === 0)
          "
          class="chooser-loading mt-10 text-ui text-muted-foreground"
        >
          {{ t('common.loading') }}
        </p>

        <p v-else-if="showNoMatches" class="chooser-empty mt-10 text-ui text-muted-foreground">
          {{ t('chooser.noMatches') }}
        </p>

        <div v-else class="mt-10 w-full">
          <ChooserFamilyGrid
            show-new
            :installations="scopedVisibleInstalls"
            :show-free-runs-pill="showCloudFreeRunsPill"
            :show-why-cloud="showWhyCloud"
            :is-stopped-action-gated="isStoppedActionGated"
            :is-promoting-to-workspace="isPromotingToWorkspace"
            v-on="gridHandlers"
          />
        </div>
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
    </main>
  </div>
</template>
