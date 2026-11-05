<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Clock, Play, Plus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import Select from '../../ui/Select.vue'
import TemplateCard from '../../parts/TemplateCard.vue'
import { ROUTER_MODELS, TEMPLATES, TUTORIALS, thumb } from '../../mock'
import { EXPLORE, STARTER_APPS, isAdded, openAppPage, toggleAdded } from '../../appFlow'
import { go, toast } from '../../useProto'
import { can } from '../../milestones'
import MarPage from '../pages/MarPage.vue'
import MarSeg from '../pages/MarSeg.vue'
import MarSearchField from '../pages/MarSearchField.vue'

/**
 * Explore. One line holds everything that narrows the page: what you're
 * looking at (Apps, Templates, Models, Tutorials), its type, and a search,
 * so there is one kind of tab, not two. It leads with apps, use cases anyone
 * can run; from Explore & Learn on, the rest follow as tabs. An app opens in
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
  apps: [
    { value: 'all', label: 'All apps' },
    ...EXPLORE.map((s) => ({ value: s.title, label: s.title }))
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
// The use cases, each with its apps; a use case with none matching drops out.
const appSections = computed(() =>
  [{ title: 'Start here', hint: 'Ready to run', apps: STARTER_APPS }, ...EXPLORE]
    .filter((s) => type.value === 'all' || s.title === type.value)
    .map((s) => ({ ...s, apps: s.apps.filter((a) => has(`${a.name} ${a.blurb}`)) }))
    .filter((s) => s.apps.length)
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
      apps: appSections.value,
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
      <MarSeg v-if="can.explore" v-model="tab" :options="TABS" label="Explore" />
      <div class="ml-auto flex items-center gap-2">
        <Select v-model="type" :options="TYPES[tab]" class="w-36" />
        <MarSearchField v-model="query" :placeholder="PLACEHOLDER[tab]" />
      </div>
    </template>

    <!-- Apps: use cases, each with its apps. -->
    <template v-if="tab === 'apps'">
      <section v-for="s in appSections" :key="s.title" class="mb-10">
        <SectionHeader :title="s.title">
          <template #controls>
            <span class="text-ui text-subtle-foreground">{{ s.hint }}</span>
          </template>
        </SectionHeader>
        <div class="mar-ex-grid is-apps">
          <div
            v-for="a in s.apps"
            :key="a.id"
            role="button"
            tabindex="0"
            class="mar-ex-card group"
            :aria-label="`Open ${a.name}`"
            @click="openAppPage(a.id)"
            @keydown.enter="openAppPage(a.id)"
          >
            <span class="mar-ex-media"
              ><img :src="thumb(a.thumbId)" alt="" loading="lazy" />
              <!-- No library yet at Explore apps, so nothing to add to. -->
              <span v-if="can.explore" class="mar-ex-star">
                <Button
                  variant="overlay"
                  size="sm"
                  :aria-pressed="isAdded(a.id)"
                  :aria-label="`${isAdded(a.id) ? 'Remove' : 'Add'} ${a.name} ${isAdded(a.id) ? 'from' : 'to'} my apps`"
                  @click.stop="toggleAdded(a)"
                  @keydown.enter.stop
                >
                  <Check v-if="isAdded(a.id)" :size="12" /><Plus v-else :size="12" />{{
                    isAdded(a.id) ? 'Added' : 'Add'
                  }}
                </Button>
              </span></span
            >
            <span class="block min-w-0 px-1.5 pt-2.5 pb-1.5 text-left">
              <span class="block truncate text-ui font-medium text-base-foreground">{{
                a.name
              }}</span>
              <span class="block truncate text-ui text-subtle-foreground">{{ a.blurb }}</span>
            </span>
          </div>
        </div>
      </section>
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
