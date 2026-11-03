<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Clock, Play } from 'lucide-vue-next'
import Select from '../../ui/Select.vue'
import TemplateCard from '../../parts/TemplateCard.vue'
import { APPS, ROUTER_MODELS, TEMPLATES, TUTORIALS, thumb } from '../../mock'
import { go, toast } from '../../useProto'
import FavoriteStar from '../FavoriteStar.vue'
import MarPage from '../pages/MarPage.vue'
import MarSeg from '../pages/MarSeg.vue'
import MarSearchField from '../pages/MarSearchField.vue'

/**
 * Explore in Mar's proposal. One line holds everything that narrows the
 * page: what you're looking at (Templates, Models, Apps, Tutorials), its
 * type, and a search, so there is one kind of tab, not two. Each tab
 * shows its own things. The frame (title, toolbar, Loading, Error,
 * Nothing matches) is MarPage; the catalogue is never empty.
 */
type Tab = 'templates' | 'models' | 'apps' | 'tutorials'
const tab = ref<Tab>('templates')
const type = ref('all')
const query = ref('')

const TABS: { value: Tab; label: string; count: number }[] = [
  { value: 'templates', label: 'Templates', count: TEMPLATES.length },
  { value: 'models', label: 'Models', count: ROUTER_MODELS.length },
  { value: 'apps', label: 'Apps', count: APPS.length },
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
  apps: [
    { value: 'all', label: 'All apps' },
    { value: 'mine', label: 'Made by you' },
    { value: 'team', label: 'Shared with you' }
  ],
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
const apps = computed(() =>
  APPS.filter((a) => type.value === 'all' || (type.value === 'mine' ? a.you : !a.you)).filter((a) =>
    has(a.name)
  )
)
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
</script>

<template>
  <MarPage
    title="Explore"
    :no-results="empty"
    error-title="Can't load Explore"
    error-text="Templates, models and tutorials come from the internet. Your own workflows are still in Workflows."
    @clear="((type = 'all'), (query = ''))"
  >
    <!-- One line: what, which kind, search. -->
    <template #toolbar>
      <MarSeg v-model="tab" :options="TABS" label="Explore" />
      <div class="ml-auto flex items-center gap-2">
        <Select v-model="type" :options="TYPES[tab]" class="w-36" />
        <MarSearchField v-model="query" :placeholder="PLACEHOLDER[tab]" />
      </div>
    </template>

    <!-- Templates -->
    <div v-if="tab === 'templates'" class="mar-ex-grid">
      <TemplateCard v-for="t in templates" :key="t.id" :t />
    </div>

    <!-- Models: what each costs, from whom. -->
    <div v-else-if="tab === 'models'" class="mar-ex-grid is-models">
      <button
        v-for="m in models"
        :key="m.model"
        type="button"
        class="mar-ex-model"
        @click="go('router')"
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

    <!-- Apps -->
    <div v-else-if="tab === 'apps'" class="mar-ex-grid">
      <button
        v-for="a in apps"
        :key="a.id"
        type="button"
        class="mar-ex-card group"
        @click="go(`app:${a.id}` as never)"
      >
        <span class="mar-ex-media"
          ><img :src="thumb(a.thumbId)" alt="" loading="lazy" /><span class="mar-ex-star"
            ><FavoriteStar :id="a.id" kind="app" /></span
        ></span>
        <span class="flex flex-col gap-0.5 px-2 pt-2.5 pb-2 text-left">
          <span class="truncate text-ui font-medium text-base-foreground">{{ a.name }}</span>
          <span class="truncate text-ui text-subtle-foreground"
            >{{ a.owner }} · {{ a.runs.toLocaleString('en-US') }} runs</span
          >
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
.mar-ex-star {
  position: absolute;
  top: 8px;
  right: 8px;
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
