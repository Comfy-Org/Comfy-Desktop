<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import { useAuthStore } from '../stores/authStore'
import { useInstallContextMenu } from '../composables/useInstallContextMenu'
import { useInstallList } from '../composables/useInstallList'
import { useCloudCapacity } from '../composables/useCloudCapacity'
import { useModal } from '../composables/useModal'
import { Search } from 'lucide-vue-next'
import ContextMenu from '../components/ContextMenu.vue'
import BrandBackground from '../components/BrandBackground.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import ComfyWordmark from '../components/icons/ComfyWordmark.vue'
import ChooserFamilyGrid from './chooser/ChooserFamilyGrid.vue'
import DevPlatformAccountChip from './devplatform/DevPlatformAccountChip.vue'
import { resolvePickerTab } from '../lib/pickerTabs'
import type { ChooserGridEntry } from './chooser/chooser-proto'
import type { Distribution } from '../devplatform/types'
import type { ContextMenuItem } from '../types/context-menu'
import type { Installation, ShowProgressOpts } from '../types/ipc'

/**
 * Chooser view — PROTOTYPE branch (shelves layout).
 *
 * One scrolling column, two shelves: the user's own installs sit bare at the
 * top (New Install tile first), then one workspace shelf headed by the
 * workspace name — builder-backed installs and installed distributions on the
 * first row(s), available distributions starting on a fresh row beneath.
 *
 * Prototype copy is hardcoded English — dies with the branch. Tile rendering
 * + event plumbing is shared via ChooserFamilyGrid.
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
  /** User activated a distribution tile — the host starts the install flow.
   *  Not consumed yet: wiring the id into the comfybuilder install chain is
   *  the next slice. */
  'install-distribution': [distribution: Distribution]
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

// Sign-in can happen ON this page (the chip's log-in button), so the
// distribution list follows the session rather than mount timing.
watch(
  () => authStore.isSignedIn,
  (signedIn) => {
    if (signedIn && authStore.distributions.length === 0) void authStore.fetchDistributions()
  },
  { immediate: true }
)

const installationsRef = toRef(installationStore, 'installations')
const { searchQuery, activeFilter, visibleInstalls, showEmptyHint, matchesQuery } = useInstallList({
  installations: installationsRef
})

// Explicitly expose `activeFilter` so the brand-redesign tests can
// drive the underlying filter state without the chip UI mounted.
defineExpose({ activeFilter })

// --- Comfy Builder distributions ---
//
// DE-DUPLICATION: an already-installed distribution is an ordinary
// installation and must not be listed twice. There is no reliable link field
// yet, so: `installation.distributionId` when a future backend populates it
// (the index signature carries unknown fields through), else case-insensitive
// name equality — names are what the user picks by, and an install created
// from a distribution inherits its name. A distribution whose own state is
// installed but which matches no local installation is still shown: hiding it
// would leave the user no route to it at all.
function installationBacksDistribution(inst: Installation, dist: Distribution): boolean {
  const linked = inst.distributionId
  if (typeof linked === 'string' && linked.length > 0) return linked === dist.id
  return inst.name.trim().toLowerCase() === dist.name.trim().toLowerCase()
}

/** Every distribution that earns a tile, before search. Empty when signed out. */
const chooserDistributions = computed<Distribution[]>(() => {
  if (!authStore.isSignedIn) return []
  return authStore.distributions.filter(
    (dist) =>
      !installationStore.installations.some((inst) => installationBacksDistribution(inst, dist))
  )
})

/** Search filters distributions through the SAME query as the install tiles —
 *  a search that silently ignored half the grid would be a lie. */
const visibleDistributions = computed<Distribution[]>(() =>
  chooserDistributions.value.filter((dist) => matchesQuery(dist.name))
)

/** The no-matches hint may only fire when NOTHING in the grid matches. */
const showNoMatches = computed(() => showEmptyHint.value && visibleDistributions.value.length === 0)

/** One quiet line under the grid when the signed-in workspace has nothing
 *  published. Never a panel — this page already has content. */
const distributionNote = computed(() => {
  if (!authStore.isSignedIn) return ''
  if (searchQuery.value.trim()) return ''
  if (authStore.loadingDistributions) return ''
  if (authStore.distributions.length === 0) return t('devPlatform.distribution.emptyTitle')
  return ''
})

function handleDistributionActivate(dist: Distribution): void {
  emit('install-distribution', dist)
}

