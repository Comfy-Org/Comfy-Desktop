<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Box, Check, Clock, Image, ListFilter, Play, Video, X } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../../ui/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../../ui/DropdownMenuSeparator.vue'
import { cn } from '../../ui/cn'
import { fieldVariants } from '../../ui/field.variants'
import Select from '../../ui/Select.vue'
import TemplateCard from '../../parts/TemplateCard.vue'
import { ROUTER_MODELS, TEMPLATES, TUTORIALS, thumb } from '../../mock'
import { EXPLORE, STARTER_APPS, libApp, openAppPage } from '../../appFlow'
import { APP_EXAMPLES, openOn, type AppExample } from '../apps/appExamples'
import { goIn, toast } from '../../useProto'
import { can } from '../../milestones'
import MarPage from '../pages/MarPage.vue'
import MarSeg from '../pages/MarSeg.vue'
import MarSearchField from '../pages/MarSearchField.vue'

/**
 * Explore. One line holds everything that narrows the page: what you're
 * looking at (Apps, Templates, Models, Tutorials), its type, and a search,
 * so there is one kind of tab, not two. It leads with apps, one catalogue
 * anyone can run, filtered like the hub's: Filter by use case, Sort, search,
 * and the chosen use cases as chips under the line. From Explore & Learn on,
 * the rest follow as tabs. An app opens in
 * its own tab, as its user. The frame (title, toolbar, Loading, Error,
 * Nothing matches) is MarPage; the catalogue is never empty.
 */
/** At Milestone 2 this is the Apps page: Examples (everything the apps
 *  have made, whatever app made it) and Apps (the apps themselves). */
const { asApps = false } = defineProps<{ asApps?: boolean }>()
type Tab = 'examples' | 'apps' | 'templates' | 'models' | 'tutorials'
const tab = ref<Tab>(asApps ? 'examples' : 'apps')
const type = ref('all')
const query = ref('')

const APPS_COUNT = STARTER_APPS.length + EXPLORE.flatMap((s) => s.apps).length
const TABS: { value: Tab; label: string; count: number }[] = asApps
  ? [
      { value: 'examples', label: 'Gallery', count: APP_EXAMPLES.length },
      { value: 'apps', label: 'Catalog', count: APPS_COUNT }
    ]
  : [
      {
        value: 'apps',
        label: 'Apps',
        count: STARTER_APPS.length + EXPLORE.flatMap((s) => s.apps).length
      },
      { value: 'templates', label: 'Templates', count: TEMPLATES.length },
      { value: 'models', label: 'Models', count: ROUTER_MODELS.length },
      { value: 'tutorials', label: 'Tutorials', count: TUTORIALS.length }
    ]
