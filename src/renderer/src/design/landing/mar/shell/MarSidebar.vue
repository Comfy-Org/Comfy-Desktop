<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  BookOpen,
  ChevronsUpDown,
  Circle,
  Code,
  Coins,
  Compass,
  GraduationCap,
  Home,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  PanelsTopLeft,
  MessageSquare,
  Palette,
  Plus,
  Rocket,
  ScrollText,
  Search,
  Server
} from 'lucide-vue-next'
import { AgentChat } from '../icons/agentChat'
import { ComfyAssets, ComfyModel, ComfyWorkflow } from '../icons/comfyIcons'
import {
  go,
  goIn,
  instances,
  openDetail,
  proto,
  toast,
  workspace,
  type Mode,
  type Page
} from '../../useProto'
import { agent, resetAgent } from '../../agent'
import { flow, resetFlow } from '../../appFlow'
import { can, landingPage } from '../../milestones'
import { PROJECTS, TEMPLATES, thumb } from '../../mock'
import { favorites } from '../favorites'
import { creditsShort, creditsStyle, creditsTotal } from '../credits'
import MarWorkspaceMenu from '../MarWorkspaceMenu.vue'
import MarModeSeg from '../modes/MarModeSeg.vue'
import MarCreditsFlyout from '../MarCreditsFlyout.vue'
import RailFlyout from '../p20/RailFlyout.vue'
import { p20 } from '../p20/p20'
import { SPACES } from '../../spaces'
import MarSpacesInvite from '../userStates/MarSpacesInvite.vue'
import { marNav } from './marShell'
import { marTabsOn } from './titleTabs'
import { search } from '../search/search'
import { PROJECT_ART } from '../assets/mock'
import { firstRunKeeps, firstRunLabel, ports } from '../navOptions'
import MarSignIn from './MarSignIn.vue'
import { goModeHome } from '../modes/home'

/**
 * Mar's sidebar (Navigation: Sidebar or Floating): the lens switch and the
 * collapse button on top, the pages, projects with a photo each,
 * spaces, and credits and the workspace at the foot, like Pablo's. Collapses to a rail of icons. Same
 * places as the dock (MarDock.vue); only the shape changes.
 */
interface Item {
  page: Page
  label: string
  icon: Component
  prefix?: string
  count?: number
  /** Opens outside the app (Docs). */
  href?: string
}

const CREATE: { title?: string; items: Item[] }[] = [
  {
    items: [
      { page: 'overview', label: 'Home', icon: Home },
      { page: 'explore', label: 'Explore', icon: Compass },
      { page: 'tutorials', label: 'Learn', icon: GraduationCap }
    ]
  },
  {
    title: 'Libraries',
    items: [
      { page: 'workflows', label: 'Workflows', icon: ComfyWorkflow },
      { page: 'apps', label: 'Apps', icon: PanelsTopLeft, prefix: 'app:' },
      { page: 'assets', label: 'Assets', icon: ComfyAssets },
      {
        page: 'environments',
        label: 'Builds',
        icon: Server,
        prefix: 'environment:'
      }
    ]
  }
]
const BUILD: { title?: string; items: Item[] }[] = [
  {
    items: [
      { page: 'build-overview', label: 'Overview', icon: LayoutDashboard },
      { page: 'deployments', label: 'Deployments', icon: Rocket, prefix: 'deployment:' },
      { page: 'environments', label: 'Builds', icon: Server, prefix: 'environment:' }
    ]
  },
  {
    title: 'API',
    items: [
      { page: 'router', label: 'Models', icon: ComfyModel },
      { page: 'logs', label: 'Logs', icon: ScrollText },
      { page: 'keys', label: 'API keys', icon: KeyRound }
    ]
  }
]
// Nav options › Docs: his Build nav ends with Docs (docs.comfy.org).
const DOCS: Item = { page: 'docs' as Page, label: 'Docs', icon: BookOpen, href: 'docs' }
const withDocs = (gs: typeof BUILD): typeof BUILD =>
  ports.navDocs
    ? gs.map((g, i) => (i === gs.length - 1 ? { ...g, items: [...g.items, DOCS] } : g))
    : gs
const groups = computed(() =>
  (proto.mode === 'build' ? withDocs(BUILD) : proto.mode === 'create' ? CREATE : [])
    .map((g) => ({
      ...g,
      items: g.items
        .filter((i) => firstRunKeeps(i.page))
        .map((i) => ({ ...i, label: firstRunLabel(i.page, i.label) }))
    }))
    .filter((g) => g.items.length)
)
// Builds count what this user has (none, one or several local, plus Cloud).
const countOf = (i: Item): number | undefined =>
  i.page === 'environments' && proto.mode === 'create' ? instances.value.length : i.count
