<script setup lang="ts">
import { computed, ref, watch, type Component, type Ref } from 'vue'
import {
  Box,
  Check,
  ChevronDown,
  Cloud,
  Clock,
  Cpu,
  GraduationCap,
  Image,
  ListFilter,
  PanelsTopLeft,
  Play,
  Video,
  UserRound
} from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import { useEventListener } from '@vueuse/core'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../../ui/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../../ui/DropdownMenuSeparator.vue'
import DropdownMenuSubTrigger from '../../ui/DropdownMenuSubTrigger.vue'
import {
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent as DropdownMenuSubContentRaw
} from 'reka-ui'
import { floatingSurface } from '../../ui/menu.styles'
import { PORTAL_TO } from '../../ui/portal'
import { cn } from '../../ui/cn'
import { fieldVariants } from '../../ui/field.variants'
import Select from '../../ui/Select.vue'
import { ROUTER_MODELS, TUTORIALS, thumb } from '../../mock'
import { exploreStart } from './exploreStart'
import { HUB_USE_CASES, HUB_WORKFLOWS, hubLine, hubThumb, type HubWorkflow } from './hubWorkflows'
import { EXPLORE, STARTER_APPS, libApp, openAppPage } from '../../appFlow'
import { APP_EXAMPLES, openOn, type AppExample } from '../apps/appExamples'
import { goIn, openDetail, toast } from '../../useProto'
import { can } from '../../milestones'
import { ComfyModel, ComfyWorkflow } from '../icons/comfyIcons'
import MarPage from '../pages/MarPage.vue'
import MarAppsPage from '../pages/MarAppsPage.vue'
import MarSeg from '../pages/MarSeg.vue'
import ExampleTile from '../apps/ExampleTile.vue'
import StarsGlyph from '../apps/StarsGlyph.vue'
import MarSearchField from '../pages/MarSearchField.vue'
import AssetLayoutMenu, { type AssetView } from '../assets/AssetLayoutMenu.vue'

/**
 * Explore. One line holds everything that narrows the page: what you're
 * looking at (Apps, Templates, Models, Tutorials), its type, and a search,
 * so there is one kind of tab, not two. It leads with apps, one catalogue
 * anyone can run, filtered like the hub's: Filter by use case, Sort, search,
 * the picked ones on the menu's rows. From Explore & Learn on,
 * the rest follow as tabs. An app opens in
 * its own tab, as its user. The frame (title, toolbar, Loading, Error,
 * Nothing matches) is MarPage; the catalogue is never empty.
 */
/** At Milestone 2 this is the Apps page: Examples (everything the apps
 *  have made, whatever app made it) and Apps (the apps themselves). */
/** From Explore & Learn on, Apps also keeps the library of your own: a
 *  third tab, My apps. */
const { asApps = false, library = false } = defineProps<{ asApps?: boolean; library?: boolean }>()
type Tab = 'examples' | 'apps' | 'mine' | 'templates' | 'models' | 'tutorials'
const tab = ref<Tab>(asApps ? 'examples' : (exploreStart.value ?? 'apps'))
exploreStart.value = null
const type = ref('all')
const query = ref('')

const APPS_COUNT = STARTER_APPS.length + EXPLORE.flatMap((s) => s.apps).length
const TABS: { value: Tab; label: string; count: number; icon?: Component }[] = asApps
  ? [
      { value: 'examples', label: 'Inspiration', count: APP_EXAMPLES.length, icon: StarsGlyph },
      { value: 'apps', label: 'All apps', count: APPS_COUNT, icon: PanelsTopLeft },
      ...(library ? [{ value: 'mine' as const, label: 'My apps', count: 0, icon: UserRound }] : [])
    ]
  : [
      {
        value: 'apps',
        label: 'Apps',
        count: STARTER_APPS.length + EXPLORE.flatMap((s) => s.apps).length,
        icon: PanelsTopLeft
      },
      // Icons on every tab, like Apps' own row.
      { value: 'templates', label: 'Workflows', count: HUB_WORKFLOWS.length, icon: ComfyWorkflow },
      // Models and Tutorials come with Learn (Milestone 3 is the Hub's apps
      // and templates only).
      ...(can.value.learn
        ? [
            {
              value: 'models' as const,
              label: 'Models',
              count: ROUTER_MODELS.length,
              icon: ComfyModel
            },
            {
              value: 'tutorials' as const,
              label: 'Tutorials',
              count: TUTORIALS.length,
              icon: GraduationCap
            }
          ]
        : [])
    ]
