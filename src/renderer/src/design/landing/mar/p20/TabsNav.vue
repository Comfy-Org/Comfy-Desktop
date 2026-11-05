<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { AppWindow, ChevronDown, Images, Plus, Search, Server, Workflow } from 'lucide-vue-next'
import CreateMenu from '../CreateMenu.vue'
import TabsAccount from './TabsAccount.vue'
import { firstRunKeeps, firstRunLabel, ports } from '../navOptions'
import { go, goIn, proto, toast, type Mode, type Page } from '../../useProto'
import { can, landingPage } from '../../milestones'
import { PROJECTS } from '../../mock'
import { SPACES } from '../../spaces'
import { search } from '../search/search'
import { marTabsOn } from '../shell/titleTabs'
import portraitSeaside from '../assets/portrait-seaside.jpg'
import lakeFog from '../assets/lake-fog.jpg'
import portraitWindow from '../assets/portrait-window.jpg'
import portraitGrass from '../assets/portrait-grass.jpg'
import hillsFog from '../assets/hills-fog.jpg'
import MarModeSeg from '../modes/MarModeSeg.vue'

/**
 * 08 · Paper tabs (Figma 118:1901): no sidebar. One bar under the title
 * bar: the mode switch on the left, the mode's pages as an underlined tab
 * bar, Projects and Spaces as menus, and search on the right. Same places
 * as Mar's sidebar (MarSidebar.vue); only the shape changes.
 */
interface Tab {
  key: string
  label: string
  page?: Page
  /** Also on for pages that start with this (one project, one build). */
  prefix?: string
  menu?: 'projects' | 'spaces' | 'library'
  /** Opens outside the app (Docs). */
  href?: string
}

// Five places, not nine: your own things live under Library.
const CREATE: Tab[] = [
  { key: 'overview', label: 'Home', page: 'overview' },
  { key: 'explore', label: 'Explore', page: 'explore' },
  { key: 'tutorials', label: 'Learn', page: 'tutorials' },
  { key: 'library', label: 'Library', menu: 'library' }
]
const LIBRARY = [
  { id: 'workflows', name: 'Workflows', page: 'workflows' as Page, icon: Workflow },
  { id: 'apps', name: 'Apps', page: 'apps' as Page, icon: AppWindow },
  { id: 'assets', name: 'Assets', page: 'assets' as Page, icon: Images },
  { id: 'environments', name: 'Builds', page: 'environments' as Page, icon: Server }
]
const BUILD: Tab[] = [
  { key: 'build-overview', label: 'Overview', page: 'build-overview' },
  { key: 'deployments', label: 'Deployments', page: 'deployments', prefix: 'deployment:' },
  { key: 'environments', label: 'Builds', page: 'environments', prefix: 'environment:' },
  { key: 'router', label: 'Models', page: 'router' },
  { key: 'logs', label: 'Logs', page: 'logs' },
  { key: 'keys', label: 'API keys', page: 'keys' }
]
const AGENT: Tab[] = [{ key: 'agent', label: 'Chat', page: 'agent' }]

const tabs = computed<Tab[]>(() => {
  // Nav options › Docs: his Build nav ends with Docs (docs.comfy.org).
  if (proto.mode === 'build')
    return [...BUILD, ...(ports.navDocs ? [{ key: 'docs', label: 'Docs', href: 'docs' }] : [])]
      .filter((t) => firstRunKeeps(t.page))
      .map((t) => ({ ...t, label: firstRunLabel(t.page, t.label) }))
  if (proto.mode === 'agent') return AGENT
  return [
    ...CREATE,
    ...(can.value.projects
      ? [{ key: 'projects', label: 'Projects', menu: 'projects' as const }]
      : []),
    ...(can.value.spaces ? [{ key: 'spaces', label: 'Spaces', menu: 'spaces' as const }] : [])
  ]
})

const MODES: { value: Mode; label: string }[] = [
  { value: 'create', label: 'Create' },
  { value: 'build', label: 'Build' },
  { value: 'agent', label: 'Agent' }
]
const modes = computed(() =>
  MODES.filter((m) => m.value !== 'agent' || (can.value.agent && !marTabsOn.value))
)
function pickMode(m: Mode): void {
  menu.value = null
  goIn(m, m === 'build' ? 'build-overview' : m === 'agent' ? 'agent' : landingPage())
}

