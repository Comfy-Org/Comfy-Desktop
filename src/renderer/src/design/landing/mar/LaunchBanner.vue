<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from '../ui/Button.vue'
import { toast } from '../useProto'
import cloudLoop from './assets/banner-cloud.mp4'
import cloudPoster from './assets/banner-cloud.jpg'
import bloomLoop from './assets/banner-bloom.mp4'
import bloomPoster from './assets/banner-bloom.jpg'
import ribbonLoop from './assets/banner-ribbon.mp4'
import ribbonPoster from './assets/banner-ribbon.jpg'

/**
 * Mar's What's new: one full-width branded banner at a time (direction C in
 * Figma "What's new · directions"). A looping visual, one centred message,
 * a white CTA and a quiet link. Slides advance on their own and pause while
 * the pointer is over the banner. `video` takes a brand-kit loop; until one
 * exists the slide shows its gradient.
 */
interface Slide {
  id: string
  title: string
  cta: string
  gradient: string
  video?: string
  /** With a video, its poster and the reduced-motion still; on its own, a
   *  photo that drifts slowly. */
  image?: string
}

const SLIDES: Slide[] = [
  {
    id: 'cloud',
    title: 'Comfy Cloud is here.\nRun any workflow without a GPU.',
    cta: 'Try it',
    video: cloudLoop,
    image: cloudPoster,
    gradient:
      'radial-gradient(60% 90% at 18% 30%, #3b82f6 0%, transparent 60%), radial-gradient(50% 80% at 85% 70%, #60a5fa 0%, transparent 65%), linear-gradient(120deg, #0b1b3f, #1e3a8a 45%, #0f2a5f)'
  },
  {
    id: 'wan',
    title: 'Wan 2.5 is in ComfyUI.\nA still becomes a scene.',
    cta: 'Try it now',
    video: bloomLoop,
    image: bloomPoster,
    gradient:
      'radial-gradient(55% 90% at 20% 70%, #f97316 0%, transparent 60%), radial-gradient(55% 85% at 80% 25%, #db2777 0%, transparent 62%), linear-gradient(120deg, #2a0f1f, #6b1d3a 50%, #3a1208)'
  },
  {
    id: 'apps',
    title: 'Apps are here.\nTurn any workflow into a form.',
    cta: 'See how',
    video: ribbonLoop,
    image: ribbonPoster,
    gradient:
      'radial-gradient(60% 90% at 80% 35%, #10b981 0%, transparent 60%), radial-gradient(50% 80% at 15% 75%, #a3e635 0%, transparent 60%), linear-gradient(120deg, #06231b, #0f4d3a 50%, #0b2a12)'
  }
]

const INTERVAL = 7000
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const index = ref(0)
const paused = ref(false)
/** The slide whose loop is playing; until then its still shows. */
const playing = ref('')
const slide = computed(() => SLIDES[index.value]!)

