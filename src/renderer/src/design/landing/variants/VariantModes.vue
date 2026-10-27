<script setup lang="ts">
import { computed } from 'vue'
import { Code, Palette, Sparkles } from 'lucide-vue-next'
import ModeSwitch from '../parts/ModeSwitch.vue'
import DetailSheet from '../parts/DetailSheet.vue'
import LaunchOverlay from '../parts/LaunchOverlay.vue'
import LoginPrompt from '../parts/LoginPrompt.vue'
import WorkspaceMenu from '../parts/WorkspaceMenu.vue'
import DeployDialog from '../parts/env/DeployDialog.vue'
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
import { can, landingPage } from '../milestones'

/**
 * The launcher from Milestone 2 on: a sidebar and the page it opens.
 *   2-3  Builds only: All builds (the landing), then each build
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
const MODES = computed(() => [
  { value: 'create' as Mode, label: 'Create', icon: Palette },
  { value: 'build' as Mode, label: 'Build', icon: Code },
  ...(can.value.agent ? [{ value: 'agent' as Mode, label: 'Agent', icon: Sparkles }] : [])
])
</script>

<template>
  <div class="proto-shell relative flex size-full min-h-0 flex-1 overflow-hidden bg-app-background">
    <aside
      class="proto-sidebar relative z-5 m-2 mr-0 flex w-59 shrink-0 flex-col overflow-y-auto p-2 [--glyph-ring:var(--color-app-background)] [scrollbar-width:none]"
    >
      <!-- Create / Build (Milestone 6: the Builder) -->
      <div v-if="can.builder" class="mb-3 flex h-8.5 shrink-0 items-center">
        <ModeSwitch v-model="mode" :options="MODES" />
      </div>

      <AgentNav v-if="proto.mode === 'agent'" />
      <ModeNav v-else-if="can.home || proto.mode === 'build'" :mode="proto.mode" />
      <!-- The builds (or projects). New users have none yet (Home walks them
           through). -->
      <SidebarGroup v-if="proto.mode === 'create' && !proto.fresh" />
      <SpacesGroup v-if="proto.mode === 'create' && can.spaces && !proto.fresh" />

      <div class="mt-auto flex flex-col gap-2 pt-3"><WorkspaceMenu /></div>
    </aside>

    <main
      class="proto-main relative min-w-0 flex-1 overflow-y-auto [scrollbar-color:rgb(255_255_255/0.12)_transparent] [scrollbar-width:thin]"
    >
      <ModePages />
    </main>

    <DetailSheet />
    <LaunchOverlay />
    <LoginPrompt />
    <DeployDialog />
    <DeployToolDialog />
    <NewSpaceFlow v-if="can.spaces" />
    <template v-if="can.agent"><PublishDialog /><ShareDialog /></template>
  </div>
</template>
