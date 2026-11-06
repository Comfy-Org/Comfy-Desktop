<script setup lang="ts">
import { computed } from 'vue'
import { Code, Palette } from 'lucide-vue-next'
import DetailSheet from '../parts/DetailSheet.vue'
import MarTemplateModal from '../mar/templateModal/MarTemplateModal.vue'
import MarDeployModal from '../mar/deploy/MarDeployModal.vue'
import LaunchOverlay from '../parts/LaunchOverlay.vue'
import LoginPrompt from '../parts/LoginPrompt.vue'
import WorkspaceMenu from '../parts/WorkspaceMenu.vue'
import DeployToolDialog from '../parts/space/DeployToolDialog.vue'
import NewSpaceFlow from '../parts/space/NewSpaceFlow.vue'
import PublishDialog from '../parts/apps/PublishDialog.vue'
import ShareDialog from '../parts/apps/ShareDialog.vue'
import AgentNav from '../parts/agent/AgentNav.vue'
import ModeNav from '../parts/env/ModeNav.vue'
import SidebarGroup from '../parts/env/SidebarGroup.vue'
import SpacesGroup from '../parts/space/SpacesGroup.vue'
import ModePages from '../pages/modes/ModePages.vue'
import { goIn, proto, type Mode } from '../useProto'
import { building } from '../appFlow'
import { can, landingPage } from '../milestones'
import { AgentChat } from '../mar/icons/agentChat'
import MarBackdrop from '../mar/shell/MarBackdrop.vue'
import MarSidebarToggle from '../mar/shell/MarSidebarToggle.vue'
import MarPanelsHead from '../mar/shell/MarPanelsHead.vue'
import MarFavoritesGroup from '../mar/shell/MarFavoritesGroup.vue'
import MarBuildsNav from '../mar/shell/MarBuildsNav.vue'
import { marSidebarClosed } from '../mar/shell/marShell'
import MarModeSeg from '../mar/modes/MarModeSeg.vue'
import MarModeSwitch from '../mar/modes/MarModeSwitch.vue'
import { marTabsOn } from '../mar/shell/titleTabs'

/**
 * The launcher from Milestone 2 on: a sidebar and the page it opens.
 *   2-3  Builds (the landing), then Tools: Benchmarks, Performance Tests
 *   4-5  Home (then Explore and Learn) above the builds
 *   6    Create / Build: the Builder's lens to ship builds as APIs
 *   8    Projects take the builds' place in the sidebar group
 *   9    Spaces, under the projects
 *   10   Agent: a third lens, with its own sidebar of chats
 * The workspace switcher sits at the sidebar's foot. Admin (usage, billing,
 * people, …) lives in its menu.
 */
const mode = computed({
  get: () => proto.mode,
  set: (m: Mode) =>
    goIn(m, m === 'build' ? 'build-overview' : m === 'agent' ? 'agent' : landingPage())
})
// The sidebar can also be closed by hand.
const sidebarHidden = computed(() => building.value || marSidebarClosed.value)
const MODES = computed(() => [
  { value: 'create' as Mode, label: 'Create', icon: Palette },
  { value: 'build' as Mode, label: 'Build', icon: Code },
  ...(can.value.agent && !marTabsOn.value
    ? [{ value: 'agent' as Mode, label: 'Agent', icon: AgentChat }]
    : [])
])
</script>

<template>
  <div
    :class="[
      'proto-shell relative flex size-full min-h-0 flex-1 overflow-hidden bg-app-background',
      { 'mar-closed': sidebarHidden }
    ]"
  >
    <!-- App-builder mode (the agent making an app): the creator can close
         the sidebar to give the chat and the app the room. -->
    <aside
      :class="[
        'proto-sidebar sidebar-slide relative z-5 flex shrink-0 flex-col [--glyph-ring:var(--color-app-background)] [scrollbar-width:none]',
        sidebarHidden
          ? 'pointer-events-none m-0 w-0 overflow-hidden p-0 opacity-0'
          : 'm-2 mr-0 w-59 overflow-y-auto p-2'
      ]"
      :aria-hidden="sidebarHidden || undefined"
      :inert="sidebarHidden || undefined"
    >
      <div class="flex min-h-full w-55 shrink-0 flex-col">
        <!-- Floating panels: the Comfy mark and the collapse toggle. -->
        <MarPanelsHead />
        <!-- Create / Build (Milestone 6: the Builder) -->
        <div v-if="can.builder" class="mb-3 flex h-8.5 shrink-0 items-center">
          <MarModeSeg v-if="marTabsOn" v-model="mode" :options="MODES" show="label" fill />
          <MarModeSwitch v-else v-model="mode" :options="MODES" />
        </div>

        <AgentNav v-if="proto.mode === 'agent'" />
        <ModeNav v-else-if="can.home || proto.mode === 'build'" :mode="proto.mode" />
        <!-- The builds (or projects). New users have none yet (Home walks them
           through). -->
        <!-- Stars arrive with Explore: the first thing there is to star. -->
        <MarFavoritesGroup v-if="proto.mode === 'create' && can.exploreApps && !proto.fresh" />
        <!-- Kept for a new user, each with an empty state, and the builds
             show even with no local install. -->
        <!-- Before Home: Builds and Tools, as Desktop has them today. -->
        <MarBuildsNav v-if="proto.mode === 'create' && !can.home" />
        <SidebarGroup v-else-if="proto.mode === 'create'" />
        <SpacesGroup v-if="proto.mode === 'create' && can.spaces" />

        <div class="mt-auto flex flex-col gap-2 pt-3"><WorkspaceMenu /></div>
      </div>
    </aside>
    <MarSidebarToggle v-if="!building" />

    <main
      class="proto-main relative min-w-0 flex-1 overflow-y-auto [scrollbar-color:rgb(255_255_255/0.12)_transparent] [scrollbar-width:thin]"
    >
      <MarBackdrop />
      <ModePages />
    </main>

    <MarTemplateModal />
    <DetailSheet v-if="proto.detail?.kind !== 'template'" />
    <LaunchOverlay />
    <LoginPrompt />
    <MarDeployModal />
    <DeployToolDialog />
    <NewSpaceFlow v-if="can.spaces" />
    <template v-if="can.agent"><PublishDialog /><ShareDialog /></template>
  </div>
</template>

<style scoped>
/* Closing and opening the sidebar for app-builder mode: one move on
   screen, so ease-in-out; the content fades a touch faster than the
   width, so it never squeezes. Rare (once per app), so width is fine. */
.sidebar-slide {
  transition:
    width 320ms cubic-bezier(0.645, 0.045, 0.355, 1),
    margin 320ms cubic-bezier(0.645, 0.045, 0.355, 1),
    padding 320ms cubic-bezier(0.645, 0.045, 0.355, 1),
    opacity 200ms ease;
}
@media (prefers-reduced-motion: reduce) {
  .sidebar-slide {
    transition: opacity 200ms ease;
  }
}
</style>
