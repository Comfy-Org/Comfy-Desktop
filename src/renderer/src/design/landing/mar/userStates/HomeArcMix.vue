<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { go } from '../../useProto'
import ExampleArc from './ExampleArc.vue'
import ScrollRow from '../../ui/ScrollRow.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import WorkflowCard from '../WorkflowCard.vue'
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
const KINDS = [
  { value: 'apps' as const, label: 'Apps' },
  { value: 'templates' as const, label: 'Templates' }
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

const items = computed<ArcItem[]>(() => {
  switch (homeArcMix.id) {
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
  if (homeArcMix.id === 'tabs') return kind.value === 'apps' ? 'See all apps' : 'See all templates'
  if (homeArcMix.id === 'topics' && topic.value !== 'all')
    return `See all ${TOPICS.value.find((t) => t.value === topic.value)?.label}`
  if (homeArcMix.id === 'row') return 'See all apps'
  return 'Explore all'
})

function seeAll(on: 'apps' | 'templates'): void {
  exploreStart.value = on
  go('explore')
}
const allOn = computed(() =>
  homeArcMix.id === 'tabs' && kind.value === 'templates' ? 'templates' : 'apps'
)

const row = ref<InstanceType<typeof ScrollRow> | null>(null)
function scrollRow(by: number): void {
  const el = (row.value?.$el as HTMLElement | undefined) ?? null
  el?.scrollBy({ left: by * el.clientWidth * 0.8, behavior: 'smooth' })
}
</script>

<template>
  <div class="mar-arcmix">
    <div
      v-if="homeArcMix.id === 'tabs'"
      class="mar-arcmix-picker"
      role="tablist"
      aria-label="Show"
      data-no-pill
    >
      <button
        v-for="k in KINDS"
        :key="k.value"
        type="button"
        role="tab"
        class="mar-arcmix-tab"
        :aria-selected="kind === k.value"
        @click="kind = k.value"
      >
        {{ k.label }}
      </button>
    </div>
    <div
      v-else-if="homeArcMix.id === 'topics'"
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

    <ExampleArc :items="items" :all-label="allLabel" @all="seeAll(allOn)" />

    <section v-if="homeArcMix.id === 'row'" class="mar-arcmix-row">
      <SectionHeader
        class="mar-sec"
        title="Templates"
        link="See all templates"
        @link="seeAll('templates')"
      >
        <template #controls>
          <span class="mar-arcmix-steps">
            <button type="button" aria-label="Previous templates" @click="scrollRow(-1)">
              <ChevronLeft :size="16" />
            </button>
            <button type="button" aria-label="Next templates" @click="scrollRow(1)">
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
:root .proto-ui.proto-ui.proto-ui .mar-arcmix-tab {
  position: relative;
  width: auto;
  height: 28px;
  padding: 0 8px;
  background: none;
  color: var(--color-muted-foreground);
  font-size: 14px;
  font-weight: 500;
  transition: color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-arcmix-tab:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-arcmix-tab[aria-selected='true'] {
  color: var(--color-base-foreground);
}
.mar-arcmix-tab::after {
  position: absolute;
  right: 8px;
  bottom: 0;
  left: 8px;
  height: 2px;
  border-radius: 1px;
  background: currentColor;
  content: '';
  opacity: 0;
  transform: scaleX(0.4);
  transition:
    opacity 160ms ease,
    transform 200ms cubic-bezier(0.2, 0, 0, 1);
}
.mar-arcmix-tab[aria-selected='true']::after {
  opacity: 1;
  transform: none;
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
