<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { SearchX } from 'lucide-vue-next'
import { useIntersectionObserver, useResizeObserver } from '@vueuse/core'
import Select from '../../ui/Select.vue'
import MarSeg from '../pages/MarSeg.vue'
import MarSearchField from '../pages/MarSearchField.vue'
import MarEmpty from '../pages/MarEmpty.vue'
import HomeFeedTile from './HomeFeedTile.vue'
import { feedCatalog, type FeedItem, type FeedKind } from './homeFeed'
import { can } from '../../milestones'

type Sort = 'for-you' | 'popular' | 'newest'

const KINDS = computed<{ value: FeedKind; label: string }[]>(() =>
  [
    { value: 'apps' as const, label: 'Apps' },
    { value: 'workflows' as const, label: 'Workflows' }
  ].filter((k) => k.value === 'apps' || can.value.explore)
)
const SORTS: { value: Sort; label: string }[] = [
  { value: 'for-you', label: 'For you' },
  { value: 'popular', label: 'Most used' },
  { value: 'newest', label: 'Newest' }
]
const PAGE_MAX = 12
const DEFAULT_RATIO = 4 / 5
const TITLE_ROOM = 0.22

const kind = ref<FeedKind>('apps')
const sort = ref<Sort>('for-you')
const query = ref('')
const pages = ref(2)

function seeded(list: FeedItem[], seed: number): FeedItem[] {
  let s = seed * 9301 + 49297
  const rand = (): number => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

function sorted(list: FeedItem[], page: number): FeedItem[] {
  if (sort.value === 'popular') return [...list].sort((a, b) => (b.usage ?? 0) - (a.usage ?? 0))
  if (sort.value === 'newest')
    return [...list].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  return seeded(list, page + 1)
}

const q = computed(() => query.value.trim().toLowerCase())
const catalog = computed(() =>
  feedCatalog(kind.value).filter((x) => `${x.title} ${x.line}`.toLowerCase().includes(q.value))
)
const endless = computed(() => !q.value)
const items = computed(() =>
  Array.from({ length: endless.value ? pages.value : 1 }, (_, p) =>
    sorted(catalog.value, p).map((x) => ({ ...x, key: `${x.id}~${p}` }))
  ).flat()
)

const ratios = reactive(new Map<string, number>())
function learn(src?: string): void {
  if (!src || ratios.has(src)) return
  ratios.set(src, DEFAULT_RATIO)
  const img = new Image()
  img.onload = () => {
    if (img.naturalWidth && img.naturalHeight)
      ratios.set(src, Math.min(1.8, Math.max(0.6, img.naturalWidth / img.naturalHeight)))
  }
  img.src = src
}
watch(catalog, (list) => list.forEach((x) => learn(x.src)), { immediate: true })
const ratioOf = (x: FeedItem): number =>
  x.ratio ?? (x.src ? (ratios.get(x.src) ?? DEFAULT_RATIO) : 16 / 9)

const grid = ref<HTMLElement>()
const width = ref(0)
useResizeObserver(grid, ([e]) => (width.value = e?.contentRect.width ?? 0))
const columnCount = computed(() => (width.value >= 960 ? 4 : width.value >= 560 ? 3 : 2))
const columns = computed(() => {
  const cols = Array.from({ length: columnCount.value }, () => ({
    h: 0,
    list: [] as (FeedItem & { key: string })[]
  }))
  for (const x of items.value) {
    const col = cols.reduce((a, b) => (b.h < a.h ? b : a))
    col.list.push(x)
    col.h += 1 / ratioOf(x) + TITLE_ROOM
  }
  return cols.map((c) => c.list)
})

const more = ref<HTMLElement>()
useIntersectionObserver(
  more,
  ([e]) => {
    if (e?.isIntersecting && endless.value && pages.value < PAGE_MAX) pages.value++
  },
  { rootMargin: '0px 0px 800px 0px' }
)
watch([kind, sort], () => (pages.value = 2))
</script>

<template>
  <section class="hvm" data-home-tour="apps-carousel">
    <div class="hvm-bar">
      <MarSeg v-model="kind" :options="KINDS" label="Show" />
      <div class="hvm-tools">
        <MarSearchField v-model="query" placeholder="Search apps and workflows" />
        <Select v-model="sort" :options="SORTS" class="w-36" />
      </div>
    </div>
    <MarEmpty
      v-if="!items.length"
      compact
      :icon="SearchX"
      title="Nothing matches"
      :text="`No ${kind === 'apps' ? 'apps' : 'workflows'} match “${query}”.`"
      action="Clear search"
      @action="query = ''"
    />
    <div ref="grid" class="hvm-grid">
      <div v-for="(col, c) in columns" :key="c" class="hvm-col">
        <HomeFeedTile
          v-for="x in col"
          :key="x.key"
          :item="x"
          :ratio="`${ratioOf(x)}`"
          @open="x.open()"
        />
      </div>
    </div>
    <div v-if="endless && pages < PAGE_MAX" ref="more" class="hvm-more" aria-hidden="true" />
  </section>
</template>

<style>
.hvm-bar {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.hvm-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}
.hvm-grid {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.hvm-col {
  display: flex;
  min-width: 0;
  flex: 1 1 0;
  flex-direction: column;
  gap: 10px;
}
.hvm-more {
  height: 1px;
}
</style>
