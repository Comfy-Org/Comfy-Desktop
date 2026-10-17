<script setup lang="ts">
import { computed, onMounted, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInstallationStore } from '../stores/installationStore'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallContextMenu } from '../composables/useInstallContextMenu'
import { useInstallList } from '../composables/useInstallList'
import { useDashboardWorkspace } from '../composables/useDashboardWorkspace'
import { usePickInstall } from '../composables/usePickInstall'
import { useCloudTier } from '../composables/useCloudTier'
import { useWhyCloud } from '../composables/useWhyCloud'
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
import type { Installation, ShowProgressOpts } from '../types/ipc'

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
const authStore = useAuthStore()
const dashboardScope = useDashboardScopeStore()
// The dashboard is in the Void palette's scope; its teleported menus inherit it.
const paletteScope = providePaletteScope()

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

const {
  selectedWorkspaceModel,
  installationIsInSelectedScope,
  refreshingWorkspace,
  refreshWorkspace,
  canPromoteToWorkspace
} = useDashboardWorkspace()

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

// --- Manage / context menu ---
// All Manage routes go through `window.api.openInstancePicker` (the
// picker popup) - the legacy `useOverlay`-driven `ManageInstallModal`
// route is retired.

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

const { pickInstall } = usePickInstall((inst) => emit('pick', inst))
const { showCloudFreeRunsPill, showWhyCloud } = useCloudTier()
const { whyCloudOpen, openWhyCloud, dismissWhyCloud, onWhyCloudTryCloud } = useWhyCloud()

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
      <!-- Signed-in account identity, top right, outside the content column. -->
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