// How far the current slide is through its time (0 to 1); it fills the
// active dot below, stops while the pointer is over the banner, and moves
// to the next slide when it is full. Picking a dot starts that slide over.
const progress = ref(0)
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
onMounted(() => {
  raf = requestAnimationFrame(tick)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <section class="mt-10">
    <!-- No title or link above it: the banner says what's new. -->
    <div
      class="relative aspect-[5/1] min-h-52 overflow-hidden rounded-[20px]"
      @mouseenter="paused = true"
      @mouseleave="paused = false"
    >
      <Transition name="banner-fade">
        <div :key="slide.id" class="absolute inset-0">
          <!-- Layered so a slide is never flat: the gradient, then the
               still, then the loop, which fades in only once it plays. A
               clip that is slow, blocked or broken leaves the still. -->
          <div
            class="banner-gradient absolute inset-0"
            :style="{ backgroundImage: slide.gradient }"
          />
          <img
            v-if="slide.image"
            :src="slide.image"
            alt=""
            :class="[
              'absolute inset-0 size-full object-cover',
              !slide.video || reduced ? 'banner-drift' : ''
            ]"
          />
          <video
            v-if="slide.video && !reduced"
            :src="slide.video"
            :poster="slide.image"
            autoplay
            muted
            loop
            playsinline
            :class="[
              'absolute inset-0 size-full object-cover transition-opacity duration-500',
              playing === slide.id ? 'opacity-100' : 'opacity-0'
            ]"
            @playing="playing = slide.id"
          />
          <span
            v-if="slide.image"
            :class="['banner-veil absolute inset-0', slide.video ? 'is-soft' : '']"
            aria-hidden="true"
          />
          <span class="banner-grain absolute inset-0" aria-hidden="true" />
          <div
            class="absolute inset-0 flex flex-col items-center justify-center gap-5 px-8 pb-6 text-center"
          >
            <h3
              class="text-[30px] leading-[1.15] font-medium tracking-[-0.015em] whitespace-pre-line text-white drop-shadow-sm"
            >
              {{ slide.title }}
            </h3>
            <div class="flex items-center gap-4">
              <Button
                variant="primary"
                size="lg"
                class="bg-white text-black hover:bg-white/90"
                @click="toast(slide.cta)"
                >{{ slide.cta }}</Button
              >
              <Button
                variant="link"
                size="sm"
                class="text-white/85 hover:text-white"
                @click="toast('Learn more')"
                >Learn more</Button
              >
            </div>
          </div>
        </div>
      </Transition>
      <!-- The dots sit inside the banner, under the buttons. -->
      <div
        class="absolute inset-x-0 bottom-5 z-10 flex justify-center gap-1.5"
        role="tablist"
        data-no-pill
        aria-label="What's new slides"
      >
        <button
          v-for="(s, i) in SLIDES"
          :key="s.id"
          type="button"
          role="tab"
          :aria-selected="i === index"
          :aria-label="`Slide ${i + 1}`"
          :class="[
            'relative h-1.5 overflow-hidden rounded-full transition-[width,background-color] duration-300',
            i === index ? 'w-8 bg-white/30' : 'w-1.5 bg-white/45 hover:bg-white/80'
          ]"
          @click="pick(i)"
        >
          <span
            v-if="i === index"
            class="absolute inset-y-0 left-0 rounded-full bg-white"
            :style="{ width: `${Math.min(progress, 1) * 100}%` }"
          />
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Photo slides drift slowly (Ken Burns) under a veil that keeps the
   centred message readable. */
.banner-drift {
  animation: banner-drift 14s cubic-bezier(0.37, 0, 0.63, 1) infinite alternate;
}
.banner-veil {
  background:
    radial-gradient(70% 90% at 50% 50%, rgb(0 0 0 / 0.45), rgb(0 0 0 / 0.2)),
    linear-gradient(to bottom, rgb(0 0 0 / 0.15), rgb(0 0 0 / 0.35));
}
/* The loops and their stills are pale pastel: a lighter veil keeps their
   colour and still holds the white message. */
.banner-veil.is-soft {
  background: radial-gradient(55% 75% at 50% 50%, rgb(20 16 32 / 0.38), rgb(20 16 32 / 0.08));
}
@keyframes banner-drift {
  from {
    transform: scale(1.04) translate3d(-1%, 0, 0);
  }
  to {
    transform: scale(1.12) translate3d(1.5%, -1%, 0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .banner-drift {
    animation: none;
  }
}
.banner-gradient {
  background-size: 140% 140%;
  animation: banner-pan 18s ease-in-out infinite alternate;
}

/* Film grain over the gradient, as in the brand's banners. */
.banner-grain {
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.5'/></svg>");
  mix-blend-mode: overlay;
  opacity: 0.35;
}

@keyframes banner-pan {
  from {
    background-position: 0% 30%;
  }
  to {
    background-position: 100% 70%;
  }
}

.banner-fade-enter-active,
.banner-fade-leave-active {
  transition: opacity 600ms ease;
}
.banner-fade-enter-from,
.banner-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .banner-gradient {
    animation: none;
  }
  .banner-fade-enter-active,
  .banner-fade-leave-active {
    transition: none;
  }
}
</style>