const isOn = (i: Item): boolean =>
  proto.activeTab === 'home' &&
  (proto.page === i.page || Boolean(i.prefix && proto.page.startsWith(i.prefix)))

const favs = computed(() =>
  favorites.ids.map((id) => TEMPLATES.find((t) => t.id === id)).filter((t) => t !== undefined)
)

const ART = PROJECT_ART
const projects = computed(() => PROJECTS.map((p, i) => ({ ...p, art: ART[i % ART.length]! })))

const LENSES: { value: Mode; label: string; icon: Component }[] = [
  { value: 'create', label: 'Create', icon: Palette },
  { value: 'build', label: 'Build', icon: Code },
  { value: 'agent', label: 'Agent', icon: AgentChat }
]
const lenses = computed(() =>
  LENSES.filter((l) => l.value !== 'agent' || (can.value.agent && !marTabsOn.value))
)
function lens(m: Mode): void {
  goIn(m, m === 'build' ? 'build-overview' : m === 'agent' ? 'agent' : landingPage())
}
const open = computed(() => !marNav.collapsed)

// Agent lens: a new chat and the recent ones, as in Pablo's AgentNav.
const currentChat = computed(
  () => (flow.messages.length ? flow.messages : agent.messages).find((m) => m.role === 'user')?.text
)
const RECENT_CHATS = [
  'Seasonal backgrounds for Nike',
  'Coca-Cola shade swatches app',
  'Upscale Porsche renders to 4K'
]
function newChat(): void {
  resetAgent()
  resetFlow()
  go('agent')
}
</script>

