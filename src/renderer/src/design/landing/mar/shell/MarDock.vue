<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import {
  Code,
  Compass,
  Folder,
  GraduationCap,
  Home,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  PanelsTopLeft,
  Palette,
  Rocket,
  ScrollText,
  Server
} from 'lucide-vue-next'
import { AgentChat } from '../icons/agentChat'
import { ComfyAssets, ComfyModel, ComfyWorkflow } from '../icons/comfyIcons'
import LocationIcon from '../../ui/LocationIcon.vue'
import {
  go,
  goIn,
  hostActions,
  proto,
  recentInstances,
  workspace as activeWorkspace,
  type Mode,
  type Page
} from '../../useProto'
import { can, landingPage } from '../../milestones'
import { PROJECTS } from '../../mock'
import { SPACES } from '../../spaces'
import { envKind } from '../../parts/env/env'
import { onCloud } from './surface'
import { marTabsOn } from './titleTabs'
import MarModeSeg from '../modes/MarModeSeg.vue'

/**
 * Mar's Ambient dock (Figma "Exploration 17 · Ambient dock"): the sidebar
 * becomes one floating dock at the bottom of the window. Same places as
 * the sidebar, as icons: the pages, the recent builds with their state,
 * projects and spaces in a flyout, the workspace, and the lens switch
 * (Create, Build, Agent) at the end, like Figma's mode switch.
 */
interface Item {
  page: Page
  label: string
  icon: Component
  prefix?: string
}

const CREATE: Item[][] = [
  [
    { page: 'overview', label: 'Home', icon: Home },
    { page: 'explore', label: 'Explore', icon: Compass },
    { page: 'tutorials', label: 'Learn', icon: GraduationCap }
  ],
  [
    { page: 'workflows', label: 'Workflows', icon: ComfyWorkflow },
    { page: 'apps', label: 'Apps', icon: PanelsTopLeft, prefix: 'app:' },
    { page: 'assets', label: 'Assets', icon: ComfyAssets },
    { page: 'environments', label: 'Builds', icon: Server, prefix: 'environment:' }
  ]
]
const BUILD: Item[][] = [
  [
    { page: 'build-overview', label: 'Overview', icon: LayoutDashboard },
    { page: 'deployments', label: 'Deployments', icon: Rocket, prefix: 'deployment:' },
    { page: 'environments', label: 'Builds', icon: Server, prefix: 'environment:' }
  ],
  [
    { page: 'router', label: 'Models', icon: ComfyModel },
    { page: 'logs', label: 'Logs', icon: ScrollText },
    { page: 'keys', label: 'API keys', icon: KeyRound }
  ]
]
const groups = computed(() =>
  proto.mode === 'build' ? BUILD : proto.mode === 'create' ? CREATE : []
)
const isOn = (i: Item): boolean =>
  proto.activeTab === 'home' &&
  (proto.page === i.page || Boolean(i.prefix && proto.page.startsWith(i.prefix)))
function open(i: Item): void {
  flyout.value = false
  go(i.page)
}

// In a browser (Comfy Cloud) only cloud builds can open.
const builds = computed(() =>
  recentInstances.value.filter((i) => !onCloud.value || i.kind === 'cloud').slice(0, 3)
)
const live = (id: string): boolean => {
  const i = builds.value.find((b) => b.id === id)
  return Boolean(i && (i.state === 'running' || envKind(i) === 'managed'))
}

const flyout = ref(false)

const LENSES: { value: Mode; label: string; icon: Component }[] = [
  { value: 'create', label: 'Create', icon: Palette },
  { value: 'build', label: 'Build', icon: Code },
  { value: 'agent', label: 'Agent', icon: AgentChat }
]
function lens(m: Mode): void {
  flyout.value = false
  goIn(m, m === 'build' ? 'build-overview' : m === 'agent' ? 'agent' : landingPage())
}
</script>