function isOn(t: Tab): boolean {
  if (proto.activeTab !== 'home') return false
  const p = proto.page
  if (t.menu === 'projects') return p === 'projects' || p.startsWith('project:')
  if (t.menu === 'spaces') return p === 'spaces' || p.startsWith('space:')
  if (t.menu === 'library')
    return ['workflows', 'apps', 'assets', 'environments'].some(
      (k) => p === k || p.startsWith(k === 'environments' ? 'environment:' : `${k.slice(0, -1)}:`)
    )
  return p === t.page || Boolean(t.prefix && p.startsWith(t.prefix))
}

// Projects and Spaces open as menus under their tab.
const ART = [portraitSeaside, lakeFog, portraitWindow, portraitGrass, hillsFog]
const menu = ref<'projects' | 'spaces' | 'library' | null>(null)
const menuItems = computed(() =>
  menu.value === 'library'
    ? {
        all: undefined,
        items: LIBRARY.filter((l) => firstRunKeeps(l.page)).map((l) => ({
          id: l.id,
          name: l.name,
          page: l.page,
          art: undefined as string | undefined,
          color: undefined as string | undefined,
          meta: undefined as string | undefined,
          icon: l.icon
        })),
        add: undefined
      }
    : menu.value === 'projects'
      ? {
          all: { label: 'All projects', page: 'projects' as Page, count: PROJECTS.length },
          items: PROJECTS.map((p, i) => ({
            id: p.id,
            name: p.name,
            page: `project:${p.id}` as Page,
            art: ART[i % ART.length],
            color: undefined as string | undefined,
            meta: undefined as string | undefined,
            icon: undefined
          })),
          add: 'New project'
        }
      : {
          all: { label: 'All spaces', page: 'spaces' as Page, count: SPACES.length },
          items: SPACES.map((s) => ({
            id: s.id,
            name: s.name,
            page: `space:${s.id}` as Page,
            art: undefined as string | undefined,
            color: s.brand.color,
            meta: s.status === 'draft' ? 'Draft' : undefined,
            icon: undefined
          })),
          add: 'New space'
        }
)
function onTab(t: Tab): void {
  if (t.menu) {
    menu.value = menu.value === t.menu ? null : t.menu
    return
  }
  menu.value = null
  if (t.href) toast('Opening docs.comfy.org ↗')
  else if (t.page) go(t.page)
}
function pick(page: Page): void {
  menu.value = null
  go(page)
}
function add(): void {
  if (menu.value === 'spaces') proto.creatingSpace = true
  else toast('New project')
  menu.value = null
}

// Close the menu on a click elsewhere or Escape.
const root = ref<HTMLElement>()
function onDown(e: PointerEvent): void {
  if (menu.value && !root.value?.contains(e.target as Node)) menu.value = null
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') menu.value = null
}

