<script setup lang="ts">
import { computed, ref } from 'vue'
import { GraduationCap } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import EmptyState from '../../ui/EmptyState.vue'
import PageHeader from '../../ui/PageHeader.vue'
import SearchInput from '../../ui/SearchInput.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import { TUTORIALS, type Tutorial } from '../../mock'
import { toast } from '../../useProto'
import LearnCard from './LearnCard.vue'
import LearnCourse from './LearnCourse.vue'

/**
 * Learn in Mar's proposal. Beginners get one obvious place to start: the
 * Basics lessons as a short course, in order, with what's done. Everything
 * else sits under its track (VFX, Animations, Ads), so no card has to say
 * which track it's in. The tabs narrow to one track; a search looks across
 * all of them, still grouped.
 */
type Track = Tutorial['category']
const TRACKS: { id: Track; blurb: string }[] = [
  { id: 'Basics', blurb: 'The essentials, in order.' },
  { id: 'VFX', blurb: 'Fix and transform real footage.' },
  { id: 'Animations', blurb: 'Characters that move and speak.' },
  { id: 'Ads', blurb: 'Product shots and layouts for campaigns.' }
]

const tab = ref<'All' | Track>('All')
const q = ref('')
const query = computed(() => q.value.trim().toLowerCase())

const basics = TUTORIALS.filter((t) => t.category === 'Basics')
const showCourse = computed(() => !query.value && (tab.value === 'All' || tab.value === 'Basics'))

const sections = computed(() =>
  TRACKS.filter((tr) => tab.value === 'All' || tab.value === tr.id)
    // Without a search, the Basics lessons live in the course above.
    .filter((tr) => query.value || tr.id !== 'Basics')
    .map((tr) => ({
      ...tr,
      items: TUTORIALS.filter(
        (t) => t.category === tr.id && `${t.title} ${t.blurb}`.toLowerCase().includes(query.value)
      )
    }))
    .filter((s) => s.items.length)
)
const empty = computed(() => !showCourse.value && !sections.value.length)

const open = (t: Tutorial): void => toast(`Watch: ${t.title}`)
</script>

<template>
  <div class="mar-learn mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader title="Learn" />
    <div class="mb-8 flex items-center justify-between gap-3">
      <SegmentedControl
        v-model="tab"
        :options="
          (['All', 'Basics', 'VFX', 'Animations', 'Ads'] as const).map((c) => ({
            value: c,
            label: c
          }))
        "
      />
      <SearchInput v-model="q" placeholder="Search tutorials" class="w-60" />
    </div>

    <section v-if="showCourse">
      <header class="mar-learn-head">
        <h2>Start here</h2>
        <p>New to ComfyUI? {{ basics.length }} short lessons, in order.</p>
      </header>
      <LearnCourse :lessons="basics" @open="open" />
    </section>

    <div v-if="sections.length" class="mar-learn-tracks" :class="showCourse && 'mt-12'">
      <section
        v-for="s in sections"
        :key="s.id"
        class="mar-learn-track"
        :style="{ '--span': Math.min(s.items.length, 4) }"
      >
        <header class="mar-learn-head">
          <h2>
            {{ s.id }}<span>{{ s.items.length }}</span>
          </h2>
          <p class="truncate">{{ s.blurb }}</p>
        </header>
        <LearnCard v-for="t in s.items" :key="t.title" :t @open="open(t)" />
      </section>
    </div>

    <EmptyState
      v-if="empty"
      :icon="GraduationCap"
      title="No tutorials found"
      :description="`Nothing matches “${q.trim()}”${tab === 'All' ? '' : ` in ${tab}`}.`"
    >
      <Button v-if="tab !== 'All'" variant="secondary" size="sm" @click="tab = 'All'"
        >Search all tracks</Button
      >
      <Button variant="ghost" size="sm" @click="q = ''">Clear search</Button>
    </EmptyState>
  </div>
</template>

<style>
.mar-learn-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 14px;
}
.mar-learn-head h2 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.mar-learn-head h2 > span {
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui, 13px);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.mar-learn-head p {
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui, 13px);
}
/* Tracks share rows: a short track takes only the columns it needs, so
   two small ones sit side by side instead of leaving half a row empty. */
.mar-learn-tracks {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 48px 24px;
}
.mar-learn-track {
  display: grid;
  grid-column: span var(--span);
  grid-template-columns: subgrid;
  row-gap: 16px;
  align-content: start;
}
.mar-learn-track > .mar-learn-head {
  grid-column: 1 / -1;
  min-width: 0;
  margin-bottom: -2px;
}
@media (max-width: 1100px) {
  .mar-learn-tracks {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .mar-learn-track {
    grid-column: 1 / -1;
  }
}
/* Chips on imagery stay light-on-dark in both themes. */
:root[data-mar-ui='on'] .mar-learn .bg-media-overlay {
  color: oklch(1 0 0 / 0.9);
  background-color: oklch(0 0 0 / 0.5);
}
</style>
