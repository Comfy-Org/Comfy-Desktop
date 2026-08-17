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
import { Search } from 'lucide-vue-next'
import ContextMenu from '../components/ContextMenu.vue'
import WhyTryCloudModal from '../components/WhyTryCloudModal.vue'
import BrandBackground from '../components/BrandBackground.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import ComfyWordmark from '../components/icons/ComfyWordmark.vue'
import ChooserFamilyGrid from './chooser/ChooserFamilyGrid.vue'
import DevPlatformAccountChip from './devplatform/DevPlatformAccountChip.vue'
import { distEntry, installEntry, type ChooserGridEntry } from './chooser/chooserGridEntry'
import { isDistributionInstall } from '../devplatform/distributionState'
import { resolvePickerTab } from '../lib/pickerTabs'
import type { ContextMenuItem } from '../types/context-menu'
import type { Distribution } from '../devplatform/types'
import type { CloudUserTier, Installation, ShowProgressOpts } from '../types/ipc'

/**
 * Chooser view — recents grid.
 *
 * A golden-ratio tile grid the user picks from. The install-less host
 * window hosts this as the Comfy tab body when no install backs the
 * entry.
 *
 * Layout:
 *   - Top-right: dev-platform account chip (log-in button when signed out;
 *     workspace switcher when signed in).
 *   - Top-left: "New Install" (always present).
 *   - Following: every install (local / cloud / remote) ordered by
 *     `lastLaunchedAt` desc, never-launched at the end.
 *   - Then, when signed in, one tile per distribution published to the
 *     workspace that isn't installed yet: installing a distribution is the
 *     SAME GESTURE as launching an existing install: one tile, one click.
 *   - Filter chips above the grid narrow by source category.
 *
 * Per-install tile rendering lives in `chooser/ChooserInstallTile.vue`;
 * per-distribution tiles in `devplatform/DevPlatformDistributionCard.vue`.
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
  /** User picked an install — caller decides whether to swap-in-place,
   *  open a fresh window, or hand off to a launch flow. */
  pick: [installation: Installation]
  /** User triggered the new-install flow (top-left card or empty Cloud
   *  card). */
  'show-new-install': []
  /** A long-running action was kicked off from the inline Manage…
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

// Sign-in / workspace-switch can happen ON this page (the chip), so the
// distribution list follows the session rather than mount timing. Keying on the
// workspace id (not just signed-in) is what re-fetches after a switch, where the
// store clears the grid but signed-in stays true.
watch(
  () => [authStore.isSignedIn, authStore.status.workspaceId] as const,
  () => {
    if (authStore.isSignedIn && authStore.distributions.length === 0) {
      void authStore.fetchDistributions().catch(() => {})
    }
  },
  { immediate: true }
)

// Filter / search / recency logic is shared with the title-bar
// instance picker popover via `useInstallList` so the two surfaces
// cannot drift. The chip UI is currently hidden in the brand redesign
// but the underlying `activeFilter` ref + filter switch stay wired;
// tests reach into `vm.activeFilter` to drive the filter-based
// regressions guard.
//
// "Local" includes both standalone local installs and Legacy Desktop
// installs (both report `sourceCategory === 'local'`) — they're
// conceptually the same family from the user's POV. Cloud installs
// flow through `visibleInstalls` like every other source — there is no
// special cloud surface anymore.
const installationsRef = toRef(installationStore, 'installations')
const { searchQuery, activeFilter, visibleInstalls, showEmptyHint, matchesQuery } = useInstallList({
  installations: installationsRef
})

// Explicitly expose `activeFilter` so the brand-redesign tests can
// drive the underlying filter state without the chip UI mounted.
// `<script setup>` would otherwise auto-hide it because the template
// doesn't reference the ref directly (chips are TODO(brand-cleanup)).
defineExpose({ activeFilter })

// --- Comfy Builder distributions ---
//
// ORDERING: New install → existing installs → distributions. Existing installs
// are what the user returns to and their position is muscle memory, so the
// "things I could add" family goes last.
//
// DE-DUPLICATION: an already-installed distribution is an ordinary
// installation and must not be listed twice. `installation.distributionId`
// when the comfybuilder install carries it (the index signature passes it
// through), else case-insensitive name equality: an install created from a
// distribution inherits its name.
function installationBacksDistribution(inst: Installation, dist: Distribution): boolean {
  const linked = inst.distributionId
  if (typeof linked === 'string' && linked.length > 0) return linked === dist.id
  // Name-match is a fallback only for a comfybuilder install; never let an
  // unrelated same-named local install hide a distribution tile.
  if (inst.sourceId !== 'comfybuilder') return false
  return inst.name.trim().toLowerCase() === dist.name.trim().toLowerCase()
}

/** Every distribution that earns a tile, before search. Blocked builds are kept
 *  and receded by the card, not filtered out — a hidden one is indistinguishable
 *  from one that was never published. */
