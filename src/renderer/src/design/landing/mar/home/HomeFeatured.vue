<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { useResizeObserver } from '@vueuse/core'
import Button from '../../ui/Button.vue'
import MarSeg from '../pages/MarSeg.vue'
import HomeFeedTile from './HomeFeedTile.vue'
import { FEED_TABS, exploreAll, feed, type FeedTab } from './homeFeed'
import { reducedMotion } from '../userStates/examples'

const tab = ref<FeedTab>('new')
const tabs = computed(() => FEED_TABS())
const items = computed(() => feed(tab.value))

const track = ref<HTMLElement>()
const stops = ref<number[]>([0])
const at = ref(0)

function slideEls(): HTMLElement[] {
  return [...(track.value?.children ?? [])] as HTMLElement[]
}

function measure(): void {
  const el = track.value
  if (!el) return
  const max = el.scrollWidth - el.clientWidth
  const origin = el.getBoundingClientRect().left - el.scrollLeft
  const starts = slideEls().map((s) => Math.min(max, s.getBoundingClientRect().left - origin))
  const unique = starts.filter((x, i) => i === 0 || x - starts[i - 1]! > 2)
  stops.value = unique.length ? unique : [0]
  locate()
}

function locate(): void {
  const el = track.value
  if (!el) return
  const left = el.scrollLeft
  at.value = stops.value.reduce(
    (best, x, i) => (Math.abs(x - left) < Math.abs(stops.value[best]! - left) ? i : best),
    0
  )
}

useResizeObserver(track, measure)
onMounted(measure)

function goTo(i: number): void {
  const el = track.value
  const to = stops.value[Math.max(0, Math.min(stops.value.length - 1, i))]
  if (!el || to === undefined) return
  el.scrollTo({ left: to, behavior: reducedMotion() ? 'auto' : 'smooth' })
}

watch(tab, async () => {
  await nextTick()
  if (track.value) track.value.scrollLeft = 0
  measure()
})
</script>

<template>
  <section
    class="hvf"
    role="region"
    aria-roledescription="carousel"
    aria-label="Featured"
    data-home-tour="apps-carousel"
  >
    <div class="hvf-head">
      <MarSeg v-model="tab" :options="tabs" label="Featured" />
      <div class="hvf-tools">
        <button type="button" class="mar-strip-all" @click="exploreAll(tab)">
          Explore all<ChevronRight :size="13" aria-hidden="true" />
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous"
          :disabled="at === 0"
          @click="goTo(at - 1)"
        >
          <ChevronLeft :size="16" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next"
          :disabled="at >= stops.length - 1"
          @click="goTo(at + 1)"
        >
          <ChevronRight :size="16" aria-hidden="true" />
        </Button>
      </div>
    </div>
    <div ref="track" class="hvf-track" @scroll.passive="locate">
      <HomeFeedTile
        v-for="x in items"
        :key="x.id"
        :item="x"
        ratio="16/9"
        class="hvf-slide"
        @open="x.open()"
      />
    </div>
  </section>
</template>

<style>
.hvf-head {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.hvf-tools {
  display: flex;
  align-items: center;
  gap: 2px;
}
.hvf-track {
  --hvf-gap: 10px;
  display: flex;
  gap: var(--hvf-gap);
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
}
.hvf-track::-webkit-scrollbar {
  display: none;
}
:root .proto-ui.proto-ui.proto-ui .hvf-slide {
  flex: 0 0 auto;
  width: calc((100% - 2 * var(--hvf-gap)) / 2.3);
  scroll-snap-align: start;
}
</style>