<template>
  <aside class="mar-side" :class="!open && 'is-rail'" aria-label="Navigation">
    <!-- Lens switch and collapse, on one line (stacked on the rail). -->
    <div class="mar-side-head" :class="!open && 'is-rail'">
      <MarModeSeg
        v-if="can.builder"
        :model-value="proto.mode"
        :options="lenses"
        :show="open ? 'picked' : 'icon'"
        :vertical="!open"
        @update:model-value="lens"
      />
      <MarCreditsFlyout v-if="open && creditsStyle.id === 'chip'" side="bottom" align="start">
        <button type="button" class="mar-side-chip" :title="`${creditsTotal} credits`">
          <Coins :size="13" />{{ creditsShort }}
        </button>
      </MarCreditsFlyout>
      <button
        type="button"
        class="mar-side-icon"
        :aria-label="open ? 'Collapse sidebar' : 'Expand sidebar'"
        :title="open ? 'Collapse' : 'Expand'"
        @click="marNav.collapsed = !marNav.collapsed"
      >
        <PanelLeftClose v-if="open" :size="15" /><PanelLeftOpen v-else :size="15" />
      </button>
    </div>

    <RailFlyout v-if="!open && p20.rail === 'flyout'" />
    <nav class="mar-side-scroll">
      <!-- Search finds media and workflows: a Create thing, not in Build. -->
      <button
        v-if="proto.mode !== 'build'"
        type="button"
        class="mar-side-row"
        :title="open ? undefined : 'Search · ⌘K'"
        @click="search.open = true"
      >
        <Search :size="16" /><template v-if="open"
          ><span class="flex-1">Search</span><kbd class="mar-side-kbd">⌘K</kbd></template
        >
      </button>
      <template v-for="(g, gi) in groups" :key="gi">
        <div v-if="g.title" class="mar-side-label">
          <span v-if="open">{{ g.title }}</span
          ><span v-else class="mar-side-sep" />
        </div>
        <button
          v-for="i in g.items"
          :key="i.label"
          type="button"
          class="mar-side-row"
          :class="isOn(i) && 'is-on'"
          :aria-current="isOn(i) ? 'page' : undefined"
          :title="open ? undefined : i.label"
          @click="i.href ? toast('Opening docs.comfy.org ↗') : go(i.page)"
        >
          <component :is="i.icon" :size="16" />
          <template v-if="open"
            ><span class="flex-1 truncate">{{ i.label }}</span
            ><span v-if="countOf(i)" class="text-subtle-foreground">{{
              countOf(i)
            }}</span></template
          >
        </button>
      </template>

      <template v-if="proto.mode === 'agent'">
        <button
          type="button"
          class="mar-side-row"
          :title="open ? undefined : 'Home'"
          @click="goModeHome()"
        >
          <Home :size="16" /><span v-if="open" class="flex-1 truncate">Home</span>
        </button>
        <button
          type="button"
          class="mar-side-row"
          :title="open ? undefined : 'New chat'"
          @click="newChat"
        >
          <Plus :size="16" /><span v-if="open" class="flex-1 truncate">New chat</span>
        </button>
        <div class="mar-side-label">
          <span v-if="open">Recent</span><span v-else class="mar-side-sep" />
        </div>
        <button
          v-if="currentChat"
          type="button"
          class="mar-side-row is-on"
          :title="open ? undefined : currentChat"
          @click="go('agent')"
        >
          <MessageSquare :size="16" /><span v-if="open" class="flex-1 truncate">{{
            currentChat
          }}</span>
        </button>
        <button
          v-for="r in RECENT_CHATS"
          :key="r"
          type="button"
          class="mar-side-row"
          :title="open ? undefined : r"
          @click="toast(`Open “${r}”`)"
        >
          <MessageSquare :size="16" /><span v-if="open" class="flex-1 truncate">{{ r }}</span>
        </button>
      </template>

      <!-- Favorites: what you starred, one click away, right under the
           libraries they come from. -->
      <template v-if="proto.mode === 'create' && favs.length">
        <div class="mar-side-label">
          <span v-if="open">Favorites</span><span v-else class="mar-side-sep" />
        </div>
        <button
          v-for="f in favs"
          :key="f.id"
          type="button"
          class="mar-side-row"
          :title="open ? undefined : f.title"
          @click="openDetail('template', f.id)"
        >
          <img :src="thumb(f.id)" alt="" class="mar-side-thumb" /><span
            v-if="open"
            class="truncate"
            >{{ f.title }}</span
          >
        </button>
      </template>

      <template v-if="proto.mode === 'create' && can.projects">
        <div class="mar-side-label">
          <template v-if="open"
            ><span class="flex-1">Projects</span
            ><Plus :size="14" class="text-subtle-foreground" /></template
          ><span v-else class="mar-side-sep" />
        </div>
        <button v-if="open" type="button" class="mar-side-row" @click="go('projects')">
          <LayoutGrid :size="16" /><span class="flex-1">All projects</span
          ><span class="text-subtle-foreground">{{ PROJECTS.length }}</span>
        </button>
        <button
          v-for="p in projects.slice(0, 4)"
          :key="p.id"
          type="button"
          class="mar-side-row"
          :class="proto.page === `project:${p.id}` && 'is-on'"
          :title="open ? undefined : p.name"
          @click="go(`project:${p.id}` as Page)"
        >
          <img :src="p.art" alt="" class="mar-side-thumb" /><span v-if="open" class="truncate">{{
            p.name
          }}</span>
        </button>
      </template>

      <template v-if="proto.mode === 'create' && can.spaces">
        <div class="mar-side-label">
          <template v-if="open"
            ><span class="flex-1">Spaces</span
            ><!-- None yet: the invitation below is the one way to add. --><Plus
              v-if="SPACES.length"
              :size="14"
              class="text-subtle-foreground"
          /></template>
          <span v-else class="mar-side-sep" />
        </div>
        <MarSpacesInvite v-if="open && !SPACES.length" />
        <button v-else-if="open" type="button" class="mar-side-row" @click="go('spaces')">
          <LayoutGrid :size="16" /><span class="flex-1">All spaces</span
          ><span class="text-subtle-foreground">{{ SPACES.length }}</span>
        </button>
        <button
          v-for="s in SPACES"
          :key="s.id"
          type="button"
          class="mar-side-row"
          :class="proto.page === `space:${s.id}` && 'is-on'"
          :title="open ? undefined : s.name"
          @click="go(`space:${s.id}` as Page)"
        >
          <Circle :size="16" /><template v-if="open"
            ><span class="flex-1 truncate">{{ s.name }}</span
            ><span v-if="s.status === 'draft'" class="text-subtle-foreground">Draft</span></template
          >
        </button>
      </template>
    </nav>

    <!-- Signed out with Nav options › Account: no balance to show. -->
    <MarCreditsFlyout
      v-if="
        (proto.signedIn || !ports.navAccount) &&
        (creditsStyle.id === 'row' || (!open && creditsStyle.id !== 'meter'))
      "
    >
      <button type="button" class="mar-side-credits" :title="open ? undefined : 'Credits'">
        <Coins :size="16" /><template v-if="open"
          ><span class="flex-1 text-left">Credits</span><span>{{ creditsTotal }}</span></template
        >
      </button>
    </MarCreditsFlyout>

    <!-- Signed out (Nav options › Account): his Log in card instead. -->
    <MarSignIn v-if="ports.navAccount && !proto.signedIn" :open />
    <!-- Workspace, always last at the foot like Pablo's; credits above it. -->
    <div v-else class="mar-side-foot" :class="open && creditsStyle.id === 'meter' && 'is-meter'">
      <MarCreditsFlyout v-if="open && creditsStyle.id === 'meter'">
        <button type="button" class="mar-side-meter">
          <span class="flex items-center justify-between">
            <span>{{ creditsTotal }} credits</span
            ><span class="text-subtle-foreground">Top up</span>
          </span>
          <span class="mar-side-bar"><span :style="{ width: '62%' }" /></span>
        </button>
      </MarCreditsFlyout>
      <MarWorkspaceMenu :side="open ? 'top' : 'right'">
        <button type="button" class="mar-side-ws" :title="open ? undefined : workspace.name">
          <span class="mar-side-avatar">{{ workspace.name.charAt(0) }}</span>
          <template v-if="open">
            <span class="flex min-w-0 flex-1 flex-col text-left leading-tight">
              <span class="truncate">{{ workspace.name }}</span>
              <span v-if="workspace.plan" class="truncate font-normal text-subtle-foreground">{{
                workspace.plan
              }}</span>
            </span>
            <ChevronsUpDown :size="14" class="text-subtle-foreground" />
          </template>
        </button>
      </MarWorkspaceMenu>
    </div>
  </aside>