// Examples narrow by the app that made them.
const appName = (id: string): string => libApp(id)?.name ?? ''
const TYPES: Record<Tab, { value: string; label: string }[]> = {
  templates: [],
  models: [
    { value: 'all', label: 'All types' },
    { value: 'image', label: 'Image' },
    { value: 'video', label: 'Video' }
  ],
  apps: [],
  mine: [],
  examples: [],
  tutorials: [
    { value: 'all', label: 'All topics' },
    { value: 'Basics', label: 'Basics' },
    { value: 'VFX', label: 'VFX' },
    { value: 'Animations', label: 'Animations' },
    { value: 'Ads', label: 'Ads' }
  ]
}
watch(tab, clearFilters)
const PLACEHOLDER: Record<Exclude<Tab, 'mine'>, string> = {
  templates: 'Search workflows',
  models: 'Search models or providers',
  apps: 'Search apps',
  examples: 'Search',
  tutorials: 'Search tutorials'
}

const has = (s: string): boolean => s.toLowerCase().includes(query.value.trim().toLowerCase())
// Workflows: the Hub's catalog (hubWorkflows.ts). Filter by use case
// (first, the catalog's own groups), model family and where it runs;
// Sort by use or date; search reads the name and the description.
const useCases = ref<string[]>([])
const families = ref<string[]>([])
const runsOn = ref<string[]>([])
const wfSort = ref('popular')
const WF_SORTS = [
  { value: 'popular', label: 'Popular' },
  { value: 'newest', label: 'Newest' },
  { value: 'az', label: 'Name A to Z' }
]
const RUNS = [
  { value: 'local', label: 'This computer', icon: Cpu },
  { value: 'cloud', label: 'Comfy Cloud', icon: Cloud }
]
const runsHere = (w: HubWorkflow, v: string): boolean =>
  v === 'local' ? w.runs !== 'cloud' : w.runs !== 'local'
const wfSearched = computed(() =>
  HUB_WORKFLOWS.filter((w) => has(`${w.title} ${w.description} ${w.family} ${w.useCase}`))
)
type Facet = 'use' | 'model' | 'runs'
/** Passes every picked filter but `skip`'s, so each menu row counts what
 *  picking it would show. */
const wfPasses = (w: HubWorkflow, skip?: Facet): boolean =>
  (skip === 'use' || !useCases.value.length || useCases.value.includes(w.useCase)) &&
  (skip === 'model' || !families.value.length || families.value.includes(w.family)) &&
  (skip === 'runs' || !runsOn.value.length || runsOn.value.some((v) => runsHere(w, v)))
