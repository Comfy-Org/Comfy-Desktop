<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Clock, ListFilter, Play, Plus, X } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Button from '../../ui/Button.vue'
import DropdownMenuCheckboxItem from '../../ui/DropdownMenuCheckboxItem.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../../ui/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../../ui/DropdownMenuSeparator.vue'
import { cn } from '../../ui/cn'
import { fieldVariants } from '../../ui/field.variants'
import Select from '../../ui/Select.vue'
import Tooltip from '../../ui/Tooltip.vue'
import TemplateCard from '../../parts/TemplateCard.vue'
import { ROUTER_MODELS, TEMPLATES, TUTORIALS, thumb } from '../../mock'
import { EXPLORE, STARTER_APPS, isAdded, openAppPage, toggleAdded } from '../../appFlow'
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
type Tab = 'apps' | 'templates' | 'models' | 'tutorials'
const tab = ref<Tab>('apps')
const type = ref('all')
const query = ref('')

const TABS: { value: Tab; label: string; count: number }[] = [
  {
    value: 'apps',
    label: 'Apps',
    count: STARTER_APPS.length + EXPLORE.flatMap((s) => s.apps).length
  },
  { value: 'templates', label: 'Templates', count: TEMPLATES.length },
  { value: 'models', label: 'Models', count: ROUTER_MODELS.length },
  { value: 'tutorials', label: 'Tutorials', count: TUTORIALS.length }
]
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
  tutorials: [
    { value: 'all', label: 'All topics' },
    { value: 'Basics', label: 'Basics' },
    { value: 'VFX', label: 'VFX' },
    { value: 'Animations', label: 'Animations' },
    { value: 'Ads', label: 'Ads' }
  ]
}
watch(tab, () => {
  type.value = 'all'
  query.value = ''
  uses.value = []
})
const PLACEHOLDER: Record<Tab, string> = {
  templates: 'Search templates',
  models: 'Search models or providers',
  apps: 'Search apps',
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
function pickUse(use: string, on: boolean): void {
  uses.value = on ? [...uses.value, use] : uses.value.filter((u) => u !== use)
}
const apps = computed(() => {
  const list = searched.value
    .filter((c) => !uses.value.length || uses.value.includes(c.use))
    .map((c) => c.app)
  return appSort.value === 'az' ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : list
})
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
      tutorials: tutorials.value
    })[tab.value].length === 0
)
const toolsAt = computed(() => (can.value.explore ? 'toolbar' : 'actions'))
</script>

<template>
  <MarPage
    title="Explore"
    :no-results="empty"
    error-title="Can't load Explore"
    error-text="Templates, models and tutorials come from the internet. Your own workflows are still in Workflows."
    @clear="((type = 'all'), (query = ''), (uses = []))"
  >
    <!-- One line: what, which kind, search. With no tabs to pick, the
         tools sit beside the title instead of on a line of their own. -->
    <template #[toolsAt]>
      <MarSeg v-if="can.explore" v-model="tab" :options="TABS" label="Explore" />
      <div class="flex items-center gap-2" :class="can.explore && 'ml-auto'">
        <!-- Apps: Filter by use case and Sort, as on the hub. -->
        <template v-if="tab === 'apps'">
          <DropdownMenuRoot :modal="false">
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
              <span v-if="uses.length" class="mar-ex-badge">{{ uses.length }}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-60">
              <DropdownMenuLabel>Categories</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                v-for="u in USES"
                :key="u.value"
                :model-value="uses.includes(u.value)"
                @update:model-value="(v: boolean) => pickUse(u.value, v)"
              >
                <span class="flex-1">{{ u.value }}</span>
                <span class="text-subtle-foreground tabular-nums">{{ u.count }}</span>
              </DropdownMenuCheckboxItem>
              <template v-if="uses.length">
                <DropdownMenuSeparator />
                <DropdownMenuItem @select="uses = []">Clear filters</DropdownMenuItem>
              </template>
            </DropdownMenuContent>
          </DropdownMenuRoot>
          <Select v-model="appSort" :options="APP_SORTS" label="Sort" class="w-40" />
        </template>
        <!-- Keyed by tab, so its label follows the tab (All types, All topics). -->
        <Select v-else :key="tab" v-model="type" :options="TYPES[tab]" class="w-36" />
        <MarSearchField v-model="query" :placeholder="PLACEHOLDER[tab]" />
      </div>
    </template>

    <!-- Apps: the use cases picked, as chips; then one grid. -->
    <template v-if="tab === 'apps'">
      <div v-if="uses.length" class="mar-ex-chips">
        <button
          v-for="u in uses"
          :key="u"
          type="button"
          class="mar-ex-chip"
          :aria-label="`Remove ${u}`"
          @click="pickUse(u, false)"
        >
          {{ u }}<X :size="12" />
        </button>
        <button type="button" class="mar-ex-clear" @click="uses = []">Clear</button>
      </div>
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
            <!-- Add to my apps: beside the name, never over the picture,
                 so it reads on any image. No library yet at Explore apps. -->
            <Tooltip v-if="can.explore" :content="isAdded(a.id) ? 'In my apps' : 'Add to my apps'">
              <Button
                variant="ghost"
                size="icon-sm"
                class="mar-ex-add"
                :class="isAdded(a.id) && 'is-added'"
                :aria-pressed="isAdded(a.id)"
                :aria-label="`${isAdded(a.id) ? 'Remove' : 'Add'} ${a.name} ${isAdded(a.id) ? 'from' : 'to'} my apps`"
                @click.stop="toggleAdded(a)"
                @keydown.enter.stop
              >
                <Check v-if="isAdded(a.id)" :size="15" /><Plus v-else :size="15" />
              </Button>
            </Tooltip>
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
/* Add to my apps: quiet until the card is hovered or it is added. */
.mar-ex-add {
  opacity: 0;
  transition: opacity 160ms ease;
}
.mar-ex-card:is(:hover, :focus-within) .mar-ex-add,
.mar-ex-add.is-added {
  opacity: 1;
}
.mar-ex-add.is-added {
  color: var(--color-base-foreground);
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
