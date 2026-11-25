<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { toast } from '../../useProto'
import hillsSunset from '../assets/hills-sunset.jpg'
import portraitSun from '../assets/portrait-sun.jpg'
import forestFog from '../assets/forest-fog.jpg'

/**
 * 16 · Spotlight: What's new as one wide photo carousel. The message sits
 * on the left over a dark veil (a large title, one line, a white
 * CTA and a quiet link); timed segments under it fill as each slide plays
 * and move on to the next. Pointer over it pauses; a segment jumps to its
 * slide. No Up next list (Mar's call). Slides are the What's new banner's
 * (LaunchBanner.vue): same photos, messages and CTAs.
 */
interface Slide {
  id: string
  kind: string
  title: string
  line: string
  cta: string
  image: string
  /** Where the photo is anchored when cropped to the wide frame. */
  focus?: string
}

const SLIDES: Slide[] = [
  {
    id: 'cloud',
    kind: 'New on Comfy',
    title: 'Comfy Cloud is here.',
    line: 'Run any workflow without a GPU.',
    cta: 'Try it',
    image: hillsSunset
  },
  {
    id: 'wan',
    kind: 'New model',
    title: 'Wan 2.5 is in ComfyUI.',
    line: 'A still becomes a scene.',
    cta: 'Try it now',
    image: portraitSun,
    focus: '50% 28%'
  },
  {
    id: 'apps',
    kind: 'New feature',
    title: 'Apps are here.',
    line: 'Turn any workflow into a form.',
    cta: 'See how',
    image: forestFog
  }
]

const INTERVAL = 7000
const index = ref(0)
const paused = ref(false)
const progress = ref(0)
const slide = computed(() => SLIDES[index.value]!)

let raf = 0
let last = 0
function tick(now: number): void {
  if (last && !paused.value) progress.value += (now - last) / INTERVAL
  last = now
  if (progress.value >= 1) {
    progress.value = 0
    index.value = (index.value + 1) % SLIDES.length
  }
  raf = requestAnimationFrame(tick)
}
function pick(i: number): void {
  index.value = i
  progress.value = 0
}
/** How full segment i is: played ones full, the current one as it plays. */
const fill = (i: number): number => (i < index.value ? 1 : i === index.value ? progress.value : 0)

onMounted(() => {
  raf = requestAnimationFrame(tick)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <section class="mt-10" aria-roledescription="carousel" aria-label="What's new">
    <div
      class="relative h-[260px] overflow-hidden rounded-[22px] bg-[oklch(0.2_0.004_285)] [clip-path:inset(0_round_22px)]"
      @mouseenter="paused = true"
      @mouseleave="paused = false"
      @focusin="paused = true"
      @focusout="paused = false"
    >
      <Transition name="p16-fade">
        <img
          :key="slide.id"
          :src="slide.image"
          alt=""
          class="p16-drift absolute inset-0 size-full object-cover"
          :style="{ objectPosition: slide.focus ?? '50% 50%' }"
        />
      </Transition>
      <span class="p16-veil absolute inset-0" aria-hidden="true" />

      <Transition name="p16-copy" mode="out-in">
        <div
          :key="slide.id"
          class="absolute top-1/2 left-9 flex max-w-[min(640px,70%)] -translate-y-[58%] flex-col items-start gap-3"
          aria-live="polite"
        >
          <h3
            class="text-[32px] leading-[1.12] font-semibold tracking-[-0.03em] text-white/97 [text-wrap:balance]"
          >
            {{ slide.title }}
          </h3>
          <p class="text-[15px] leading-[1.4] text-white/78">{{ slide.line }}</p>
          <div class="mt-1 flex items-center gap-3.5">
            <button type="button" class="p16-cta" @click="toast(slide.cta)">
              {{ slide.cta }}
            </button>
            <button type="button" class="p16-link" @click="toast('Release notes')">
              Read the notes
            </button>
          </div>
        </div>
      </Transition>

      <div class="absolute bottom-6 left-9 flex items-center gap-1.5" role="tablist" data-no-pill>
        <button
          v-for="(s, i) in SLIDES"
          :key="s.id"
          type="button"
          role="tab"
          class="p16-seg"
          :aria-selected="i === index"
          :aria-label="`${s.title} (${i + 1} of ${SLIDES.length})`"
          @click="pick(i)"
        >
          <span class="relative block h-[3px] w-full overflow-hidden rounded-[2px] bg-white/25">
            <span
              class="absolute inset-y-0 left-0 bg-white/95"
              :style="{ width: `${Math.min(fill(i), 1) * 100}%` }"
            />
          </span>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Darkest on the left where the message is, opening up to the photo. */
.p16-veil {
  background:
    linear-gradient(to right, rgb(0 0 0 / 0.72) 0%, rgb(0 0 0 / 0.38) 40%, rgb(0 0 0 / 0.08) 70%),
    linear-gradient(to top, rgb(0 0 0 / 0.35), transparent 40%);
}
.p16-drift {
  animation: p16-drift 16s cubic-bezier(0.37, 0, 0.63, 1) infinite alternate;
}
@keyframes p16-drift {
  from {
    transform: scale(1.03) translate3d(-0.8%, 0, 0);
  }
  to {
    transform: scale(1.1) translate3d(1.2%, -0.8%, 0);
  }
}
.p16-fade-enter-active,
.p16-fade-leave-active {
  transition: opacity 700ms ease;
}
.p16-fade-enter-from,
.p16-fade-leave-to {
  opacity: 0;
}
.p16-copy-enter-active {
  transition:
    opacity 420ms ease,
    transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
}
.p16-copy-leave-active {
  transition: opacity 200ms ease;
}
.p16-copy-enter-from {
  opacity: 0;
  transform: translate3d(0, 10px, 0);
}
.p16-copy-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .p16-drift {
    animation: none;
  }
  .p16-fade-enter-active,
  .p16-fade-leave-active,
  .p16-copy-enter-active,
  .p16-copy-leave-active {
    transition: none;
  }
}
</style>

<style>
/* Buttons are styled here: the prototype's reset wipes their padding. */
:root .proto-ui.proto-ui.proto-ui .p16-cta {
  height: 38px;
  padding: 0 16px;
  border-radius: 11px;
  background-color: oklch(0.96 0.002 285);
  color: oklch(0.13 0.004 285);
  font-size: 13px;
  font-weight: 600;
  transition: background-color 120ms ease;
}
:root .proto-ui.proto-ui.proto-ui .p16-cta:hover {
  background-color: #fff;
}
:root .proto-ui.proto-ui.proto-ui .p16-link {
  padding: 0;
  color: rgb(255 255 255 / 0.8);
  font-size: 13px;
  font-weight: 500;
  transition: color 120ms ease;
}
:root .proto-ui.proto-ui.proto-ui .p16-link:hover {
  color: #fff;
}
:root .proto-ui.proto-ui.proto-ui .p16-seg {
  display: block;
  width: 56px;
  padding: 8px 0;
}
:root .proto-ui.proto-ui.proto-ui :is(.p16-cta, .p16-link, .p16-seg):focus-visible {
  outline: 2px solid rgb(255 255 255 / 0.7);
  outline-offset: 2px;
}
</style>
