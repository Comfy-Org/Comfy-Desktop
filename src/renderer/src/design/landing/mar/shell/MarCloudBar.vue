<script setup lang="ts">
import { computed } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  Lock,
  Plus,
  RotateCw,
  SlidersHorizontal,
  X
} from 'lucide-vue-next'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import { proto } from '../../useProto'
import { tuner } from '../uiTuner'

/**
 * Comfy Cloud in a browser (Surface: Comfy Cloud): only the browser's tab
 * and address bar on top. The tab already says where you are and the dock
 * holds Home and the workspace, so the app adds no bar of its own. A
 * stand-in for the preview only.
 */
const TITLES: Record<string, string> = {
  overview: 'Home',
  explore: 'Explore',
  tutorials: 'Learn',
  workflows: 'Workflows',
  apps: 'Apps',
  assets: 'Assets',
  agent: 'Agent',
  'build-overview': 'Build'
}
const inGraph = computed(() => proto.activeTab !== 'home')
const tab = computed(() => proto.tabs.find((t) => t.id === proto.activeTab))
const title = computed(() =>
  inGraph.value ? (tab.value?.workflow ?? 'Workflow') : (TITLES[proto.page] ?? 'Comfy Cloud')
)
/** Back, the logo and Home all lead home from a workflow, as on the web. */
function home(): void {
  proto.activeTab = 'home'
}
const path = computed(() =>
  inGraph.value
    ? `workflow/${(tab.value?.workflow ?? 'untitled').replace(/\.json$/, '')}`
    : proto.page === 'overview'
      ? 'home'
      : proto.page.replace(':', '/')
)
</script>

<template>
  <div class="mar-cloud-bar" aria-label="Browser (preview)">
    <!-- Browser tabs. -->
    <div class="flex h-10 items-end gap-2 px-3">
      <span class="mb-3 flex gap-2" aria-hidden="true">
        <span class="size-3 rounded-full bg-[#ff5f57]" /><span
          class="size-3 rounded-full bg-[#febc2e]"
        /><span class="size-3 rounded-full bg-[#28c840]" />
      </span>
      <span class="mar-cloud-tab">
        <button type="button" class="mar-cloud-nav" aria-label="Home" @click="home">
          <ComfyCLogo class="size-3.5" />
        </button>
        <span class="truncate">{{ title }} · Comfy Cloud</span>
        <X :size="12" class="ml-auto text-subtle-foreground" />
      </span>
      <Plus :size="14" class="mb-2.5 text-subtle-foreground" />
    </div>
    <!-- Address bar. -->
    <div class="mar-cloud-url">
      <button
        type="button"
        class="mar-cloud-nav"
        :disabled="!inGraph"
        aria-label="Back to Home"
        @click="home"
      >
        <ChevronLeft :size="15" /></button
      ><ChevronRight :size="15" class="opacity-50" /><RotateCw :size="13" />
      <span class="mar-cloud-field"
        ><Lock :size="11" />cloud.comfy.org/<span class="text-base-foreground">{{
          path
        }}</span></span
      >
      <!-- The prototype's controls: the way back to the desktop app. -->
      <button
        type="button"
        class="mar-cloud-tune"
        aria-label="UI Playground"
        title="UI Playground (switch back to Desktop app)"
        @click="tuner.open = !tuner.open"
      >
        <SlidersHorizontal :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.mar-cloud-bar {
  position: fixed;
  inset: 0 0 auto;
  z-index: 45;
  background: var(--color-titlebar-background);
  -webkit-app-region: no-drag;
}
.mar-cloud-tab {
  display: flex;
  width: 240px;
  height: 32px;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 10px 10px 0 0;
  background: color-mix(
    in oklch,
    var(--color-base-foreground) 7%,
    var(--color-titlebar-background)
  );
  color: var(--color-base-foreground);
  font-size: 12px;
}
.mar-cloud-url {
  display: flex;
  height: 38px;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  background: color-mix(
    in oklch,
    var(--color-base-foreground) 7%,
    var(--color-titlebar-background)
  );
  color: var(--color-muted-foreground);
}
.mar-cloud-field {
  display: flex;
  flex: 1;
  height: 26px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.mar-cloud-tune {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--color-muted-foreground);
  transition: background-color 150ms ease;
}
.mar-cloud-tune:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-cloud-nav {
  display: inline-flex;
  width: auto;
  align-items: center;
  padding: 0;
  color: inherit;
}
.mar-cloud-nav:disabled {
  opacity: 0.5;
}
</style>