const templates = computed(() => {
  const list = wfSearched.value.filter((w) => wfPasses(w))
  if (wfSort.value === 'az') return [...list].sort((a, b) => a.title.localeCompare(b.title))
  if (wfSort.value === 'newest') return [...list].sort((a, b) => b.date.localeCompare(a.date))
  return [...list].sort((a, b) => b.usage - a.usage)
})
const facet = (skip: Facet): HubWorkflow[] => wfSearched.value.filter((w) => wfPasses(w, skip))
// Every family in the catalog, the biggest first.
const FAMILIES = [...new Set(HUB_WORKFLOWS.map((w) => w.family))].sort(
  (a, b) =>
    HUB_WORKFLOWS.filter((w) => w.family === b).length -
      HUB_WORKFLOWS.filter((w) => w.family === a).length || a.localeCompare(b)
)
const models = computed(() =>
  ROUTER_MODELS.filter(
    (m) => type.value === 'all' || m.kind.toLowerCase().includes(type.value)
  ).filter((m) => has(`${m.model} ${m.provider}`))
)
// Apps: one catalogue. The ready-to-run ones lead (Recommended); each
// other app carries its use case, which is what Filter narrows by.
const uses = ref<string[]>([])
const appSort = ref('popular')
const APP_SORTS = [
  { value: 'popular', label: 'Recommended' },
  { value: 'az', label: 'Name A to Z' }
]
const CATALOG = [
  ...STARTER_APPS.map((a) => ({ app: a, use: '' })),
  ...EXPLORE.flatMap((s) => s.apps.map((a) => ({ app: a, use: s.title })))
]
const searched = computed(() => CATALOG.filter((c) => has(`${c.app.name} ${c.app.blurb} ${c.use}`)))
const USES = computed(() =>
  EXPLORE.map((s) => ({
    value: s.title,
    count: searched.value.filter((c) => c.use === s.title).length
  }))
)
// MVP filters, one Filter menu per tab: what it makes (Type), then the
// app that made it (Examples) or its use case (Apps). The gallery has no
// Sort: it keeps its curated order.
const VIDEO_APPS = ['s-reshoot', 's-jutsu', 'x-i2v', 'x-h3', 'x-wan', 'e-video']
const KIND_ICON: Record<string, typeof Image> = { Image, Video, '3D': Box }
const appKind = (id: string): string =>
  VIDEO_APPS.includes(id) ? 'Video' : id === 'x-3d' ? '3D' : 'Image'
const kinds = ref<string[]>([])
const toggle = (list: string[], v: string, on: boolean): string[] =>
  on ? [...list, v] : list.filter((x) => x !== v)
function clearFilters(): void {
  type.value = 'all'
  query.value = ''
  uses.value = []
  kinds.value = []
  useCases.value = []
  families.value = []
  runsOn.value = []
}
const apps = computed(() => {
  const list = searched.value
    .filter((c) => !uses.value.length || uses.value.includes(c.use))
    .filter((c) => !kinds.value.length || kinds.value.includes(appKind(c.app.id)))
    .map((c) => c.app)
  return appSort.value === 'az' ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : list
})
const searchedExamples = computed(() =>
  APP_EXAMPLES.filter((x) => has(`${x.title} ${appName(x.app)}`))
)
const examples = computed(() =>
  searchedExamples.value.filter((x) => !kinds.value.length || kinds.value.includes(x.kind))
)
// What the Filter menu offers on this tab, with how many each would show.
// Each group is a row with its value (Assets' Layout menu); a lone group
// lists its choices. No chips: the menu's rows and its badge say what's on.
interface FilterItem {
  value: string
  label: string
  count: number
  icon?: Component
}
interface FilterGroup {
  key: string
  title: string
  list: Ref<string[]>
  items: FilterItem[]
  icon?: Component
}
const FILTER = computed<FilterGroup[]>(() => {
  if (tab.value === 'templates') {
    const byUse = facet('use')
    const byModel = facet('model')
    const byRuns = facet('runs')
    return [
      {
        key: 'use',
        title: 'Use case',
        list: useCases,
        items: HUB_USE_CASES.map((u) => ({
          value: u,
          label: u,
          count: byUse.filter((w) => w.useCase === u).length
        }))
      },
      {
        key: 'model',
        title: 'Model',
        icon: Box,
        list: families,
        items: FAMILIES.map((f) => ({
          value: f,
          label: f,
          count: byModel.filter((w) => w.family === f).length
        }))
      },
      {
        key: 'runs',
        title: 'Runs on',
        icon: Cpu,
        list: runsOn,
        items: RUNS.map((r) => ({
          ...r,
          count: byRuns.filter((w) => runsHere(w, r.value)).length
        }))
      }
    ]
  }
  const ex = tab.value === 'examples'
  const kindOf = (k: string): number =>
    ex
      ? searchedExamples.value.filter((x) => x.kind === k).length
      : searched.value.filter((c) => appKind(c.app.id) === k).length
  const type: FilterGroup = {
    key: 'type',
    title: 'Type',
    icon: Image,
    list: kinds,
    items: (ex ? ['Image', 'Video'] : ['Image', 'Video', '3D']).map((k) => ({
      value: k,
      label: k,
      count: kindOf(k),
      icon: KIND_ICON[k]
    }))
  }
  // The Gallery and the Milestone 2 Catalog filter by Type only: an app is
  // found from the search.
  if (ex || asApps) return [type]
  return [
    {
      key: 'use',
      title: 'Use case',
      list: uses,
      items: USES.value.map((u) => ({ value: u.value, label: u.value, count: u.count }))
    },
    type
  ]
})
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'
// ⌘⌫ / Ctrl+Backspace clears every filter, unless you're typing.
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (e.key !== 'Backspace' || !(e.metaKey || e.ctrlKey) || !picked.value.length) return
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  e.preventDefault()
  clearFilters()
})
const isOn = (g: FilterGroup, v: string): boolean => g.list.value.includes(v)
const flip = (g: FilterGroup, v: string): void => {
  g.list.value = toggle(g.list.value, v, !isOn(g, v))
}
/** The tabs with a Filter menu. */
const filtered = computed(() => ['apps', 'examples', 'templates'].includes(tab.value))
// One submenu at a time (UI-RULES › Menus).
const sub = ref('')
const only = (key: string, open: boolean): void => {
  if (open) sub.value = key
  else if (sub.value === key) sub.value = ''
}
/** A row's value: All, the one picked, or the picked ones in a line. */
const valueOf = (g: FilterGroup): string =>
  g.list.value.length
    ? g.items
        .filter((i) => isOn(g, i.value))
        .map((i) => i.label)
        .join(', ')
    : 'All'
