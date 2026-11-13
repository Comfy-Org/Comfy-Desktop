<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { go } from '../../useProto'
import ExampleArc from './ExampleArc.vue'
import ScrollRow from '../../ui/ScrollRow.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import WorkflowCard from '../WorkflowCard.vue'
import MarSeg from '../pages/MarSeg.vue'
import { ARC_APPS, ARC_TEMPLATES, interleave, type ArcItem } from './arcItems'
import { homeArcMix } from './homeArcMix'
import { exploreStart } from '../explore/exploreStart'

/**
 * Milestone 3's Home stage: the apps arc plus the Hub's templates, in the
 * layout picked in UI Playground › Apps and templates. The arc keeps a featured
 * set (about ten); everything else is one click away in Explore.
 */
const FEATURED = 12

const kind = ref<'apps' | 'templates'>('apps')
const KINDS: { value: 'apps' | 'templates'; label: string }[] = [
  { value: 'apps', label: 'Apps' },
  { value: 'templates', label: 'Workflows' }
]

type Topic = 'all' | ArcItem['topic']
const topic = ref<Topic>('all')
const EVERY = [...ARC_APPS, ...ARC_TEMPLATES]
const TOPICS = computed(() =>
  (
    [
      { value: 'all', label: 'All' },
      { value: 'image', label: 'Image' },
      { value: 'video', label: 'Video' },
      { value: '3d', label: '3D' },
      { value: 'audio', label: 'Audio' }
    ] as { value: Topic; label: string }[]
  ).filter((t) => t.value === 'all' || EVERY.filter((x) => x.topic === t.value).length >= 3)
)

const mix = computed(() => homeArcMix.id)

const items = computed<ArcItem[]>(() => {
  switch (mix.value) {
    case 'tabs':
      return (kind.value === 'apps' ? ARC_APPS : ARC_TEMPLATES).slice(0, FEATURED)
    case 'mixed':
      return interleave(ARC_APPS, ARC_TEMPLATES, FEATURED)
    case 'row':
      return ARC_APPS
    case 'topics': {
      const apps = ARC_APPS.filter((x) => topic.value === 'all' || x.topic === topic.value)
      const flows = ARC_TEMPLATES.filter((x) => topic.value === 'all' || x.topic === topic.value)
      return interleave(apps, flows, FEATURED)
    }
  }
  return ARC_APPS
})

const allLabel = computed(() => {
  if (mix.value === 'tabs') return kind.value === 'apps' ? 'See all apps' : 'See all workflows'
  if (mix.value === 'topics' && topic.value !== 'all')
    return `See all ${TOPICS.value.find((t) => t.value === topic.value)?.label}`
  if (mix.value === 'row') return 'See all apps'
  return 'Explore all'
})

function seeAll(on: 'apps' | 'templates'): void {
  exploreStart.value = on
  go('explore')
}
const allOn = computed<'apps' | 'templates'>(() =>
  mix.value === 'tabs' && kind.value === 'templates' ? 'templates' : 'apps'
)

/**
 * Switching tabs (or chips) swaps the whole arc: the old cards fade down,
 * the new ones' front pictures load out of sight, then the arc fades back
 * up with them in place. The arc never shows half-loaded or jumping cards.
 */
const OUT_MS = 150
const next = computed(() => ({ items: items.value, label: allLabel.value, on: allOn.value }))
const shown = shallowRef(next.value)
const leaving = ref(false)
function preload(list: ArcItem[]): Promise<unknown> {
  // The front card and two each side are what shows first.
  const near = [...list.slice(0, 3), ...list.slice(-2)]
  return Promise.all(
    near.map((x) => {
      const img = new Image()
      img.src = x.src
      return img.decode().catch(() => {})
    })
  )
}
let swap = 0
watch(
  () => next.value.items,
  async () => {
    const id = ++swap
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    leaving.value = !reduce
    await Promise.all([
      reduce ? null : new Promise((r) => setTimeout(r, OUT_MS)),
      preload(next.value.items)
    ])
    if (id !== swap) return
    shown.value = next.value
    await nextTick()
    requestAnimationFrame(() => {
      if (id === swap) leaving.value = false
    })
  }
)
watch(
  () => [next.value.label, next.value.on],
  () => {
    if (shown.value.items === next.value.items) shown.value = next.value
  }
)

const row = ref<InstanceType<typeof ScrollRow> | null>(null)
function scrollRow(by: number): void {
  const el = (row.value?.$el as HTMLElement | undefined) ?? null
  el?.scrollBy({ left: by * el.clientWidth * 0.8, behavior: 'smooth' })
}
</script>

<template>
  <div class="mar-arcmix">
    <div v-if="mix === 'tabs'" class="mar-arcmix-picker">
      <MarSeg v-model="kind" :options="KINDS" label="Show" />
    </div>
    <div
      v-else-if="mix === 'topics'"
      class="mar-arcmix-picker"
      role="tablist"
      aria-label="Use case"
    >
      <button
        v-for="t in TOPICS"
        :key="t.value"
        type="button"
        role="tab"
        class="mar-arcmix-chip"
        :aria-selected="topic === t.value"
        @click="topic = t.value"
      >
        {{ t.label }}
      </button>
    </div>

    <div class="mar-arcmix-stage" :class="leaving && 'is-leaving'">
      <ExampleArc :items="shown.items" :all-label="shown.label" @all="seeAll(shown.on)" />
    </div>

    <section v-if="mix === 'row'" class="mar-arcmix-row">
      <SectionHeader
        class="mar-sec"
        title="Workflows"
        link="See all workflows"
        @link="seeAll('templates')"
      >
        <template #controls>
          <span class="mar-arcmix-steps">
            <button type="button" aria-label="Previous workflows" @click="scrollRow(-1)">
              <ChevronLeft :size="16" />
            </button>
            <button type="button" aria-label="Next workflows" @click="scrollRow(1)">
              <ChevronRight :size="16" />
            </button>
          </span>
        </template>
      </SectionHeader>
      <ScrollRow ref="row" :columns="5" :min="180">
        <WorkflowCard
          v-for="w in ARC_TEMPLATES"
          :key="w.id"
          :src="w.src"
          :title="w.label"
          :meta="w.does"
          @open="w.open()"
        />
      </ScrollRow>
    </section>
  </div>
</template>

<style>
.mar-arcmix-stage {
  transition:
    opacity 260ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
}
.mar-arcmix-stage.is-leaving {
  opacity: 0;
  transform: translateY(6px) scale(0.985);
  transition-duration: 150ms;
  transition-timing-function: ease-in;
}
@media (prefers-reduced-motion: reduce) {
  .mar-arcmix-stage {
    transition: none;
  }
}
.mar-arcmix-picker {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-bottom: 14px;
}
:root .proto-ui.proto-ui.proto-ui .mar-arcmix-chip {
  width: auto;
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-muted-foreground);
  font-size: 13px;
  transition:
    background-color 140ms ease,
    color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-arcmix-chip:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-arcmix-chip[aria-selected='true'] {
  background: var(--color-base-foreground);
  color: var(--color-base-background);
}
.mar-arcmix-row {
  margin-top: 28px;
}
.mar-arcmix-steps {
  display: inline-flex;
  gap: 2px;
}
:root .proto-ui.proto-ui.proto-ui .mar-arcmix-steps button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 8px;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-arcmix-steps button:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
}
</style>