// The underline slides to the picked tab.
const strip = ref<HTMLElement>()
const bar = reactive({ left: 0, width: 0, shown: false })
function place(): void {
  const el = strip.value?.querySelector<HTMLElement>('.p08-tab.is-on')
  if (!el) {
    bar.shown = false
    return
  }
  // Measured against the strip, so it holds when the tabs are centred.
  const r = el.getBoundingClientRect()
  const base = strip.value!.getBoundingClientRect()
  bar.left = r.left - base.left + 10
  bar.width = r.width - 20
  bar.shown = true
}
watch(
  () => [proto.page, proto.mode, proto.activeTab, tabs.value.length],
  () => nextTick(place)
)
onMounted(() => {
  nextTick(place)
  // Inter loads after first paint and changes the tab widths.
  void document.fonts?.ready.then(place)
  window.addEventListener('resize', place)
  document.addEventListener('pointerdown', onDown)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', place)
  document.removeEventListener('pointerdown', onDown)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <header ref="root" class="p08-bar" aria-label="Navigation">
    <MarModeSeg
      v-if="can.builder"
      :model-value="proto.mode"
      :options="modes"
      show="label"
      class="self-center"
      @update:model-value="pickMode"
    />

    <nav ref="strip" class="p08-tabs">
      <div v-for="t in tabs" :key="t.key" class="p08-tab-slot">
        <button
          type="button"
          class="p08-tab"
          :class="[
            isOn(t) && 'is-on',
            t.menu && 'has-menu',
            menu === t.menu && t.menu && 'is-open'
          ]"
          :aria-current="isOn(t) && !t.menu ? 'page' : undefined"
          :aria-haspopup="t.menu ? 'menu' : undefined"
          :aria-expanded="t.menu ? menu === t.menu : undefined"
          @click="onTab(t)"
        >
          {{ t.label }}<ChevronDown v-if="t.menu" :size="13" class="p08-chev" />
        </button>

        <Transition name="p08-pop">
          <div v-if="t.menu && menu === t.menu" class="p08-menu" role="menu" :aria-label="t.label">
            <button
              v-if="menuItems.all"
              type="button"
              role="menuitem"
              class="p08-item"
              @click="pick(menuItems.all.page)"
            >
              <span class="p08-item-icon is-grid" aria-hidden="true" /><span class="p08-name">{{
                menuItems.all.label
              }}</span
              ><span class="p08-meta">{{ menuItems.all.count }}</span>
            </button>
            <span v-if="menuItems.all" class="p08-sep" aria-hidden="true" />
            <button
              v-for="i in menuItems.items"
              :key="i.id"
              type="button"
              role="menuitem"
              class="p08-item"
              :class="proto.page === i.page && 'is-on'"
              @click="pick(i.page)"
            >
              <component :is="i.icon" v-if="i.icon" :size="15" class="p08-icon" />
              <img v-else-if="i.art" :src="i.art" alt="" class="p08-thumb" />
              <span v-else class="p08-orb" :style="{ '--orb': i.color }" />
              <span class="p08-name">{{ i.name }}</span>
              <span v-if="i.meta" class="p08-meta">{{ i.meta }}</span>
            </button>
            <button
              v-if="menuItems.add"
              type="button"
              role="menuitem"
              class="p08-item is-add"
              @click="add"
            >
              <Plus :size="14" /><span class="p08-name">{{ menuItems.add }}</span>
            </button>
          </div>
        </Transition>
      </div>
      <span
        class="p08-underline"
        :class="bar.shown && 'is-shown'"
        :style="{ transform: `translateX(${bar.left}px)`, width: `${bar.width}px` }"
        aria-hidden="true"
      />
    </nav>

    <div class="p08-end">
      <button type="button" class="p08-search" aria-label="Search" @click="search.open = true">
        <Search :size="14" /><span class="p08-search-text">Search</span><kbd>⌘K</kbd>
      </button>
      <CreateMenu v-if="proto.mode === 'create'" />
      <TabsAccount v-if="ports.navAccount" />
    </div>
  </header>
</template>

<style scoped>
.p08-bar {
  position: fixed;
  top: var(--mar-chrome, 0px);
  right: 0;
  left: 0;
  z-index: 40;
  display: flex;
  height: 48px;
  align-items: stretch;
  gap: 20px;
  padding: 0 16px 0 24px;
  background: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  backdrop-filter: blur(28px) saturate(1.2);
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  -webkit-app-region: no-drag;
}
.p08-tabs {
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: stretch;
}
.p08-tab-slot {
  position: relative;
  display: flex;
}
.p08-chev {
  color: var(--color-subtle-foreground);
  transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
.p08-tab.is-open .p08-chev {
  transform: rotate(180deg);
}
.p08-underline {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--color-base-foreground);
  opacity: 0;
  transition:
    transform 260ms cubic-bezier(0.16, 1, 0.3, 1),
    width 260ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 160ms ease;
}
.p08-underline.is-shown {
  opacity: 1;
}
/* Beats the shared menu look (marShell.css): opaque, since the bar
   already blurs what is behind it and a blur can't reach through it. */
.p08-bar .p08-tab-slot > .p08-menu.p08-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 50;
  display: flex;
  width: 240px;
  flex-direction: column;
  gap: 1px;
  padding: 6px;
  border-radius: 16px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, var(--color-card-background));
  backdrop-filter: none;
  box-shadow: 0 20px 60px -20px rgb(0 0 0 / 0.7);
  transform-origin: top left;
}
.p08-sep {
  display: block;
  height: 1px;
  margin: 4px 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.p08-thumb {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 6px;
  object-fit: cover;
}
.p08-orb {
  display: block;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 999px;
  background: radial-gradient(
    circle at 32% 28%,
    color-mix(in oklch, var(--orb) 55%, white),
    var(--orb) 55%,
    color-mix(in oklch, var(--orb) 70%, black)
  );
}
.p08-item-icon.is-grid {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 6px;
  background:
    linear-gradient(var(--color-subtle-foreground), var(--color-subtle-foreground)) 4px 4px / 5px
      5px no-repeat,
    linear-gradient(var(--color-subtle-foreground), var(--color-subtle-foreground)) 11px 4px / 5px
      5px no-repeat,
    linear-gradient(var(--color-subtle-foreground), var(--color-subtle-foreground)) 4px 11px / 5px
      5px no-repeat,
    linear-gradient(var(--color-subtle-foreground), var(--color-subtle-foreground)) 11px 11px / 5px
      5px no-repeat;
  opacity: 0.8;
}
.p08-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.p08-meta {
  flex-shrink: 0;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.p08-pop-enter-active {
  transition:
    opacity 140ms ease,
    transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
.p08-pop-leave-active {
  transition: opacity 100ms ease;
}
.p08-pop-enter-from {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
.p08-pop-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .p08-underline,
  .p08-chev {
    transition: none;
  }
  .p08-pop-enter-from {
    transform: none;
  }
}
</style>

<style>
/* Tabs nav: the tabs sit centred; Create lives in the bar, not floating
   below it; the bar is the page's own colour, separated by a hairline. */
:root[data-mar-nav='tabs'] .mar-top-actions {
  display: none;
}
.p08-bar .p08-tabs {
  justify-content: center;
}
.p08-bar {
  background: color-mix(in oklch, var(--color-content-background) 82%, transparent) !important;
  box-shadow: inset 0 -1px 0 color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
.p08-end {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}
.p08-icon {
  flex-shrink: 0;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .p08-search {
  width: 200px;
  height: 32px;
  gap: 8px;
  padding: 0 10px;
}
</style>

<style>
/* Pablo's reset wipes padding and width on buttons inside .proto-ui. */
:root .proto-ui.proto-ui.proto-ui .p08-tab {
  display: inline-flex;
  width: auto;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  white-space: nowrap;
  transition: color 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui .p08-tab:hover,
:root .proto-ui.proto-ui.proto-ui .p08-tab.is-open {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .p08-tab.is-on {
  color: var(--color-base-foreground);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .p08-item {
  display: flex;
  width: 100%;
  height: 32px;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
  border-radius: 10px;
  color: var(--color-muted-foreground);
  font-size: 13px;
  transition:
    background-color 120ms ease,
    color 120ms ease;
}
:root .proto-ui.proto-ui.proto-ui .p08-item:hover,
:root .proto-ui.proto-ui.proto-ui .p08-item.is-on {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .p08-item.is-add {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .p08-search {
  display: inline-flex;
  width: 220px;
  height: 32px;
  flex-shrink: 1;
  align-self: center;
  align-items: center;
  gap: 8px;
  padding: 0 6px 0 10px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
  transition: background-color 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui .p08-search:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
}
.p08-search-text {
  flex: 1;
  text-align: left;
}
.p08-search kbd {
  padding: 1px 6px;
  border-radius: 6px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  font-family: inherit;
  font-size: 11px;
}
:root .proto-ui.proto-ui.proto-ui :is(.p08-tab, .p08-item, .p08-search):focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -2px;
}

/*
 * 08 · Paper tabs: no sidebar (Pablo's goes too); the page takes the whole
 * width and starts under the title bar and this bar.
 */
:root[data-mar-nav='tabs'][data-mar-ui='on'] .proto-sidebar {
  display: none;
}
:root[data-mar-nav='tabs'][data-mar-ui='on'] .proto-ui.proto-ui.proto-ui .proto-main.proto-main {
  margin: 0;
  border-radius: 0;
  padding-left: 0;
  padding-top: calc(var(--mar-chrome, 0px) + 48px);
}
:root[data-mar-nav='tabs'][data-mar-ui='on'] .proto-ui.proto-ui .mar-top-actions.mar-top-actions {
  top: calc(var(--mar-chrome, 0px) + 48px + 14px);
}
</style>