const picked = computed(() =>
  FILTER.value.flatMap((g) =>
    g.items.filter((i) => g.list.value.includes(i.value)).map((i) => ({ ...i, group: g }))
  )
)
// Apps and Templates: one grid of cards; Size picks five, four or three
// across.
const cardView = ref<AssetView>('grid')
const cardSize = ref(2)
const COLS = [0, 5, 4, 3]
// Inspiration's Layout: masonry or grid, at one size (no Size here).
const view = ref<AssetView>('masonry')
const size = ref(2)
const TILE = [0, 170, 220, 300]
// The wall's rhythm: each picture at its own shape, so no two rows line up.
const SHAPES = ['4 / 5', '1 / 1', '3 / 4', '4 / 3', '2 / 3', '5 / 4', '3 / 4', '16 / 11']
// An example opens its app on itself, ready to run or change.
function useExample(x: AppExample): void {
  openOn[x.app] = x.id
  openAppPage(x.app)
}
const tutorials = computed(() =>
  TUTORIALS.filter((t) => type.value === 'all' || t.category === type.value).filter((t) =>
    has(`${t.title} ${t.blurb}`)
  )
)
const empty = computed(
  () =>
    ({
      templates: templates.value,
      models: models.value,
      apps: apps.value,
      // My apps handles its own empty and no-match states.
      mine: [1],
      examples: examples.value,
      tutorials: tutorials.value
    })[tab.value].length === 0
)
const tabbed = computed(() => asApps || can.value.explore)
const toolsAt = computed(() => (tabbed.value ? 'toolbar' : 'actions'))
</script>

