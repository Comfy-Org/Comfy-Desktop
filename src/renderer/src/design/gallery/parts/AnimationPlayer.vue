<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Pause, Play, Repeat } from 'lucide-vue-next'
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'
import Button from '../../landing/ui/Button.vue'
import SegmentedControl from '../../landing/ui/SegmentedControl.vue'

/**
 * Plays a CSS animation on a sample tile with a timeline: play / pause,
 * scrub to any frame, slow it down, loop it. Drives the real CSS animation
 * through the Web Animations API, so what you see is what ships.
 */
const { animation } = defineProps<{
  /** The `animation` shorthand, var() references already resolved. */
  animation: string
}>()

const tile = ref<HTMLElement>()
// Start on the last frame: many entrances begin invisible.
const progress = ref(1)
const playing = ref(false)
const loop = ref(true)
const speed = ref('1')
const SPEEDS = [
  { value: '0.1', label: '0.1×' },
  { value: '0.25', label: '¼×' },
  { value: '0.5', label: '½×' },
  { value: '1', label: '1×' }
]
const duration = ref(0)
const ms = computed(() => Math.round(progress.value * duration.value))

let anim: Animation | null = null
let raf = 0

function setup(): void {
  anim?.cancel()
  const el = tile.value
  if (!el) return
  // Restart the CSS animation, one iteration, holding its end frames.
  el.style.animation = 'none'
  void el.offsetWidth
  el.style.animation = animation
  el.style.animationIterationCount = '1'
  el.style.animationFillMode = 'both'
  anim = el.getAnimations()[0] ?? null
  if (!anim) return
  anim.pause()
  duration.value = Number(anim.effect?.getComputedTiming().duration ?? 0)
  anim.currentTime = progress.value * duration.value
  anim.onfinish = () => {
    if (loop.value && playing.value) {
      anim!.currentTime = 0
      anim!.play()
    } else stop(1)
  }
}
function tick(): void {
  if (anim && duration.value)
    progress.value = Math.min(1, Number(anim.currentTime ?? 0) / duration.value)
  if (playing.value) raf = requestAnimationFrame(tick)
}
function play(): void {
  if (!anim) setup()
  if (!anim) return
  if (progress.value >= 1) anim.currentTime = 0
  anim.playbackRate = Number(speed.value)
  anim.play()
  playing.value = true
  raf = requestAnimationFrame(tick)
}
function stop(at?: number): void {
  anim?.pause()
  playing.value = false
  cancelAnimationFrame(raf)
  if (at !== undefined) progress.value = at
}
function scrub(v?: number[]): void {
  if (!v || !anim) return
  stop(v[0]! / 100)
  anim.currentTime = progress.value * duration.value
}
watch(speed, (s) => anim && (anim.playbackRate = Number(s)))
watch(
  () => animation,
  () => {
    stop(1)
    setup()
  }
)
onMounted(setup)
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  anim?.cancel()
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex h-24 items-center justify-center rounded-control bg-secondary-background/60">
      <span ref="tile" class="size-12 rounded-card bg-inverted-background" />
    </div>
    <div class="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="playing ? 'Pause' : 'Play'"
        @click="playing ? stop() : play()"
        ><Pause v-if="playing" :size="14" /><Play v-else :size="14"
      /></Button>
      <SliderRoot
        :model-value="[progress * 100]"
        :max="100"
        :step="0.1"
        class="relative flex h-4 flex-1 touch-none items-center select-none"
        @update:model-value="scrub"
      >
        <SliderTrack class="relative h-1 grow rounded-full bg-secondary-background-hover">
          <SliderRange class="absolute h-full rounded-full bg-base-foreground" />
        </SliderTrack>
        <SliderThumb
          aria-label="Timeline"
          class="block size-3 rounded-full bg-base-foreground outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        />
      </SliderRoot>
      <span class="w-24 shrink-0 text-right font-mono text-ui text-subtle-foreground tabular-nums"
        >{{ ms }} / {{ duration }}ms</span
      >
    </div>
    <div class="flex items-center gap-2">
      <SegmentedControl v-model="speed" size="sm" variant="contained" :options="SPEEDS" />
      <Button
        variant="ghost"
        size="sm"
        class="ml-auto"
        :aria-pressed="loop"
        :class="loop && 'bg-secondary-background text-base-foreground'"
        @click="loop = !loop"
        ><Repeat :size="13" />Loop</Button
      >
    </div>
  </div>
</template>