// --- PROTOTYPE: family partitions -----------------------------------------
//
// Family 1 "yours": the New Install tile + every install that doesn't back a
// workspace distribution (local, cloud, remote alike).
// Family 2 "installed from workspace": installs that back a distribution,
// plus mock distributions already in an installed/update-available state
// (they represent installs this machine has no record for yet).
// Family 3 "available from workspace": everything still installable or
// blocked-with-reason.

function isBuilderInstall(inst: Installation): boolean {
  return authStore.distributions.some((dist) => installationBacksDistribution(inst, dist))
}

const plainInstalls = computed(() => visibleInstalls.value.filter((i) => !isBuilderInstall(i)))
const builderInstalls = computed(() => visibleInstalls.value.filter((i) => isBuilderInstall(i)))
const installedDists = computed(() =>
  visibleDistributions.value.filter(
    (d) => d.state === 'installed' || d.state === 'update-available'
  )
)
const availableDists = computed(() =>
  visibleDistributions.value.filter(
    (d) => d.state !== 'installed' && d.state !== 'update-available'
  )
)

function installEntry(inst: Installation): ChooserGridEntry {
  return { kind: 'install', inst }
}
function distEntry(dist: Distribution): ChooserGridEntry {
  return { kind: 'dist', dist }
}

const yourEntries = computed<ChooserGridEntry[]>(() => plainInstalls.value.map(installEntry))
const installedEntries = computed<ChooserGridEntry[]>(() => [
  ...builderInstalls.value.map(installEntry),
  ...installedDists.value.map(distEntry)
])
const availableEntries = computed<ChooserGridEntry[]>(() => availableDists.value.map(distEntry))

const workspaceName = computed(() => authStore.selectedWorkspace?.name ?? 'Workspace')

/** The workspace shelf exists when the signed-in workspace has anything to
 *  show. Judged on the PRE-SEARCH lists so typing in search can't flip the
 *  page between its two arrangements; without a shelf the page falls back
 *  to the shipped centered grid — most users never see shelves at all. */
const showWorkspaceShelf = computed(
  () =>
    authStore.isSignedIn &&
    (chooserDistributions.value.length > 0 ||
      installationStore.installations.some(isBuilderInstall))
)

// --- Distribution kebab menu ---
const distMenu = ref<{ open: boolean; x: number; y: number; dist: Distribution | null }>({
  open: false,
  x: 0,
  y: 0,
  dist: null
})

const distMenuItems = computed<ContextMenuItem[]>(() => {
  const dist = distMenu.value.dist
  if (!dist) return []
  const installable = dist.state === 'installable' || dist.state === 'update-available'
  return [
    {
      id: 'install',
      label: t('devPlatform.distribution.menuInstall'),
      disabled: !installable
    }
  ]
})

function openDistKebabMenu(event: MouseEvent, dist: Distribution): void {
  const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect?.()
  // Right-aligned drop, matching the install-tile kebab. ContextMenu clamps
  // to the viewport, so a negative x is safe.
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
  if (itemId === 'install' && dist) handleDistributionActivate(dist)
}

// --- Manage / context menu ---
// All Manage routes go through `window.api.openInstancePicker` (the
// picker popup) — the legacy `useOverlay`-driven `ManageInstallModal`
// route is retired.

function openManage(
  installation: Installation,
  opts: { initialTab?: string; autoAction?: string | null } = {}
): void {
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
  // pipeline used by every other long op fires here too.
  onShowProgress: (showOpts) => emit('show-progress', showOpts)
})

async function pickInstall(inst: Installation): Promise<void> {
  // The instance window owns lifecycle. If a host window already exists for
  // this install — running, launching, OR crashed — bring it forward instead
  // of kicking off a second launch with a dashboard takeover.
  if (
    sessionStore.isRunning(inst.id) ||
    sessionStore.isLaunching(inst.id) ||
    sessionStore.errorInstances.has(inst.id)
  ) {
    const focused = await window.api.focusComfyWindow(inst.id)
    if (focused) return
  }
  // Cloud capacity gate — catches the case where a cloud install
  // already exists and the user clicks its per-install tile.
  if (inst.sourceCategory === 'cloud' && !(await cloudCapacity.confirmEntry('picker'))) return
  emit('pick', inst)
}

/** Surface a failed install's error so it's readable from the dashboard. */
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

/** Surface a backend-flagged danger state from its dashboard pill. */
function viewDanger(inst: Installation): void {
  const tag = inst.statusTag
  if (!tag || tag.style !== 'danger') return
  void modal.alert({ title: tag.label, message: tag.detail || tag.label })
}