<template>
  <!-- The page fades out at the window's edge, behind the dock. -->
  <div class="mar-dock-fade" aria-hidden="true" />
  <div class="mar-dock-wrap" @keydown.escape="flyout = false">
    <!-- Projects and spaces, above the dock. -->
    <div v-if="flyout" class="mar-flyout" role="dialog" aria-label="Projects and spaces">
      <div class="flex flex-col gap-0.5">
        <span class="mar-flyout-head">Projects · {{ PROJECTS.length }}</span>
        <button type="button" class="mar-flyout-row" @click="(go('projects'), (flyout = false))">
          All projects
        </button>
        <button
          v-for="p in PROJECTS"
          :key="p.id"
          type="button"
          class="mar-flyout-row"
          @click="(go(`project:${p.id}` as Page), (flyout = false))"
        >
          {{ p.name }}
        </button>
      </div>
      <div v-if="can.spaces" class="flex flex-col gap-0.5">
        <span class="mar-flyout-head">Spaces · {{ SPACES.length }}</span>
        <button type="button" class="mar-flyout-row" @click="(go('spaces'), (flyout = false))">
          All spaces
        </button>
        <button
          v-for="s in SPACES"
          :key="s.id"
          type="button"
          class="mar-flyout-row"
          @click="(go(`space:${s.id}` as Page), (flyout = false))"
        >
          {{ s.name
          }}<span v-if="s.status === 'draft'" class="text-subtle-foreground"> · Draft</span>
        </button>
      </div>
    </div>

    <nav class="mar-dock" aria-label="Main">
      <template v-for="(g, gi) in groups" :key="gi">
        <span v-if="gi" class="mar-dock-sep" aria-hidden="true" />
        <button
          v-for="i in g"
          :key="i.label"
          type="button"
          class="mar-dock-btn"
          :class="isOn(i) && 'is-on'"
          :aria-label="i.label"
          :title="i.label"
          :aria-current="isOn(i) ? 'page' : undefined"
          @click="open(i)"
        >
          <component :is="i.icon" :size="18" />
        </button>
      </template>

      <!-- Recent builds: click to open ComfyUI on one. -->
      <template v-if="proto.mode === 'create' && builds.length">
        <span class="mar-dock-sep" aria-hidden="true" />
        <button
          v-for="b in builds"
          :key="b.id"
          type="button"
          class="mar-dock-btn"
          :aria-label="`Open ComfyUI on ${b.name}`"
          :title="b.name"
          @click="hostActions.launch(b)"
        >
          <LocationIcon :kind="b.kind === 'cloud' ? 'cloud' : 'local'" :size="18" />
          <span class="mar-dock-dot" :class="live(b.id) && 'is-live'" />
        </button>
      </template>

      <template v-if="proto.mode === 'create' && can.projects">
        <span class="mar-dock-sep" aria-hidden="true" />
        <button
          type="button"
          class="mar-dock-btn"
          :class="flyout && 'is-on'"
          aria-label="Projects and spaces"
          title="Projects and spaces"
          :aria-expanded="flyout"
          @click="flyout = !flyout"
        >
          <Folder :size="18" /><span class="mar-dock-badge">{{ PROJECTS.length }}</span>
        </button>
        <button
          v-if="can.spaces"
          type="button"
          class="mar-dock-btn"
          aria-label="Spaces"
          title="Spaces"
          @click="(go('spaces'), (flyout = false))"
        >
          <LayoutGrid :size="18" /><span class="mar-dock-badge">{{ SPACES.length }}</span>
        </button>
      </template>

      <span class="mar-dock-sep" aria-hidden="true" />
      <button
        type="button"
        class="mar-dock-btn"
        :aria-label="`${activeWorkspace.name} · usage and billing`"
        :title="activeWorkspace.name"
        @click="go('usage')"
      >
        <span class="mar-dock-avatar">{{ activeWorkspace.name.charAt(0) }}</span>
      </button>

      <!-- Lens switch, like Figma's mode switch. -->
      <MarModeSeg
        v-if="can.builder"
        :model-value="proto.mode"
        :options="LENSES.filter((x) => x.value !== 'agent' || (can.agent && !marTabsOn))"
        :show="marTabsOn ? 'both' : 'icon'"
        size="lg"
        class="ml-1"
        @update:model-value="lens"
      />
    </nav>
  </div>
</template>

<style scoped>
.mar-dock-fade {
  position: fixed;
  inset: auto 0 0;
  z-index: 39;
  height: 112px;
  pointer-events: none;
  background: linear-gradient(to top, var(--color-content-background) 25%, transparent);
}
.mar-dock-wrap {
  position: fixed;
  bottom: 16px;
  left: 50%;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: max-content;
  max-width: calc(100vw - 32px);
  transform: translateX(-50%);
  -webkit-app-region: no-drag;
}
.mar-dock {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border-radius: 20px;
  background: color-mix(in oklch, var(--color-content-background) 72%, transparent);
  backdrop-filter: blur(40px) saturate(1.3);
  box-shadow: 0 20px 60px -20px rgb(0 0 0 / 0.7);
  animation: mar-dock-in 480ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-dock-btn {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  color: var(--color-muted-foreground);
  outline: none;
  transition:
    background-color 160ms ease,
    color 160ms ease,
    transform 240ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-dock-btn:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
  transform: translateY(-2px);
}
.mar-dock-btn:active {
  transform: translateY(0) scale(0.94);
}
.mar-dock-btn:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.mar-dock-btn.is-on {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  color: var(--color-base-foreground);
}
.mar-dock-sep {
  flex-shrink: 0;
  width: 1px;
  height: 24px;
  margin: 0 4px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mar-dock-dot {
  position: absolute;
  bottom: 3px;
  left: 50%;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: var(--color-subtle-foreground);
  transform: translateX(-50%);
}
.mar-dock-dot.is-live {
  background: var(--color-status-running);
}
.mar-dock-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(
    in oklch,
    var(--color-base-foreground) 18%,
    var(--color-content-background)
  );
  color: var(--color-base-foreground);
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
}
.mar-dock-avatar {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
  color: var(--color-base-foreground);
  font-size: 12px;
  font-weight: 600;
}
.mar-flyout {
  display: grid;
  grid-template-columns: repeat(2, minmax(180px, 1fr));
  gap: 16px;
  padding: 14px;
  border-radius: 18px;
  background: color-mix(in oklch, var(--color-content-background) 80%, transparent);
  backdrop-filter: blur(40px) saturate(1.3);
  box-shadow: 0 20px 60px -20px rgb(0 0 0 / 0.7);
  animation: mar-dock-in 260ms cubic-bezier(0.16, 1, 0.3, 1);
  transform-origin: bottom center;
}
.mar-flyout-head {
  padding: 0 8px 6px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.mar-flyout-row {
  border-radius: 8px;
  padding: 6px 8px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  text-align: left;
  transition: background-color 150ms ease;
}
.mar-flyout-row:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
@keyframes mar-dock-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mar-dock,
  .mar-flyout {
    animation: none;
  }
  .mar-dock-btn:hover {
    transform: none;
  }
}
</style>