// Examples narrow by the app that made them.
const appName = (id: string): string => libApp(id)?.name ?? ''
const EXAMPLE_APPS = [...new Set(APP_EXAMPLES.map((x) => x.app))]
const TYPES: Record<Tab, { value: string; label: string }[]> = {
  templates: [
    { value: 'all', label: 'All types' },
    { value: 'image', label: 'Image' },
    { value: 'video', label: 'Video' },
    { value: '3d', label: '3D' }
  ],
  models: [
    { value: 'all', label: 'All types' },
    { value: 'image', label: 'Image' },
    { value: 'video', label: 'Video' }
  ],
  apps: [],
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
const PLACEHOLDER: Record<Tab, string> = {
  templates: 'Search templates',
  models: 'Search models or providers',
  apps: 'Search',
  examples: 'Search',
  tutorials: 'Search tutorials'
}

const has = (s: string): boolean => s.toLowerCase().includes(query.value.trim().toLowerCase())
const templates = computed(() =>
  TEMPLATES.filter((t) => type.value === 'all' || t.category === type.value).filter((t) =>
    has(t.title)
  )
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
// app that made it (Examples) or its use case (Apps). Picked ones show as
// chips under the line; no Sort, the gallery keeps its curated order.
const VIDEO_APPS = ['s-reshoot', 's-jutsu', 'x-i2v', 'x-h3', 'x-wan', 'e-video']
const KIND_ICON: Record<string, typeof Image> = { Image, Video, '3D': Box }
const appKind = (id: string): string =>
  VIDEO_APPS.includes(id) ? 'Video' : id === 'x-3d' ? '3D' : 'Image'
const kinds = ref<string[]>([])
const fromApps = ref<string[]>([])
const toggle = (list: string[], v: string, on: boolean): string[] =>
  on ? [...list, v] : list.filter((x) => x !== v)
function clearFilters(): void {
  type.value = 'all'
  query.value = ''
  uses.value = []
  kinds.value = []
  fromApps.value = []
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
  searchedExamples.value
    .filter((x) => !kinds.value.length || kinds.value.includes(x.kind))
    .filter((x) => !fromApps.value.length || fromApps.value.includes(x.app))
)
// What the Filter menu offers on this tab, with how many each would show.
const FILTER = computed(() => {
  const ex = tab.value === 'examples'
  const kindOf = (k: string): number =>
    ex
      ? searchedExamples.value.filter((x) => x.kind === k).length
      : searched.value.filter((c) => appKind(c.app.id) === k).length
  return [
    {
      title: 'Type',
      list: kinds,
      items: (ex ? ['Image', 'Video'] : ['Image', 'Video', '3D']).map((k) => ({
        value: k,
        label: k,
        count: kindOf(k),
        icon: KIND_ICON[k],
        thumb: undefined as string | undefined
      }))
    },
    ex
      ? {
          title: 'App',
          list: fromApps,
          items: EXAMPLE_APPS.map((id) => ({
            value: id,
            label: appName(id),
            count: searchedExamples.value.filter((x) => x.app === id).length,
            icon: undefined,
            // Each app by its own picture, the one its card has.
            thumb: libApp(id) ? thumb(libApp(id)!.thumbId) : undefined
          }))
        }
      : {
          title: 'Category',
          list: uses,
          items: USES.value.map((u) => ({
            value: u.value,
            label: u.value,
            count: u.count,
            icon: undefined,
            thumb: undefined as string | undefined
          }))
        }
  ]
})
const picked = computed(() =>
  FILTER.value.flatMap((g) =>
    g.items.filter((i) => g.list.value.includes(i.value)).map((i) => ({ ...i, group: g }))
  )
)
// The wall's rhythm: each picture at its own shape, so no two rows line up.
const SHAPES = ['4 / 5', '1 / 1', '3 / 4', '4 / 3', '2 / 3', '5 / 4', '3 / 4', '16 / 11']
function play(e: MouseEvent, on: boolean): void {
  const v = (e.currentTarget as HTMLElement).querySelector('video')
  if (!v) return
  if (on && !matchMedia('(prefers-reduced-motion: reduce)').matches) void v.play().catch(() => {})
  else {
    v.pause()
    v.currentTime = 0
  }
}
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
    error-text="Templates, models and tutorials come from the internet. Your own workflows are still in Workflows."
    @clear="clearFilters"
  >
    <!-- One line: what, which kind, search. With no tabs to pick, the
         tools sit beside the title instead of on a line of their own. -->
    <template #[toolsAt]>
      <MarSeg v-if="tabbed" v-model="tab" :options="TABS" :label="asApps ? 'Apps' : 'Explore'" />
      <div class="flex items-center gap-2" :class="tabbed && 'ml-auto'">
        <!-- Apps and Examples: one Filter menu (and Sort in Explore). At
             Milestone 2 the few apps need only search; examples filter. -->
        <template v-if="tab === 'apps' || tab === 'examples'">
          <DropdownMenuRoot v-if="!(asApps && tab === 'apps')" :modal="false">
            <DropdownMenuTrigger
              :class="
                cn(
                  fieldVariants(),
                  'w-auto cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-border-focus/30 data-[state=open]:border-border-strong'
                )
              "
            >
              <ListFilter :size="14" class="text-subtle-foreground" />
              Filter
              <span v-if="picked.length" class="mar-ex-badge">{{ picked.length }}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="mar-ex-filter w-60">
              <template v-for="(g, gi) in FILTER" :key="g.title">
                <DropdownMenuSeparator v-if="gi" class="mar-ex-filter-sep" />
                <DropdownMenuLabel class="mar-ex-filter-label">{{ g.title }}</DropdownMenuLabel>
                <!-- Each choice leads with what it is: a type by its icon, an
                     app by its picture; picked, a check on the right. -->
                <DropdownMenuItem
                  v-for="i in g.items"
                  :key="i.value"
                  role="menuitemcheckbox"
                  :aria-checked="g.list.value.includes(i.value)"
                  class="mar-ex-filter-row"
                  @select.prevent="
                    g.list.value = toggle(g.list.value, i.value, !g.list.value.includes(i.value))
                  "
                >
                  <img v-if="i.thumb" :src="i.thumb" alt="" class="mar-ex-filter-thumb" />
                  <component :is="i.icon" v-else-if="i.icon" :size="15" />
                  <span class="min-w-0 flex-1 truncate">{{ i.label }}</span>
                  <Check
                    v-if="g.list.value.includes(i.value)"
                    :size="14"
                    class="mar-ex-filter-on"
                  />
                  <span v-else class="text-subtle-foreground tabular-nums">{{ i.count }}</span>
                </DropdownMenuItem>
              </template>
              <template v-if="picked.length">
                <DropdownMenuSeparator class="mar-ex-filter-sep" />
                <DropdownMenuItem @select="clearFilters">Clear filters</DropdownMenuItem>
              </template>
            </DropdownMenuContent>
          </DropdownMenuRoot>
          <Select
            v-if="tab === 'apps' && !asApps"
            v-model="appSort"
            :options="APP_SORTS"
            label="Sort"
            class="w-40"
          />
        </template>
        <!-- Keyed by tab, so its label follows the tab (All types, All topics). -->
        <Select v-else :key="tab" v-model="type" :options="TYPES[tab]" class="w-36" />
        <MarSearchField v-model="query" :placeholder="PLACEHOLDER[tab]" />
      </div>
    </template>

    <!-- The filters picked, as chips, over Examples and Apps. -->
    <div v-if="picked.length && (tab === 'apps' || tab === 'examples')" class="mar-ex-chips">
      <button
        v-for="c in picked"
        :key="`${c.group.title}-${c.value}`"
        type="button"
        class="mar-ex-chip"
        :aria-label="`Remove ${c.label}`"
        @click="c.group.list.value = toggle(c.group.list.value, c.value, false)"
      >
        {{ c.label }}<X :size="12" />
      </button>
      <button type="button" class="mar-ex-clear" @click="clearFilters">Clear</button>
    </div>
    <!-- Examples: what the apps made, as a masonry wall: each picture at
         its own height, its line under it, no card around it (Apps keeps
         the cards). One opens its app on it, like a template. -->
    <div v-if="tab === 'examples'" class="mar-ex-wall">
      <div
        v-for="(x, i) in examples"
        :key="x.id"
        role="button"
        tabindex="0"
        class="mar-ex-tile group"
        :aria-label="`Use ${x.title} in ${appName(x.app)}`"
        @click="useExample(x)"
        @keydown.enter="useExample(x)"
        @mouseenter="play($event, true)"
        @mouseleave="play($event, false)"
      >
        <span class="mar-ex-tile-media" :style="{ aspectRatio: SHAPES[i % SHAPES.length] }">
          <img :src="x.after" alt="" loading="lazy" />
          <!-- A video plays while the pointer is on it. -->
          <video
            v-if="x.video"
            :src="x.video"
            muted
            loop
            playsinline
            preload="none"
            class="mar-ex-tile-video"
          />
          <span v-if="x.kind === 'Video'" class="mar-ex-tile-kind" aria-label="Video"
            ><Video :size="13" />{{ x.duration }}</span
          >
          <span v-else class="mar-ex-tile-kind is-icon" aria-label="Image"
            ><Image :size="13"
          /></span>
          <!-- What it is and which app made it, over a fade, on hover. -->
          <span class="mar-ex-tile-text">
            <span class="min-w-0 flex-1">
              <span class="block truncate text-ui text-white/70">{{ appName(x.app) }}</span>
              <span class="block truncate text-ui font-medium text-white">{{ x.title }}</span>
            </span>
            <!-- The same Run app as Home's examples. -->
            <span class="mar-ex-tile-go" aria-hidden="true"><Play :size="13" />Run app</span>
          </span>
        </span>
      </div>
    </div>

    <!-- Apps: one grid. -->
    <template v-else-if="tab === 'apps'">
      <div class="mar-ex-grid is-apps">
        <div
          v-for="a in apps"
          :key="a.id"
          role="button"
          tabindex="0"
          class="mar-ex-card group"
          :aria-label="`Open ${a.name}`"
          @click="openAppPage(a.id)"
          @keydown.enter="openAppPage(a.id)"
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

    <!-- Templates -->
    <div v-else-if="tab === 'templates'" class="mar-ex-grid">
      <TemplateCard v-for="t in templates" :key="t.id" :t />
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
/* Examples: a masonry wall, picture first. */
.mar-ex-wall {
  columns: 4 220px;
  column-gap: 14px;
}
.mar-ex-tile {
  display: block;
  margin-bottom: 14px;
  break-inside: avoid;
  cursor: pointer;
  outline: none;
}
.mar-ex-tile-media {
  position: relative;
  display: block;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
}
.mar-ex-tile-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: scale 500ms cubic-bezier(0.19, 1, 0.22, 1);
}
.mar-ex-tile:hover .mar-ex-tile-media img {
  scale: 1.03;
}
.mar-ex-tile:focus-visible .mar-ex-tile-media {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.mar-ex-tile-kind {
  position: absolute;
  z-index: 1;
  top: 10px;
  left: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 11px;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.5);
  backdrop-filter: blur(8px);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.mar-ex-tile-kind.is-icon {
  padding: 7px;
}
.mar-ex-tile-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 250ms ease;
}
.mar-ex-tile:hover .mar-ex-tile-video {
  opacity: 1;
}
.mar-ex-tile-text {
  position: absolute;
  z-index: 1;
  inset: auto 0 0;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 48px 14px 14px;
  background: linear-gradient(to top, rgb(0 0 0 / 0.75), rgb(0 0 0 / 0.4) 55%, transparent);
  opacity: 0;
  transition: opacity 200ms ease;
}
.mar-ex-tile:is(:hover, :focus-visible) .mar-ex-tile-text {
  opacity: 1;
}
.mar-ex-tile-go {
  display: inline-flex;
  height: 30px;
  align-items: center;
  flex: none;
  gap: 6px;
  padding: 0 13px 0 11px;
  border-radius: var(--radius-control);
  background: #fff;
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.06),
    0 8px 20px -6px rgb(0 0 0 / 0.5);
  color: #111;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
}
.mar-ex-tile-go:hover {
  background: rgb(255 255 255 / 0.9);
}
/* Filter: icon or picture, name, then the count or a check. */
.mar-ex-filter-thumb {
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 5px;
  object-fit: cover;
}
:root .mar-ex-filter .mar-ex-filter-on {
  color: var(--color-base-foreground);
}
:root .mar-ex-filter .mar-ex-filter-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
:root .mar-ex-filter .mar-ex-filter-sep {
  margin-inline: -4px;
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
.mar-ex-grid.is-apps {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
/* Narrow windows: three across, so names and lines still read. */
@media (max-width: 1100px) {
  .mar-ex-grid.is-apps {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
.mar-ex-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 16px;
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
/* Global: cards and chips are buttons, past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mar-ex-chip {
  display: inline-flex;
  width: auto;
  height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 10px 0 12px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
  font-size: 12px;
  transition: background-color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-ex-chip:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-ex-clear {
  width: auto;
  padding: 0 6px;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .mar-ex-clear:hover {
  color: var(--color-base-foreground);
}
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
