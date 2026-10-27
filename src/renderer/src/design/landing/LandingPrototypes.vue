<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { TooltipProvider } from 'reka-ui'
import DevBar from './DevBar.vue'
import DesktopTitleBar from './parts/DesktopTitleBar.vue'
import ComfyTab from './parts/ComfyTab.vue'
import SwitcherMenu from './parts/nav/SwitcherMenu.vue'
import Toaster from './ui/Toaster.vue'
import VariantModes from './variants/VariantModes.vue'
import ClassicDashboard from './parts/milestones/ClassicDashboard.vue'
import ClientPortal from './portal/ClientPortal.vue'
import ViewToggle from './parts/space/ViewToggle.vue'
import AppTab from './parts/apps/AppTab.vue'
import { appsProto } from './appFlow'
import { hostActions, proto, toast } from './useProto'
import { can } from './milestones'
import { connectAccount, realAccount, realSignIn } from './account'
import { connectTitleBar } from './titleBar'
import { connectBuildTabs, openInNewWindow } from './buildTabs'
import { useAuthStore } from '../../stores/authStore'
import type { ProtoInstance } from './mock'
import type { Installation } from '../../types/ipc'

/**
 * Design-prototype host for the landing page: Desktop as it looks at each
 * milestone of the roadmap (milestones.ts), plus the prototype controls.
 * Milestone 0 in the app is the shipping chooser itself (the default slot,
 * which unit tests also drive). In-app, "Data: Mine" maps real installs in;
 * launching follows the milestone (launchBuild).
 */
const props = withDefaults(
  defineProps<{
    standalone?: boolean
    installations?: Installation[]
    isRunning?: (id: string) => boolean
  }>(),
  { standalone: false, installations: () => [], isRunning: () => false }
)

const emit = defineEmits<{
  pick: [installation: Installation]
  'show-new-install': []
  'fetch-installations': []
}>()

// Studio admins on a space (or previewing it) can flip admin/client view.
const toggleSpace = computed(() => {
  if (!can.value.spaces) return ''
  if (proto.viewAs === 'client') return proto.previewing ? proto.spaceId : ''
  return proto.page.startsWith('space:') ? proto.page.slice(6) : ''
})

// Unit tests drive the shipping chooser; in the app it is Milestone 0.
const showToday = computed(
  () => import.meta.env.MODE === 'test' || (!props.standalone && proto.milestone === 0)
)

/**
 * Launching a build, by milestone:
 *   1-2  today's behaviour: the dashboard window becomes the build
 *   3-6  the build opens in its own window; the dashboard stays
 *   7    it opens here, in the same window (buildTabs)
 */
const openHere = hostActions.launch
hostActions.launch = (inst, what) => {
  if (can.value.oneWindow) return openHere(inst, what)
  if (proto.live && inst.source) {
    if (can.value.breadcrumb) return void openInNewWindow(inst.id)
    return emit('pick', inst.source as Installation)
  }
  toast(can.value.breadcrumb ? `${inst.name} opens in its own window` : `${inst.name} opens`)
}

function relative(ms?: number): string {
  if (!ms) return 'Never used'
  const mins = Math.round((Date.now() - ms) / 60000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

function toProto(inst: Installation): ProtoInstance {
  const cloud = inst.sourceCategory === 'cloud'
  const running = props.isRunning(inst.id)
  let hue = 0
  for (const c of inst.id) hue = (hue * 31 + c.charCodeAt(0)) % 360
  return {
    id: inst.id,
    name: inst.name,
    kind: cloud ? 'cloud' : 'local',
    channel: inst.sourceLabel,
    version: inst.version,
    state: running ? 'running' : inst.statusTag?.style === 'update' ? 'update' : 'stopped',
    lastUsed: running ? 'Running now' : relative(inst.lastLaunchedAt),
    lastUsedRank: running ? -1 : -(inst.lastLaunchedAt ?? 0),
    workspace: 'personal',
    hue: cloud ? 210 : hue,
    source: inst
  }
}

// Which ones run is part of the mapping (a build's state in the switcher).
watch(
  () =>
    [
      props.installations,
      proto.live,
      props.installations.map((i) => props.isRunning(i.id))
    ] as const,
  ([list]) => (proto.liveInstances = list.map(toProto)),
  { immediate: true, deep: true }
)

onMounted(() => {
  if (props.standalone) return
  // Inside the app: the real account, and your real data by default (once;
  // the Prototype panel's "Data" switch can still flip to the mock).
  connectAccount(useAuthStore())
  connectTitleBar()
  connectBuildTabs()
  if (localStorage.getItem('comfy.design.landing.realByDefault') !== '1') {
    localStorage.setItem('comfy.design.landing.realByDefault', '1')
    proto.live = true
  }
  const mockSignIn = hostActions.signIn
  hostActions.signIn = () => (realAccount.value ? void realSignIn() : mockSignIn())
  const mockNew = hostActions.newInstance
  hostActions.newInstance = () => (proto.live ? emit('show-new-install') : mockNew())
})

watch(
  () => proto.live,
  (live) => {
    if (live && !props.standalone) {
      emit('fetch-installations')
      toast('Showing your real builds')
    }
  },
  { immediate: true }
)
</script>

<template>
  <!-- Milestone 0: Desktop as it ships today. -->
  <slot v-if="showToday" />
  <!-- `.proto-ui` scopes the prototype's reset. Overlays portal to <body>
       and carry the class themselves. -->
  <TooltipProvider v-else :delay-duration="300">
    <div class="proto-ui relative flex h-full min-h-0 flex-1 flex-col">
      <DesktopTitleBar v-if="standalone" />
      <div v-if="proto.milestone === 0" class="m-auto max-w-80 text-center text-muted-foreground">
        Milestone 0 is Desktop as it ships today. Open the prototype in the app to see it.
      </div>
      <ClassicDashboard v-else-if="!can.builds" />
      <!-- An app opened with Open app: its own tab, full screen. -->
      <AppTab
        v-else-if="can.agent && appsProto.front"
        :id="appsProto.front"
        :key="appsProto.front"
      />
      <ComfyTab v-else-if="proto.activeTab !== 'home'" />
      <ClientPortal v-else-if="can.spaces && proto.viewAs === 'client'" />
      <VariantModes v-else />
      <!-- Admin | Client view: one fixed spot (top centre) in both views. -->
      <ViewToggle
        v-if="toggleSpace"
        :space-id="toggleSpace"
        class="fixed top-1.5 left-1/2 z-40 -translate-x-1/2 shadow-popover"
      />
      <!-- The breadcrumb's build switcher, just under the stand-in bar. -->
      <SwitcherMenu v-if="standalone && can.breadcrumb" :top="44" />
      <Toaster />
      <DevBar :in-title-bar="!standalone" />
    </div>
  </TooltipProvider>
</template>
