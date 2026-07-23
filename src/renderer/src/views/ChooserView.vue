<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
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
import ChooserLayoutSwitcher from './chooser/ChooserLayoutSwitcher.vue'
import DevPlatformAccountChip from './devplatform/DevPlatformAccountChip.vue'
import { resolvePickerTab } from '../lib/pickerTabs'
import type {
  ChooserGridEntry,
  ChooserProtoFilter,
  ChooserProtoLayout
} from './chooser/chooser-proto'
import type { Distribution } from '../devplatform/types'
import type { ContextMenuItem } from '../types/context-menu'
import type { Installation, ShowProgressOpts } from '../types/ipc'

/**
 * Chooser view — PROTOTYPE branch.
 *
 * Three competing IA layouts for delineating the tile families (the user's
 * own installs / builder-backed installs / available workspace
 * distributions), switchable live via the floating HUD (or keys 1/2/3):
 *
 *   - shelves: one column, labelled section headers.
 *   - chips:   flat mixed grid + family filter chips; workspace tiles tinted.
 *   - zones:   spatial split — your installs left, workspace panel right.
 *
 * All copy in the prototype layer is hardcoded English — throwaway with the
 * branch. Tile rendering + event plumbing is shared via ChooserFamilyGrid.
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
  return { kind: 'install', inst, builder: isBuilderInstall(inst) }
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
/** Layout B's "All": the shipped order — installs by recency, then dists. */
const allEntries = computed<ChooserGridEntry[]>(() => [
  ...visibleInstalls.value.map(installEntry),
  ...visibleDistributions.value.map(distEntry)
])

const workspaceName = computed(() => authStore.selectedWorkspace?.name ?? 'Workspace')

// --- PROTOTYPE: layout switching -------------------------------------------

const PROTO_LAYOUT_KEY = 'chooser-proto-layout'

function readStoredLayout(): ChooserProtoLayout {
  try {
    const stored = localStorage.getItem(PROTO_LAYOUT_KEY)
    if (stored === 'shelves' || stored === 'chips' || stored === 'zones') return stored
  } catch {
    // storage unavailable (tests) — fall through to default
  }
  return 'shelves'
}

const layoutMode = ref<ChooserProtoLayout>(readStoredLayout())
watch(layoutMode, (mode) => {
  try {
    localStorage.setItem(PROTO_LAYOUT_KEY, mode)
  } catch {
    // storage unavailable — layout just won't persist
  }
})

/** Keys 1/2/3 flip layouts when focus isn't in a text field. */
function onProtoKeydown(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target as HTMLElement | null
  if (
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  ) {
    return
  }
  const map: Record<string, ChooserProtoLayout> = { '1': 'shelves', '2': 'chips', '3': 'zones' }
  const next = map[event.key]
  if (next) layoutMode.value = next
}
onMounted(() => window.addEventListener('keydown', onProtoKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onProtoKeydown))

// --- PROTOTYPE: layout B chip filter ---------------------------------------

const protoFilter = ref<ChooserProtoFilter>('all')

const protoChips = computed(
  (): { key: ChooserProtoFilter; label: string; count: number; builder: boolean }[] => [
    { key: 'all', label: 'All', count: allEntries.value.length, builder: false },
    { key: 'yours', label: 'Yours', count: plainInstalls.value.length, builder: false },
    {
      key: 'installed',
      label: 'Workspace · installed',
      count: installedEntries.value.length,
      builder: true
    },
    {
      key: 'available',
      label: 'Workspace · available',
      count: availableEntries.value.length,
      builder: true
    }
  ]
)

const chipEntries = computed<ChooserGridEntry[]>(() => {
  switch (protoFilter.value) {
    case 'yours':
      return yourEntries.value
    case 'installed':
      return installedEntries.value
    case 'available':
      return availableEntries.value
    default:
      return allEntries.value
  }
})

