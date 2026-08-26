<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import { useAuthStore } from '../stores/authStore'
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
import { resolvePickerTab } from '../lib/pickerTabs'
import type { CloudUserTier, Installation, ShowProgressOpts } from '../types/ipc'

/**
 * Chooser view - recents grid.
 *
 * A golden-ratio tile grid the user picks from. The install-less host
 * window hosts this as the Comfy tab body when no install backs the
 * entry.
 *
 * Signed-in users choose either No workspace or one authenticated workspace.
 * The grid contains only installed instances in that scope.
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
  'show-new-install': [workspaceId?: string]
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

const selectedWorkspaceId = ref<string | null>(null)
let dashboardScopeInitialized = false

watch(
  () => ({ signedIn: authStore.isSignedIn, workspaceId: authStore.status.workspaceId }),
  (next, previous) => {
    if (!next.signedIn) {
      selectedWorkspaceId.value = null
      dashboardScopeInitialized = false
      return
    }
    if (!dashboardScopeInitialized) {
      selectedWorkspaceId.value = next.workspaceId ?? null
      dashboardScopeInitialized = true
      return
    }
    // Follow an external authenticated workspace switch only while the user is
    // viewing that workspace. An explicit No workspace selection remains local.
    if (selectedWorkspaceId.value !== null && selectedWorkspaceId.value === previous?.workspaceId) {
      selectedWorkspaceId.value = next.workspaceId ?? null
    }
  },
  { immediate: true }
)

function installationIsInSelectedScope(inst: Installation): boolean {
  if (!authStore.isSignedIn) return true
  return selectedWorkspaceId.value === null
    ? inst.workspaceId === undefined
    : inst.workspaceId === selectedWorkspaceId.value
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

const refreshingWorkspace = computed(() => authStore.loadingWorkspaces)

async function refreshWorkspace(): Promise<void> {
  emitTelemetryAction('comfy.desktop.workspace.refresh', {})
  await authStore.fetchWorkspaces()
}

// --- Cluster top offset ---

const TILES_PER_ROW = 4

/** Search-independent height reservation for New Instance plus scoped installs. */
const clusterRows = computed(() => Math.ceil((1 + scopedInstallCount.value) / TILES_PER_ROW))

// --- Manage / context menu ---
// All Manage routes go through `window.api.openInstancePicker` (the
// picker popup) - the legacy `useOverlay`-driven `ManageInstallModal`
// route is retired.

function openManage(
  installation: Installation,
  opts: { initialTab?: string; autoAction?: string | null } = {}
): void {
  // Every Manage entry - bare "Manage..." and the specialised kebab
  // items (Update / Migrate / Restore Snapshot / Delete) - routes to
  // the instance-picker popup. Bare goes to compact (default identity
  // card + CTAs); specialised paths open the picker directly in
  // expanded mode on the relevant tab with `autoAction` so the action
  // fires on mount of `ComfyUISettingsContent`.
  const hasSpecialisedOpts =
    opts.initialTab !== undefined || (opts.autoAction !== undefined && opts.autoAction !== null)
  if (!hasSpecialisedOpts) {
    window.api.openInstancePicker({ installationId: installation.id })
    return
  }
  window.api.openInstancePicker({
    installationId: installation.id,
    initialTab: resolvePickerTab(opts.initialTab, 'status'),
    autoAction: opts.autoAction ?? null
  })
}