<template>
  <MarPage
    :title="asApps ? 'Apps' : 'Explore'"
    :no-results="empty"
    :error-title="asApps ? `Can't load Apps` : `Can't load Explore`"
    :error-text="
      can.learn
        ? 'Hub workflows, models and tutorials come from the internet. Your own workflows are still in Workflows.'
        : 'Apps and workflows come from the internet. Check your connection and try again.'
    "
    @clear="clearFilters"
  >
    <!-- One line: what, which kind, search. With no tabs to pick, the
         tools sit beside the title instead of on a line of their own. -->
    <template #[toolsAt]>
      <MarSeg v-if="tabbed" v-model="tab" :options="TABS" :label="asApps ? 'Apps' : 'Explore'" />
      <!-- Switching tabs, the tools that stay slide to their new place and
           the ones that change fade, instead of jumping. -->
      <TransitionGroup
        tag="div"
        name="mar-ex-tool"
        class="relative flex items-center gap-2"
        :class="tabbed && 'ml-auto'"
      >
        <!-- Apps and Examples: one Filter menu; Sort for the apps and
             Layout for the examples, last, in the same place. -->
        <!-- My apps: its own tools (state, sort, search, view), from the library. -->
        <span
          v-if="tab === 'mine'"
          id="mar-ex-lib-tools"
          key="lib"
          class="inline-flex items-center gap-2"
        />
        <span v-if="filtered" key="filter" class="inline-flex">
          <DropdownMenuRoot :modal="false">
            <DropdownMenuTrigger
              :class="
                cn(
                  fieldVariants(),
                  'w-auto cursor-pointer gap-2 pr-2 outline-none focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-focus/30 data-[state=open]:border-border-strong'
                )
              "
            >
              <ListFilter :size="14" class="shrink-0 text-subtle-foreground" />
              <span>Filters</span>
              <span v-if="picked.length" class="mar-ex-badge">{{ picked.length }}</span>
              <ChevronDown :size="13" class="ml-1 shrink-0 text-subtle-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              :class="cn('mar-ex-filter', FILTER.length > 1 ? 'alm w-64' : 'w-60')"
            >
              <!-- A lone group (Type) lists its choices; more than one,
                   each is a row with what's picked on it, as Assets'
                   Layout menu, opening its list beside (one at a time). -->
              <template v-if="FILTER.length === 1">
                <template v-for="g in FILTER" :key="g.key">
                  <DropdownMenuLabel class="mar-ex-filter-label">{{ g.title }}</DropdownMenuLabel>
                  <DropdownMenuItem
                    v-for="i in g.items"
                    :key="i.value"
                    role="menuitemcheckbox"
                    :aria-checked="isOn(g, i.value)"
                    :disabled="!i.count && !isOn(g, i.value)"
                    class="mar-ex-filter-row"
                    @select.prevent="flip(g, i.value)"
                  >
                    <component :is="i.icon" v-if="i.icon" :size="15" />
                    <span class="min-w-0 flex-1 truncate">{{ i.label }}</span>
                    <Check v-if="isOn(g, i.value)" :size="14" class="mar-ex-filter-on" />
                    <span v-else class="text-subtle-foreground tabular-nums">{{ i.count }}</span>
                  </DropdownMenuItem>
                </template>
              </template>
              <template v-else>
                <DropdownMenuSub
                  v-for="g in FILTER"
                  :key="g.key"
                  :open="sub === g.key"
                  @update:open="only(g.key, $event)"
                >
                  <DropdownMenuSubTrigger class="alm-row"
                    ><span class="alm-cap flex-1">{{ g.title }}</span
                    ><span class="alm-val">{{ valueOf(g) }}</span></DropdownMenuSubTrigger
                  >
                  <DropdownMenuPortal :to="PORTAL_TO">
                    <DropdownMenuSubContentRaw
                      :side-offset="8"
                      :align-offset="-4"
                      :class="cn(floatingSurface, 'mar-ex-filter mar-ex-filter-sub w-56')"
                    >
                      <!-- Only what would show something: a long list
                         (Model) stays short as other filters narrow. -->
                      <DropdownMenuItem
                        v-for="i in g.items.filter((x) => x.count || isOn(g, x.value))"
                        :key="i.value"
                        role="menuitemcheckbox"
                        :aria-checked="isOn(g, i.value)"
                        class="mar-ex-filter-row"
                        @select.prevent="flip(g, i.value)"
                      >
                        <component :is="i.icon" v-if="i.icon" :size="15" />
                        <span class="min-w-0 flex-1 truncate">{{ i.label }}</span>
                        <Check v-if="isOn(g, i.value)" :size="14" class="mar-ex-filter-on" />
                        <span v-else class="text-subtle-foreground tabular-nums">{{
                          i.count
                        }}</span>
                      </DropdownMenuItem>
                    </DropdownMenuSubContentRaw>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </template>
              <template v-if="picked.length">
                <DropdownMenuSeparator class="mar-ex-filter-sep" />
                <DropdownMenuItem @select="clearFilters"
                  ><span class="flex-1">Clear filters</span
                  ><kbd class="mar-menu-hint">{{ MOD }}⌫</kbd></DropdownMenuItem
                >
              </template>
            </DropdownMenuContent>
          </DropdownMenuRoot>
        </span>
        <!-- Keyed by tab, so its label follows the tab (All types, All topics). -->
        <span v-else-if="tab !== 'mine'" :key="`type-${tab}`" class="inline-flex">
          <Select v-model="type" :options="TYPES[tab]" class="w-36" />
        </span>
        <span v-if="tab !== 'mine'" key="search" class="inline-flex">
          <MarSearchField
            v-model="query"
            shortcut
            :placeholder="PLACEHOLDER[tab as Exclude<Tab, 'mine'>]"
          />
        </span>
        <!-- Layout, last, as on Assets: Size and Sort by on Apps and
             Templates (one grid, so no layouts to pick). -->
        <span v-if="tab === 'apps' || tab === 'templates'" key="sort" class="inline-flex">
          <AssetLayoutMenu
            v-if="tab === 'apps'"
            v-model:view="cardView"
            v-model:size="cardSize"
            v-model:sort="appSort"
            :sorts="APP_SORTS"
            :views="['grid']"
          />
          <AssetLayoutMenu
            v-else
            v-model:view="cardView"
            v-model:size="cardSize"
            v-model:sort="wfSort"
            :sorts="WF_SORTS"
            :views="['grid']"
          />
        </span>
        <span v-if="tab === 'examples'" key="layout" class="inline-flex">
          <AssetLayoutMenu v-model:view="view" />
        </span>
      </TransitionGroup>
    </template>

    <!-- Examples: what the apps made, as a masonry wall: each picture at
         its own height, its line under it, no card around it (Apps keeps
         the cards). One opens its app on it, like a template. -->
    <div
      v-if="tab === 'examples'"
      :class="cn('mar-ex-wall', view === 'grid' && 'is-grid')"
      :style="{ '--tile': `${TILE[size]}px` }"
    >
      <ExampleTile
        v-for="(x, i) in examples"
        :key="x.id"
        :x="x"
        :app="appName(x.app)"
        :ratio="view === 'grid' ? '1 / 1' : (x.ratio ?? SHAPES[i % SHAPES.length])"
        role="button"
        tabindex="0"
        :aria-label="`Use ${x.title} in ${appName(x.app)}`"
        @click="useExample(x)"
        @keydown.enter="useExample(x)"
        @keydown.space.prevent="useExample(x)"
      />
    </div>

    <!-- Apps: one grid. -->
    <template v-else-if="tab === 'apps'">
      <div class="mar-ex-grid is-apps" :style="{ '--cols': COLS[cardSize] }">
        <div
          v-for="a in apps"
          :key="a.id"
          role="button"
          tabindex="0"
          class="mar-ex-card group"
          :aria-label="`Open ${a.name}`"
          @click="openAppPage(a.id)"
          @keydown.enter="openAppPage(a.id)"
          @keydown.space.prevent="openAppPage(a.id)"
        >
          <span class="mar-ex-media"><img :src="thumb(a.thumbId)" alt="" loading="lazy" /></span>
          <span class="flex min-w-0 items-start gap-1 px-1.5 pt-2.5 pb-1.5 text-left">
            <span class="block min-w-0 flex-1">
              <span class="block truncate text-ui font-medium text-base-foreground">{{
                a.name
              }}</span>
              <span class="block truncate text-ui text-subtle-foreground">{{ a.blurb }}</span>
            </span>
          </span>
        </div>
      </div>
    </template>

    <!-- My apps: the ones you made, live, draft or with changes. -->
    <MarAppsPage v-else-if="tab === 'mine'" embedded toolbar-to="#mar-ex-lib-tools" />

    <!-- Templates (the Hub's workflows): the same card as an app, its name and the
         first line of the catalog's description. -->
    <div
      v-else-if="tab === 'templates'"
      class="mar-ex-grid is-four"
      :style="{ '--cols': COLS[cardSize] }"
    >
      <div
        v-for="t in templates"
        :key="t.id"
        role="button"
        tabindex="0"
        class="mar-ex-card group"
        :aria-label="`Open ${t.title}`"
        @click="openDetail('template', t.id)"
        @keydown.enter="openDetail('template', t.id)"
        @keydown.space.prevent="openDetail('template', t.id)"
      >
        <span class="mar-ex-media"
          ><img :src="hubThumb(t.id) ?? thumb(t.id)" alt="" loading="lazy"
        /></span>
        <span class="flex min-w-0 items-start gap-1 px-1.5 pt-2.5 pb-1.5 text-left">
          <span class="block min-w-0 flex-1">
            <span class="block truncate text-ui font-medium text-base-foreground">{{
              t.title
            }}</span>
            <span class="block truncate text-ui text-subtle-foreground">{{ hubLine(t) }}</span>
          </span>
        </span>
      </div>
    </div>

    <!-- Models: what each costs, from whom. -->
    <div v-else-if="tab === 'models'" class="mar-ex-grid is-models">
      <button
        v-for="m in models"
        :key="m.model"
        type="button"
        class="mar-ex-model"
        @click="goIn('build', 'router')"
      >
        <span class="mar-ex-mark">{{ m.provider.charAt(0) }}</span>
        <span class="flex min-w-0 flex-1 flex-col text-left">
          <span class="truncate text-ui font-medium text-base-foreground">{{ m.model }}</span>
          <span class="truncate text-ui text-subtle-foreground">{{ m.provider }}</span>
        </span>
        <span class="flex flex-col items-end gap-1">
          <span class="mar-tag">{{ m.kind }}</span>
          <span class="text-[12px] text-subtle-foreground tabular-nums">{{ m.price }}</span>
        </span>
      </button>
    </div>

    <!-- Tutorials -->
    <div v-else class="mar-ex-grid">
      <button
        v-for="t in tutorials"
        :key="t.title"
        type="button"
        class="mar-ex-card group"
        @click="toast(`Opening “${t.title}”`)"
      >
        <span class="mar-ex-media"
          ><img :src="thumb(t.thumbId)" alt="" loading="lazy" /><span class="mar-ex-play"
            ><Play :size="13" fill="currentColor"
          /></span>
          <span class="mar-ex-time"><Clock :size="11" />{{ t.minutes }} min</span></span
        >
        <span class="flex flex-col gap-0.5 px-2 pt-2.5 pb-2 text-left">
          <span class="truncate text-ui font-medium text-base-foreground">{{ t.title }}</span>
          <span class="line-clamp-2 text-ui text-subtle-foreground">{{ t.blurb }}</span>
        </span>
      </button>
    </div>
  </MarPage>
</template>

<style scoped>
/* Tab switch: the tools move to their new place; the changing one fades
   (out of the flow, so it doesn't hold its old room while it goes). */
.mar-ex-tool-move,
.mar-ex-tool-enter-active,
.mar-ex-tool-leave-active {
  transition:
    transform 220ms cubic-bezier(0.2, 0, 0, 1),
    opacity 160ms ease;
}
.mar-ex-tool-enter-from,
.mar-ex-tool-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
.mar-ex-tool-leave-active {
  position: absolute;
  right: 0;
}
@media (prefers-reduced-motion: reduce) {
  .mar-ex-tool-move,
  .mar-ex-tool-enter-active,
  .mar-ex-tool-leave-active {
    transition: none;
  }
}
/* Examples: a masonry wall, picture first. */
.mar-ex-wall {
  columns: 6 var(--tile, 220px);
  column-gap: 14px;
}
/* Grid: the same tiles, square, in rows. */
.mar-ex-wall.is-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--tile, 220px), 1fr));
  gap: 14px;
}
.mar-ex-wall.is-grid .mar-ex-tile {
  margin-bottom: 0;
}
/* Filter: icon, name, then the count or a check. */
/* Clear filters sits apart by space, not a line (UI-RULES › No lines). */
:root .mar-ex-filter .mar-ex-filter-sep {
  height: 6px;
  margin: 0;
  background: transparent;
}
:root .mar-ex-filter .mar-ex-filter-on {
  color: var(--color-base-foreground);
}
:root .mar-ex-filter .mar-ex-filter-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.mar-ex-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
.mar-ex-grid.is-models {
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 10px;
}
.mar-ex-grid.is-apps,
.mar-ex-grid.is-four {
  grid-template-columns: repeat(var(--cols, 4), minmax(0, 1fr));
}
/* Narrow windows: three across, so names and lines still read. */
@media (max-width: 1100px) {
  .mar-ex-grid.is-apps,
  .mar-ex-grid.is-four {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
.mar-ex-badge {
  display: inline-flex;
  min-width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.mar-ex-grid.is-apps .mar-ex-media {
  aspect-ratio: 16 / 10;
}
.mar-ex-grid.is-apps .mar-ex-media img {
  border-radius: var(--radius-control);
}
.mar-ex-mark {
  display: inline-flex;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  font-size: 15px;
  font-weight: 600;
}
.mar-ex-media {
  position: relative;
  display: block;
  overflow: hidden;
  border-radius: var(--radius-control);
  aspect-ratio: 16 / 10;
}
.mar-ex-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 500ms ease;
}
.mar-ex-play,
.mar-ex-time {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  background: var(--color-media-overlay);
  backdrop-filter: blur(12px);
  color: rgb(255 255 255 / 0.92);
  font-size: 11px;
}
.mar-ex-play {
  top: 8px;
  left: 8px;
  width: 24px;
  height: 24px;
  justify-content: center;
}
.mar-ex-time {
  right: 8px;
  bottom: 8px;
  padding: 3px 8px;
}
</style>

<style>
/* A long list (Model) scrolls inside its submenu, never off the window.
   Global: the submenu is portaled out of this component. */
.mar-ex-filter-sub {
  max-height: min(360px, var(--reka-dropdown-menu-content-available-height, 360px));
  overflow-y: auto;
  overscroll-behavior: contain;
}
/* Keyboard: a ring on the card, only when the keyboard got there. */
:root .proto-ui.proto-ui.proto-ui :is(.mar-ex-card, .mar-ex-model, .mar-ex-tile):focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}
/* Picked: the row's fill as well as the check, as in Assets' Filters. */
.mar-ex-filter .mar-ex-filter-row[aria-checked='true'] {
  background-color: var(--color-secondary-background);
}
/* Global: cards are buttons, past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mar-ex-card,
:root .proto-ui.proto-ui.proto-ui .mar-ex-model {
  width: auto;
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  backdrop-filter: blur(20px);
  transition: background-color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-ex-card {
  display: flex;
  flex-direction: column;
  padding: 4px;
}
:root .proto-ui.proto-ui.proto-ui .mar-ex-model {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
}
:root .proto-ui.proto-ui.proto-ui :is(.mar-ex-card, .mar-ex-model):hover {
  background: color-mix(in oklch, var(--color-card-background-hover) 80%, transparent);
}
</style>