const chipShowsNew = computed(
  () => protoFilter.value === 'all' || protoFilter.value === 'yours'
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

      <!-- ============ Layout A — Shelves ============ -->
      <div v-else-if="layoutMode === 'shelves'" class="proto-scroll">
        <section class="proto-shelf">
          <header class="proto-shelf-head">
            <span class="proto-shelf-title">Your installs</span>
            <span class="proto-shelf-count">{{ plainInstalls.length }}</span>
          </header>
          <ChooserFamilyGrid
            show-new
            align="start"
            :entries="yourEntries"
            :is-stopped-action-gated="isStoppedActionGated"
            v-on="gridHandlers"
          />
        </section>

        <section v-if="authStore.isSignedIn && installedEntries.length" class="proto-shelf">
          <header class="proto-shelf-head">
            <span class="proto-shelf-dot" aria-hidden="true" />
            <span class="proto-shelf-title">Installed from {{ workspaceName }}</span>
            <span class="proto-shelf-count">{{ installedEntries.length }}</span>
          </header>
          <ChooserFamilyGrid
            align="start"
            :entries="installedEntries"
            :is-stopped-action-gated="isStoppedActionGated"
            v-on="gridHandlers"
          />
        </section>

        <section v-if="authStore.isSignedIn && availableEntries.length" class="proto-shelf">
          <header class="proto-shelf-head">
            <span class="proto-shelf-dot" aria-hidden="true" />
            <span class="proto-shelf-title">Available from {{ workspaceName }}</span>
            <span class="proto-shelf-count">{{ availableEntries.length }}</span>
          </header>
          <ChooserFamilyGrid
            align="start"
            :entries="availableEntries"
            :is-stopped-action-gated="isStoppedActionGated"
            v-on="gridHandlers"
          />
        </section>
      </div>

      <!-- ============ Layout B — Chips ============ -->
      <div v-else-if="layoutMode === 'chips'" class="proto-stack">
        <div class="proto-chips">
          <button
            v-for="chip in protoChips"
            :key="chip.key"
            type="button"
            class="proto-chip"
            :class="{ 'proto-chip--active': protoFilter === chip.key }"
            :disabled="chip.count === 0 && chip.key !== 'all'"
            @click="protoFilter = chip.key"
          >
            <span v-if="chip.builder" class="proto-chip-dot" aria-hidden="true" />
            {{ chip.label }}
            <span class="proto-chip-count">{{ chip.count }}</span>
          </button>
        </div>
        <div class="proto-scroll proto-scroll--flat">
          <ChooserFamilyGrid
            :show-new="chipShowsNew"
            tag-builder
            :entries="chipEntries"
            :is-stopped-action-gated="isStoppedActionGated"
            v-on="gridHandlers"
          />
        </div>
      </div>

      <!-- ============ Layout C — Zones ============ -->
      <div v-else class="proto-scroll proto-zones">
        <section class="proto-zone">
          <header class="proto-zone-head">
            <span class="proto-zone-kicker proto-zone-kicker--plain">This computer</span>
            <span class="proto-zone-title">Your installs</span>
          </header>
          <ChooserFamilyGrid
            fluid
            show-new
            align="start"
            :entries="yourEntries"
            :is-stopped-action-gated="isStoppedActionGated"
            v-on="gridHandlers"
          />
        </section>

        <section v-if="authStore.isSignedIn" class="proto-zone proto-zone--workspace">
          <header class="proto-zone-head">
            <span class="proto-zone-kicker">Workspace</span>
            <span class="proto-zone-title">{{ workspaceName }}</span>
          </header>

          <div class="proto-zone-sub">Installed</div>
          <ChooserFamilyGrid
            v-if="installedEntries.length"
            fluid
            align="start"
            :entries="installedEntries"
            :is-stopped-action-gated="isStoppedActionGated"
            v-on="gridHandlers"
          />
          <p v-else class="proto-zone-empty">Nothing installed from this workspace yet</p>

          <div class="proto-zone-sub">Available</div>
          <ChooserFamilyGrid
            v-if="availableEntries.length"
            fluid
            align="start"
            :entries="availableEntries"
            :is-stopped-action-gated="isStoppedActionGated"
            v-on="gridHandlers"
          />
          <p v-else class="proto-zone-empty">No distributions available</p>
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

      <ChooserLayoutSwitcher v-model="layoutMode" />
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
  /* PROTOTYPE: workspace-family accent shared by all three layouts. */
  --proto-builder: #a78bfa;
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
  max-width: 1168px;
  min-height: 0;
  max-height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 28px;
  --chooser-fade: clamp(12px, 2.5vh, 24px);
  padding: var(--chooser-fade) 2px;
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

/* --- Layout A: shelves --- */

.proto-shelf {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
.proto-shelf-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--proto-builder) 75%, transparent);
  flex-shrink: 0;
}

/* --- Layout B: chips over a flat grid --- */

.proto-stack {
  grid-row: 4;
  width: 100%;
  min-height: 0;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
.proto-stack .proto-scroll {
  grid-row: auto;
  flex: 0 1 auto;
}

.proto-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  flex-shrink: 0;
}

.proto-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--chooser-surface-border-hover);
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background-color 100ms ease,
    border-color 100ms ease,
    color 100ms ease;
}
.proto-chip:hover:not(:disabled) {
  background: var(--chooser-surface-bg-hover);
  color: var(--text);
}
.proto-chip--active {
  background: var(--chooser-surface-bg-hover);
  border-color: var(--border-strong, rgba(255, 255, 255, 0.3));
  color: var(--text);
}
.proto-chip:disabled {
  opacity: 0.4;
  cursor: default;
}
.proto-chip-count {
  font-size: 11px;
  color: var(--text-faint);
}
.proto-chip-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--proto-builder) 75%, transparent);
  flex-shrink: 0;
}

/* --- Layout C: machine / workspace zones --- */

.proto-zones {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
  align-content: flex-start;
  gap: 20px;
}

.proto-zone {
  flex: 1 1 340px;
  min-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.proto-zone--workspace {
  border: 1px solid color-mix(in srgb, var(--proto-builder) 25%, transparent);
  background: color-mix(in srgb, var(--proto-builder) 6%, transparent);
  border-radius: 16px;
  padding: 14px 16px 16px;
}

.proto-zone-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.proto-zone-kicker {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--proto-builder) 80%, var(--text-muted));
}
.proto-zone-kicker--plain {
  color: var(--text-faint);
}
.proto-zone-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.proto-zone-sub {
  margin-top: 6px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.proto-zone-empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-faint);
}
</style>