const cloudCapacity = useCloudCapacity()
function handleNewInstallClick(): void {
  emit('show-new-install')
}

/** One handler set shared by every ChooserFamilyGrid instance (`v-on`). */
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
  'dist-kebab': openDistKebabMenu
}
</script>

<template>
  <BrandBackground v-show="props.visible" class="chooser-bg">
    <div class="chooser-view">
      <!-- Identity, top-right: the account chip when signed in, a quiet log-in
           button when not. -->
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

      <div v-else class="proto-scroll">
        <!-- Your installs: bare tiles at the top, no header. Centered (the
             shipped look) whenever there's no workspace shelf beneath —
             a lone left-aligned cluster reads as broken, not arranged. -->
        <section class="proto-shelf">
          <ChooserFamilyGrid
            show-new
            :centered="!showWorkspaceShelf"
            :entries="yourEntries"
            :is-stopped-action-gated="isStoppedActionGated"
            v-on="gridHandlers"
          />
        </section>

        <!-- One workspace shelf headed by the workspace name; available
             distributions follow the installed ones on a fresh row (two
             stacked grids sharing the section's row gap). -->
        <section
          v-if="showWorkspaceShelf && (installedEntries.length || availableEntries.length)"
          class="proto-shelf"
        >
          <header class="proto-shelf-head">
            <span class="proto-shelf-title">{{ workspaceName }}</span>
            <span class="proto-shelf-count">{{
              installedEntries.length + availableEntries.length
            }}</span>
          </header>
          <ChooserFamilyGrid
            v-if="installedEntries.length"
            :entries="installedEntries"
            :is-stopped-action-gated="isStoppedActionGated"
            v-on="gridHandlers"
          />
          <ChooserFamilyGrid
            v-if="availableEntries.length"
            :entries="availableEntries"
            :is-stopped-action-gated="isStoppedActionGated"
            v-on="gridHandlers"
          />
        </section>
      </div>

      <p v-if="distributionNote" class="chooser-dist-note">{{ distributionNote }}</p>

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

.chooser-view {
  /* Symmetric top + bottom spacers (both 1fr) center the wordmark→grid block
   * as a group whenever it fits. When the content is taller than the
   * viewport, the `minmax(0, 1fr)` spacers collapse to 0 and the content
   * region scrolls internally.
   * Rows: [top spacer] [wordmark] [search] [content] [bottom spacer] */
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

/* Account chip — pinned to the frame's top-right, out of the centered column
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

/* Quiet one-liner for the distribution family's empty story. */
.chooser-dist-note {
  grid-row: 5;
  align-self: start;
  margin: 0;
  padding-top: 4px;
  font-size: var(--takeover-fs-caption);
  color: var(--text-muted);
  text-align: center;
}

.chooser-wordmark {
  grid-row: 2;
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

/* ==========================================================================
 * PROTOTYPE (throwaway branch) — layout containers
 * ========================================================================== */

/* Shared scroll surface for the content row. */
.proto-scroll {
  grid-row: 4;
  width: 100%;
  /* Content box must hold exactly 4 tracks (4 × 280px + 3 × 16px = 1168px);
   * the side padding — breathing room so edge tiles' focus rings don't clip
   * against the scroll container — goes on top, or auto-fit drops to 3. */
  --proto-pad-x: 4px;
  max-width: calc(1168px + 2 * var(--proto-pad-x));
  min-height: 0;
  max-height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 28px;
  --chooser-fade: clamp(12px, 2.5vh, 24px);
  padding: var(--chooser-fade) var(--proto-pad-x);
}

/* Soft top + bottom fade so rows glide under the edge instead of clipping. */
@supports (mask-image: linear-gradient(black, black)) {
  .proto-scroll {
    mask-image: linear-gradient(
      to bottom,
      transparent 0,
      black var(--chooser-fade),
      black calc(100% - var(--chooser-fade)),
      transparent 100%
    );
  }
}

.proto-shelf {
  display: flex;
  flex-direction: column;
  /* Matches the grid's row gap so two stacked grids in one shelf read as
   * continuous rows, not separate blocks. */
  gap: 16px;
}

.proto-shelf-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.proto-shelf-head::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: var(--chooser-surface-border-hover);
}
.proto-shelf-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.proto-shelf-count {
  font-size: 11px;
  color: var(--text-faint);
}
</style>