function canPromoteToWorkspace(inst: Installation): boolean {
  return (
    authStore.isSignedIn &&
    Boolean(authStore.status.workspaceId) &&
    inst.status === 'installed' &&
    inst.sourceCategory === 'local' &&
    Boolean(inst.installPath) &&
    !inst.workspaceId &&
    inst.sourceId !== 'comfybuilder'
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
  isStoppedActionGated,
  isPromotingToWorkspace
} = useInstallContextMenu({
  onManage: (inst, opts) => openManage(inst, opts ?? {}),
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

/** Surface a failed install's error so it's readable from the dashboard.
 *  Covers both op failures (which carry a `message`, e.g. a migrate that
 *  silently did nothing but turn the tile red) and crashes (exit code /
 *  signal + captured stderr). */
function viewError(inst: Installation): void {
  const err = sessionStore.errorInstances.get(inst.id)
  if (!err) return
  let message = err.message
  if (!message) {
    if (err.signal && err.exitCode != null) {
      message = t('comfyLifecycle.crashedDescWithCodeAndSignal', {
        code: err.exitCode,
        signal: err.signal
      })
    } else if (err.signal) {
      message = t('comfyLifecycle.crashedDescWithSignal', { signal: err.signal })
    } else if (err.exitCode != null) {
      message = t('comfyLifecycle.crashedDescWithCode', { code: err.exitCode })
    } else {
      message = t('comfyLifecycle.crashedDesc')
    }
  }
  if (err.lastStderr) message = `${message}\n\n${err.lastStderr}`
  void modal.alert({ title: t('chooser.errorTitle'), message })
}

/** Surface a backend-flagged danger state (failed install, interrupted delete,
 *  missing install folder) from its dashboard pill. The label is the short
 *  pill text; `detail` carries the full explanation built in the main process. */
function viewDanger(inst: Installation): void {
  const tag = inst.statusTag
  if (!tag || tag.style !== 'danger') return
  void modal.alert({ title: tag.label, message: tag.detail || tag.label })
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
  if (authStore.isSignedIn && selectedWorkspaceId.value) {
    emit('show-new-install', selectedWorkspaceId.value)
  } else {
    emit('show-new-install')
  }
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
  <BrandBackground v-show="props.visible" class="chooser-bg">
    <div
      class="chooser-view"
      :class="{ 'chooser-view--workspace': authStore.isSignedIn }"
      :style="{ '--rows': clusterRows }"
    >
      <!-- Signed-in account identity, pinned outside the centered content column. -->
      <div class="chooser-account">
        <DevPlatformAccountChip />
      </div>

      <ComfyWordmark class="chooser-wordmark" aria-hidden="true" />
      <div class="chooser-toolbar">
        <div class="chooser-search">
          <BaseInput
            v-model="searchQuery"
            :placeholder="t('chooser.searchPlaceholder')"
            :aria-label="t('chooser.searchPlaceholder')"
          >
            <template #leading><Search :size="16" /></template>
          </BaseInput>
        </div>
      </div>

      <div v-if="authStore.isSignedIn" class="chooser-workspace-bar">
        <div class="chooser-workspace-heading">
          <h2>{{ t('devPlatform.workspace.switchLabel') }}</h2>
          <span>{{ scopedInstallCount }}</span>
        </div>
        <div class="chooser-workspace-divider" aria-hidden="true" />
        <div class="chooser-workspace-controls">
          <button
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
              :class="{ 'chooser-workspace-refresh__icon--busy': refreshingWorkspace }"
            />
          </button>
          <DevPlatformWorkspaceSelector v-model="selectedWorkspaceId" />
        </div>
      </div>

      <div
        v-if="installationStore.loading && installationStore.installations.length === 0"
        class="chooser-loading"
      >
        {{ t('common.loading') }}
      </div>

      <div v-else-if="showNoMatches" class="chooser-empty">
        {{ t('chooser.noMatches') }}
      </div>

      <div v-else class="chooser-shelves">
        <section class="chooser-shelf">
          <ChooserFamilyGrid
            show-new
            centered
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

<style scoped>
@import './chooser/chooser-tiles.css';

.chooser-bg :deep(.brand-inner-frame) {
  /* Inherit the default justify-content: center from BrandBackground;
   * chooser-view fills the frame and handles its own centering. */
  padding: 0;
}

.chooser-bg :deep(.brand-outer-frame) {
  padding: 0;
  background: transparent;
}

.chooser-bg :deep(.brand-beam--2) {
  left: anchor(center, clamp(39%, calc(52.5vw - 135px), 44%));
}

/* Unitless tile-row count from JS (see `clusterRows`). Registered as <integer>
 * so it's a typed number usable in the grid's reserved-height calc() below. */
@property --rows {
  syntax: '<integer>';
  inherits: true;
  initial-value: 1;
}

.chooser-view {
  /* Symmetric top + bottom spacers (both 1fr) center the wordmark-to-grid block
   * as a group whenever it fits - looks deliberate at any viewport height.
   * When the (unfiltered) content is taller than the viewport, the
   * `minmax(0, 1fr)` spacers collapse to 0 and the grid scrolls internally.
   * Rows: [top spacer] [wordmark] [search] [workspace controls] [grid]
   * [bottom spacer]. The workspace row is omitted while signed out.
   *
   * No-shift guarantee: the grid row reserves its height from the UNFILTERED
   * `--rows` (see `.chooser-grid` min-height), so typing in search empties
   * tiles without shrinking the grid box - the centered cluster stays put. */
  --chooser-pad-y: clamp(12px, 2.5vh, 24px);
  --chooser-row-gap: clamp(16px, 3.5vh, 32px);
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-rows:
    minmax(0, 1fr)
    auto
    auto
    minmax(0, auto)
    minmax(0, 1fr);
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  width: 100%;
  max-width: 1280px;
  padding: var(--chooser-pad-y) 24px;
  row-gap: var(--chooser-row-gap);
}

.chooser-view--workspace {
  grid-template-rows:
    minmax(0, 1fr)
    auto
    auto
    auto
    minmax(0, auto)
    minmax(0, 1fr);
}

/* Account chip: pinned to the frame's top-right, out of the centered column
 * so it can never collide with the wordmark or the search field. */
.chooser-account {
  position: absolute;
  top: var(--chooser-pad-y);
  right: 24px;
  z-index: 2;
  display: flex;
  justify-content: flex-end;
  max-width: min(340px, 45%);
}

.chooser-wordmark {
  grid-row: 2;
  /* `align-self` + `aspect-ratio` keep the SVG from stretching to fill the
   * grid row (default `align-self: stretch` distorts it). */
  align-self: center;
  display: block;
  width: clamp(120px, 8vw, 180px);
  height: auto;
  aspect-ratio: 173 / 48;
  color: var(--comfy-yellow);
  flex-shrink: 0;
  anchor-name: --brand-beam-target;
}

.chooser-toolbar {
  grid-row: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  max-width: 900px;
  flex-shrink: 0;
}

.chooser-search {
  display: flex;
  flex: 1 1 600px;
  min-width: 180px;
}

.chooser-search :deep(.ui-input) {
  width: 100%;
  border-radius: 12px;
  border: 1px solid var(--chooser-surface-border);
  background: var(--chooser-surface-bg);
  padding: 8px;
}

.chooser-search :deep(.ui-input-control) {
  font-size: 14px;
  padding-top: 0;
}

.chooser-loading,
.chooser-empty {
  grid-row: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.6;
  padding: 24px;
}

.chooser-view--workspace .chooser-loading,
.chooser-view--workspace .chooser-empty,
.chooser-view--workspace .chooser-shelves {
  grid-row: 5;
}

/* The scoped install grid's scroll viewport - column, scroll and fade only;
 * tile layout and the FLIP belong to `ChooserFamilyGrid`. */
.chooser-shelves {
  grid-row: 4;
  width: 100%;
  /* Content box must hold exactly 4 tracks (4 x 280 + 3 x 16 = 1168px), so the
   * side padding sits OUTSIDE the cap - inside it, `auto-fit` drops to 3
   * columns on a wide viewport. */
  --shelf-pad-x: 4px;
  max-width: calc(1168px + 2 * var(--shelf-pad-x));
  /* Reserve the unfiltered row height so the cluster doesn't jump while typing
   * in search. Tile is 178px tall (280px at the golden-ratio aspect). */
  --tile-h: 178px;
  min-height: min(
    100%,
    calc(var(--rows) * var(--tile-h) + max(0, var(--rows) - 1) * 16px + 2 * var(--chooser-fade))
  );
  max-height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 28px;
  /* Vertical padding pushes the first/last rows into the mask fade so they
   * glide under it rather than clip abruptly. Fluid on height (`--chooser-fade`)
   * so short viewports reclaim the band for an extra tile row. */
  --chooser-fade: clamp(12px, 2.5vh, 24px);
  padding: var(--chooser-fade) var(--shelf-pad-x);
  /* Size container so each shelf below can snap its width to a whole number
   * of tile columns. */
  container-type: inline-size;
}

/* Soft scroll edges, matched to the vertical padding so rows tuck under. */
@supports (mask-image: linear-gradient(black, black)) {
  .chooser-shelves {
    mask-image: linear-gradient(
      to bottom,
      transparent 0,
      black var(--chooser-fade),
      black calc(100% - var(--chooser-fade)),
      transparent 100%
    );
  }
}

.chooser-shelf {
  display: flex;
  flex-direction: column;
  /* The grid's own row gap, so two stacked grids read as continuous rows. */
  gap: 16px;
  /* Snap each shelf to a whole number of 280px tracks (16px gaps) and center
   * the snapped block. Without this, a viewport that fits fewer than 4
   * columns leaves the start-aligned grids pinned left under the centered
   * wordmark/search with a dead right gutter. Snapping makes start-aligned
   * and centered rows coincide, and shelf header rules end at the last
   * column. Thresholds are `cols * 280 + (cols - 1) * 16` against the
   * shelves' content box (the container defined above). */
  width: 100%;
  max-width: 280px;
  margin-inline: auto;
}
@container (width >= 576px) {
  .chooser-shelf {
    max-width: 576px;
  }
}
@container (width >= 872px) {
  .chooser-shelf {
    max-width: 872px;
  }
}
@container (width >= 1168px) {
  .chooser-shelf {
    max-width: 1168px;
  }
}

.chooser-workspace-bar {
  grid-row: 4;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 1168px;
}
.chooser-workspace-heading {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex: 0 0 auto;
}
.chooser-workspace-heading h2 {
  margin: 0;
  color: var(--neutral-100);
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
}
.chooser-workspace-heading span {
  color: var(--text-muted);
  font-size: 12px;
}
.chooser-workspace-divider {
  flex: 1 1 auto;
  min-width: 16px;
  height: 1px;
  background: var(--chooser-surface-border);
}
.chooser-workspace-controls {
  display: flex;
  flex: 0 1 290px;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.chooser-workspace-controls :deep(.workspace-selector) {
  flex: 1 1 auto;
  min-width: 0;
}
.chooser-workspace-controls :deep(.workspace-selector__face) {
  --dp-avatar-size: 20px;
  box-sizing: border-box;
  width: 100%;
  min-width: 180px;
  padding: 4px 8px;
}
.chooser-workspace-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.chooser-workspace-refresh:hover:not(:disabled) {
  border-color: var(--chooser-surface-border-hover);
  background: var(--chooser-surface-bg-hover);
  color: var(--neutral-100);
}
.chooser-workspace-refresh:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.chooser-workspace-refresh:disabled {
  cursor: default;
  opacity: 0.6;
}
.chooser-workspace-refresh__icon--busy {
  animation: chooser-workspace-refresh-spin 900ms linear infinite;
}
@keyframes chooser-workspace-refresh-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 640px) {
  .chooser-workspace-bar {
    flex-wrap: wrap;
  }

  .chooser-workspace-divider {
    display: none;
  }

  .chooser-workspace-controls {
    flex-basis: 100%;
  }
}
</style>