const chooserDistributions = computed<Distribution[]>(() => {
  if (!authStore.isSignedIn) return []
  return authStore.distributions.filter(
    (dist) =>
      dist.state !== 'update-available' &&
      !installationStore.installations.some((inst) => installationBacksDistribution(inst, dist))
  )
})

/** Search filters distributions through the SAME query as the install tiles. */
const visibleDistributions = computed<Distribution[]>(() =>
  chooserDistributions.value.filter((dist) => matchesQuery(dist.name))
)

/** A failed distribution fetch, distinct from an empty workspace: the watch
 *  keys on session identity so it won't re-fetch on its own, hence the retry. */
const distributionLoadFailed = computed(
  () => authStore.isSignedIn && authStore.distributionsError && authStore.distributions.length === 0
)

/** The no-matches hint may only fire when NOTHING in the grid matches. A failed
 *  fetch shows its own retry line instead, so the two never co-render. */
const showNoMatches = computed(
  () =>
    showEmptyHint.value && visibleDistributions.value.length === 0 && !distributionLoadFailed.value
)

/** One quiet line under the grid when the signed-in workspace has nothing
 *  published (or the fetch failed). Never a panel: this page already has content. */
const distributionNote = computed(() => {
  if (!authStore.isSignedIn) return ''
  if (searchQuery.value.trim()) return ''
  if (authStore.loadingDistributions) return ''
  if (distributionLoadFailed.value) return t('devPlatform.distribution.loadError')
  if (authStore.distributions.length === 0) return t('devPlatform.distribution.emptyTitle')
  return ''
})

// --- Shelves ---
//
// Your installs lead, unheaded; the workspace's own installs and available
// distributions sit under one header beneath. With nothing to shelve the page
// falls back to the shipped centered grid — a lone left-aligned cluster under
// no header reads as broken.

// `isDistributionInstall` judges the install's own identity, not the fetched
// distribution list, so the split holds when a distribution is unpublished or
// the list hasn't loaded.
const allPlainInstalls = computed(() =>
  installationStore.installations.filter((i) => !isDistributionInstall(i))
)
const allBuilderInstalls = computed(() =>
  installationStore.installations.filter(isDistributionInstall)
)

const ownEntries = computed<ChooserGridEntry[]>(() =>
  visibleInstalls.value.filter((i) => !isDistributionInstall(i)).map(installEntry)
)
const workspaceInstalledEntries = computed<ChooserGridEntry[]>(() =>
  visibleInstalls.value.filter(isDistributionInstall).map(installEntry)
)
const workspaceAvailableEntries = computed<ChooserGridEntry[]>(() =>
  visibleDistributions.value.map(distEntry)
)

/** Pre-search lists, so typing can't flip the page between arrangements.
 *  A distribution-backed install is a local install the user must always be
 *  able to launch, so it shows whether or not they are signed in; only the
 *  still-available distributions to add need a workspace session. */
const showWorkspaceShelf = computed(
  () =>
    allBuilderInstalls.value.length > 0 ||
    (authStore.isSignedIn && chooserDistributions.value.length > 0)
)

/**
 * Install a distribution: main resolves the host artifact + creates the record,
 * then we drive the SAME `installInstance` + progress UI every other install
 * uses (via the `show-progress` event PanelApp already handles). A blocked tile
 * never reaches here: the card suppresses its own activation.
 */
/** Distribution id whose install-kickoff is in flight, so a fast second click
 *  (tile then kebab, or a double-click) can't start two installs before the
 *  progress modal takes over. Main also guards this, belt-and-suspenders. */
const activatingDist = ref<string | null>(null)