</template>

<style scoped>
.mar-side {
  position: fixed;
  top: calc(var(--mar-chrome, 0px) + 8px);
  bottom: 8px;
  left: 8px;
  z-index: 40;
  display: flex;
  width: 260px;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 20px;
  background: color-mix(
    in oklch,
    color-mix(in oklch, var(--color-base-foreground) 4%, var(--color-content-background)) 82%,
    transparent
  );
  backdrop-filter: blur(40px) saturate(1.3);
  box-shadow:
    0 24px 64px -24px rgb(0 0 0 / 0.7),
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  transition: width 320ms cubic-bezier(0.645, 0.045, 0.355, 1);
  -webkit-app-region: no-drag;
}
.mar-side.is-rail {
  width: 64px;
  align-items: center;
  padding: 10px 8px;
}
.mar-side-head {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.mar-side-head.is-rail {
  flex-direction: column-reverse;
  gap: 8px;
}
.mar-side-ws {
  display: flex;
  width: 100%;
  min-width: 0;
  flex: none;
  align-items: center;
  gap: 10px;
  border-radius: 10px;
  padding: 4px;
  font-size: 14px;
  font-weight: 500;
}
.mar-side-ws:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
.mar-side-avatar {
  display: inline-flex;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  color: var(--color-base-foreground);
  font-size: 12px;
  font-weight: 600;
}
.mar-side-icon {
  display: inline-flex;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--color-subtle-foreground);
  opacity: 0.7;
  transition:
    opacity 150ms ease,
    color 150ms ease;
}
.mar-side-well {
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
.mar-side-icon:hover {
  color: var(--color-base-foreground);
  opacity: 1;
}
.mar-side-scroll {
  display: flex;
  min-height: 0;
  width: 100%;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  overflow-y: auto;
  scrollbar-width: none;
}
.is-rail .mar-side-scroll {
  align-items: center;
}
.mar-side-label {
  display: flex;
  align-items: center;
  padding: 14px 10px 6px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.is-rail .mar-side-label {
  padding: 8px 0 4px;
}
.mar-side-sep {
  display: block;
  width: 28px;
  height: 1px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mar-side-row {
  display: flex;
  width: 100%;
  height: 34px;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border-radius: 10px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  text-align: left;
  transition:
    background-color 150ms ease,
    color 150ms ease;
}
.is-rail .mar-side-row {
  width: 40px;
  justify-content: center;
  padding: 0;
}
.mar-side-row:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
}
.mar-side-row.is-on {
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  color: var(--color-base-foreground);
}
.mar-side-foot {
  width: 100%;
  border-radius: 14px;
}
.mar-side-foot.is-meter {
  padding: 4px 4px 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
.mar-side-meter {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 8px;
  padding: 2px 8px 0;
  color: var(--color-base-foreground);
  font-size: 12px;
  text-align: left;
}
.mar-side-bar {
  display: block;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mar-side-bar > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-base-foreground);
}
.mar-side-chip {
  display: inline-flex;
  height: 26px;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  padding: 0 9px;
  border-radius: var(--radius-control);
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.mar-side-kbd {
  border-radius: 5px;
  padding: 1px 5px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-subtle-foreground);
  font-family: inherit;
  font-size: 11px;
}
.mar-side-thumb {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 6px;
  object-fit: cover;
}
.mar-side-credits {
  display: flex;
  width: 100%;
  height: 38px;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border-radius: 12px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
.is-rail .mar-side-credits {
  width: 40px;
  justify-content: center;
  padding: 0;
}
@media (prefers-reduced-motion: reduce) {
  .mar-side {
    transition: none;
  }
}
</style>