async function handleDistributionActivate(dist: Distribution): Promise<void> {
  if (activatingDist.value) return
  activatingDist.value = dist.id
  try {
    const result = await window.api.comfybuilder
      .installDistribution(dist.id)
      .catch((err: unknown) => ({
        ok: false as const,
        message: (err as Error)?.message || String(err)
      }))
    if (!result || !result.ok || !result.entry) {
      await modal.alert({
        title: t('errors.installFailed'),
        message: result.message || t('devPlatform.distribution.installFailed')
      })
      return
    }
    emit('show-progress', {
      installationId: result.entry.id,
      title: `${t('newInstall.installing')}: ${result.entry.name}`,
      apiCall: () => window.api.installInstance(result.entry!.id),
      autoLaunchOnFinish: true,
      opKind: 'install'
    })
  } finally {
    activatingDist.value = null
  }
}

// --- Distribution kebab menu ---
//
// Distribution cards carry the same top-right kebab as install tiles, so the
// corner means one thing across the grid. Install is the only action a
// distribution supports today; blocked states keep the item visible but
// disabled rather than presenting an empty menu, which reads as a bug.
const distMenu = ref<{ open: boolean; x: number; y: number; dist: Distribution | null }>({
  open: false,
  x: 0,
  y: 0,
  dist: null
})

const distMenuItems = computed<ContextMenuItem[]>(() => {
  const dist = distMenu.value.dist
  if (!dist) return []
  return [
    {
      id: 'install',
      label: t('devPlatform.distribution.menuInstall'),
      // Only a never-installed distribution installs from here. An
      // `update-available` row never renders in the chooser (updates live on
      // the existing install), and installing one anew would duplicate it.
      disabled: dist.state !== 'installable'
    }
  ]
})

function openDistKebabMenu(event: MouseEvent, dist: Distribution): void {
  const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect?.()
  // Right-aligned drop, matching the install-tile kebab. ContextMenu clamps to
  // the viewport, so a negative x is safe.
  const x = rect ? rect.right - 180 : event.clientX
  const y = (rect?.bottom ?? event.clientY) + 4
  distMenu.value = { open: true, x, y, dist }
}

function closeDistMenu(): void {
  distMenu.value = { open: false, x: 0, y: 0, dist: null }
}

function handleDistMenuSelect(itemId: string): void {
  const dist = distMenu.value.dist
  closeDistMenu()
  if (itemId === 'install' && dist) void handleDistributionActivate(dist)
}

// --- Cluster top offset ---

const TILES_PER_ROW = 4

/** Unfiltered row count across both shelves, reserving `min-height` so the
 *  cluster doesn't shift while typing in search. Raw lists, not `visible*`. */
const clusterRows = computed(() => {
  // +1: the New Install tile rides with the your-installs family.
  const ownRows = Math.ceil((1 + allPlainInstalls.value.length) / TILES_PER_ROW)
  if (!showWorkspaceShelf.value) return ownRows
  const shelfTiles = allBuilderInstalls.value.length + chooserDistributions.value.length
  return ownRows + Math.ceil(shelfTiles / TILES_PER_ROW)
})

// --- Manage / context menu ---
// All Manage routes go through `window.api.openInstancePicker` (the
// picker popup) — the legacy `useOverlay`-driven `ManageInstallModal`
// route is retired.

function openManage(
  installation: Installation,
  opts: { initialTab?: string; autoAction?: string | null } = {}
): void {
  // Every Manage entry — bare "Manage…" and the specialised kebab
  // items (Update / Migrate / Restore Snapshot / Delete) — routes to
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

const {
  ctxMenu,
  ctxMenuItems,
  openCardMenu,
  openKebabMenu,
  handleCtxMenuSelect,
  closeMenu,
  triggerAction,
  isStoppedActionGated
} = useInstallContextMenu({
  onManage: (inst, opts) => openManage(inst, opts ?? {}),
  // Fast-path for Delete: forwards to PanelApp so the same ProgressModal
  // pipeline used by every other long op fires here too, without the
  // brief ManageInstallModal flash that the autoAction route produced.
  onShowProgress: (showOpts) => emit('show-progress', showOpts)
})

async function pickInstall(inst: Installation): Promise<void> {
  // The instance window owns lifecycle. If a host window already exists for
  // this install — running, launching, OR crashed (the window stays open on
  // its lifecycle/error surface) — bring it forward instead of kicking off a
  // second launch with a dashboard takeover. Restart, stop, and crash details
  // all live inside that window.
  if (
    sessionStore.isRunning(inst.id) ||
    sessionStore.isLaunching(inst.id) ||
    sessionStore.errorInstances.has(inst.id)
  ) {
    const focused = await window.api.focusComfyWindow(inst.id)
    // `errorInstances` can be hydrated from the retained crash buffer after
    // the window was closed, so a focus may find nothing — fall through and
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

/** Only `openCloud` is used here — this view resolves the flag and tier itself
 *  below, so `immediate: false` keeps the gate from repeating those two IPCs. */
const cloudGate = useCloudGate({ immediate: false })

const cloudFreeRunsEnabled = ref(false)
const cloudUserTier = ref<CloudUserTier>('unknown')
const showCloudFreeRunsPill = computed(
  () => cloudFreeRunsEnabled.value && cloudUserTier.value !== 'paid'
)

/** The explainer outlives the free-runs pill: it's a pitch for Cloud itself,
 *  not for the trial, so it rides the tier alone rather than the free-tier
 *  flag the pill waits on. A subscriber already bought the pitch. */
const showWhyCloud = computed(() => cloudUserTier.value !== 'paid')

const whyCloudOpen = ref(false)

function openWhyCloud(): void {
  whyCloudOpen.value = true
  emitTelemetryAction('comfy.desktop.dashboard.why_cloud_opened', {})
}

/** The modal collapses Maybe-Later, ✕, Escape and scrim-click into one `close`,
 *  so every non-conversion exit reports the same way. */
function dismissWhyCloud(): void {
  whyCloudOpen.value = false
  emitTelemetryAction('comfy.desktop.dashboard.why_cloud_action', { action: 'dismiss' })
}

/** Unlike first-use — where the ToS gate means the CTA can only pre-select
 *  Cloud — the dashboard has no gate left to clear, so the button launches. */
async function onWhyCloudTryCloud(): Promise<void> {
  whyCloudOpen.value = false
  emitTelemetryAction('comfy.desktop.dashboard.why_cloud_action', { action: 'try_cloud' })
  await cloudGate.openCloud()
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
  }
})
function handleNewInstallClick(): void {
  emit('show-new-install')
}

/** Shared by every `ChooserFamilyGrid`, so a tile behaves the same whichever
 *  shelf it landed in. */
const gridHandlers = {
  'new-install': handleNewInstallClick,
  pick: pickInstall,
  'open-card-menu': openCardMenu,
  'open-kebab-menu': openKebabMenu,
  'trigger-action': (action: 'update' | 'migrate', inst: Installation) =>
    triggerAction(action, inst),
  'view-error': viewError,
  'view-danger': viewDanger,
  'dist-select': handleDistributionActivate,
  'dist-kebab': openDistKebabMenu,
  'why-cloud': openWhyCloud
}
</script>

<template>
  <BrandBackground v-show="props.visible" class="chooser-bg">
    <div class="chooser-view" :style="{ '--rows': clusterRows }">
      <!-- Identity, top-right: the account chip when signed in, a quiet log-in
           button when not. Absolutely positioned so it never enters the
           centered wordmark → search → grid column. -->
      <div class="chooser-account">
        <DevPlatformAccountChip />
      </div>

      <ComfyWordmark class="chooser-wordmark" aria-hidden="true" />
      <div class="chooser-search">
        <BaseInput
          v-model="searchQuery"
          :placeholder="t('chooser.searchPlaceholder')"
          :aria-label="t('chooser.searchPlaceholder')"
        >
          <template #leading><Search :size="16" /></template>
        </BaseInput>
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
        <!-- Your installs: bare tiles, no header, centered until a shelf
             appears beneath them. -->
        <section class="chooser-shelf">
          <ChooserFamilyGrid
            show-new
            :centered="!showWorkspaceShelf"
            :entries="ownEntries"
            :show-free-runs-pill="showCloudFreeRunsPill"
            :show-why-cloud="showWhyCloud"
            :is-stopped-action-gated="isStoppedActionGated"
            v-on="gridHandlers"
          />
        </section>

        <!-- The workspace shelf: what it already put on this machine, then what
             it still offers on a fresh row. -->
        <!-- Gated on the same pre-search predicate as the grid's centering:
             if the shelf ducked out when a query filtered its entries, the
             own-installs grid above would sit left-aligned under no header.
             With every entry filtered, the header stays with a 0 count. -->
        <section v-if="showWorkspaceShelf" class="chooser-shelf">
          <header class="chooser-shelf-head">
            <span class="chooser-shelf-title">{{ t('chooser.workspaceShelf') }}</span>
            <span class="chooser-shelf-count">{{
              workspaceInstalledEntries.length + workspaceAvailableEntries.length
            }}</span>
          </header>
          <ChooserFamilyGrid
            v-if="workspaceInstalledEntries.length"
            :entries="workspaceInstalledEntries"
            :show-free-runs-pill="showCloudFreeRunsPill"
            :show-why-cloud="showWhyCloud"
            :is-stopped-action-gated="isStoppedActionGated"
            v-on="gridHandlers"
          />
          <ChooserFamilyGrid
            v-if="workspaceAvailableEntries.length"
            :entries="workspaceAvailableEntries"
            :show-free-runs-pill="showCloudFreeRunsPill"
            :show-why-cloud="showWhyCloud"
            :is-stopped-action-gated="isStoppedActionGated"
            v-on="gridHandlers"
          />
        </section>
      </div>

      <button
        v-if="distributionLoadFailed"
        type="button"
        class="chooser-dist-note chooser-dist-note--retry"
        @click="authStore.fetchDistributions()"
      >
        {{ $t('devPlatform.distribution.loadError') }}
      </button>
      <p v-else-if="distributionNote" class="chooser-dist-note">{{ distributionNote }}</p>

      <ContextMenu
        :open="ctxMenu.open"
        :x="ctxMenu.x"
        :y="ctxMenu.y"
        :items="ctxMenuItems"
        @close="closeMenu"
        @select="handleCtxMenuSelect"
      />

      <ContextMenu
        :open="distMenu.open"
        :x="distMenu.x"
        :y="distMenu.y"
        :items="distMenuItems"
        @close="closeDistMenu"
        @select="handleDistMenuSelect"
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
  /* Symmetric top + bottom spacers (both 1fr) center the wordmark→grid block
   * as a group whenever it fits — looks deliberate at any viewport height.
   * When the (unfiltered) content is taller than the viewport, the
   * `minmax(0, 1fr)` spacers collapse to 0 and the grid scrolls internally.
   * Rows: [top spacer] [wordmark] [search] [grid] [bottom spacer]
   *
   * No-shift guarantee: the grid row reserves its height from the UNFILTERED
   * `--rows` (see `.chooser-grid` min-height), so typing in search empties
   * tiles without shrinking the grid box — the centered cluster stays put. */
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

/* Quiet one-liner for the distribution family's empty story. Lives in the
 * bottom spacer row so it costs the centered cluster no layout; on a short
 * window the spacer collapses and this caption is the first thing to go. */
.chooser-dist-note {
  grid-row: 5;
  align-self: start;
  margin: 0;
  padding-top: 4px;
  font-size: var(--takeover-fs-caption);
  color: var(--text-muted);
  text-align: center;
}
.chooser-dist-note--retry {
  border: none;
  background: none;
  font: inherit;
  cursor: pointer;
}
.chooser-dist-note--retry:hover {
  color: var(--neutral-100);
  text-decoration: underline;
}
.chooser-dist-note--retry:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: 4px;
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

.chooser-search {
  grid-row: 3;
  display: flex;
  justify-content: center;
  width: 100%;
  flex-shrink: 0;
}

.chooser-search :deep(.ui-input) {
  max-width: 600px;
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

/* The scroll viewport both shelves live in — column, scroll and fade only;
 * tile layout and the FLIP belong to `ChooserFamilyGrid`. */
.chooser-shelves {
  grid-row: 4;
  width: 100%;
  /* Content box must hold exactly 4 tracks (4 × 280 + 3 × 16 = 1168px), so the
   * side padding sits OUTSIDE the cap — inside it, `auto-fit` drops to 3
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

/* Caption weight: the shelf organises, it isn't a section you act on. */
.chooser-shelf-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.chooser-shelf-head::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: var(--chooser-surface-border-hover);
}
.chooser-shelf-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.chooser-shelf-count {
  font-size: 11px;
  color: var(--text-faint);
}
</style>
