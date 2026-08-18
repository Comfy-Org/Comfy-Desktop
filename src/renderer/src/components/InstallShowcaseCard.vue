<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { SHOWCASE_STILLS } from '../lib/installShowcaseStills'
import { useShowcaseCarousel } from '../composables/useShowcaseCarousel'
import { TID } from '../../../shared/testIds'

/** The visual half of the install-wait showcase: a slider of stills with the
 *  neighbours left visible either side and the capability laid over the art.
 *  It runs its own rotation, slower than the line in the banner: two rhythms
 *  read as a screen that is alive, one lockstep pair reads as a slideshow. */
const props = defineProps<{ intervalMs?: number }>()

const carousel = useShowcaseCarousel(
  SHOWCASE_STILLS.map((s) => ({ id: s.id, title: s.label, body: '' })),
  props.intervalMs ?? 6800
)

const count = SHOWCASE_STILLS.length
const half = Math.floor(count / 2)

/** Every card is on stage at once, placed by its distance from the current one
 *  and wrapped into [-half, +half]. That is what makes the row endless: the
 *  first card has the last one to its left, and the jump each card makes when
 *  it wraps happens four slots out, well behind the mask. */
const slides = computed(() =>
  SHOWCASE_STILLS.map((still, i) => ({
    ...still,
    offset: ((((i - carousel.index.value + half) % count) + count) % count) - half
  }))
)
</script>

<template>
  <section class="slider" :data-testid="TID.installShowcase">
    <div class="slider__stage" @mouseenter="carousel.pause()" @mouseleave="carousel.resume()">
      <figure
        v-for="slide in slides"
        :key="slide.id"
        class="slider__slide"
        :class="{ 'is-current': slide.offset === 0 }"
        :style="{ '--o': slide.offset }"
        :aria-hidden="slide.offset !== 0"
      >
        <img class="slider__art" :src="slide.art" alt="" draggable="false" />
        <figcaption class="slider__label">{{ slide.label }}</figcaption>
      </figure>

      <!-- The neighbours are the control: click the still either side to walk
           the row. Auto-advance carries it otherwise, so this is a shortcut,
           never the only way through. -->
      <button
        type="button"
        class="slider__side slider__side--prev"
        :aria-label="$t('common.previous')"
        @click="carousel.prev()"
      >
        <ChevronLeft :size="18" />
      </button>
      <button
        type="button"
        class="slider__side slider__side--next"
        :aria-label="$t('common.next')"
        @click="carousel.next()"
      >
        <ChevronRight :size="18" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.slider {
  --slide-w: clamp(200px, 19vw, 268px);
  --step: calc(var(--slide-w) * 0.86);
  width: var(--slide-w);
}
/* The stage bleeds a slide either side of the card so the neighbours stay on
   screen, and the mask fades them out instead of cutting them, which is what
   keeps the row from reading as a filmstrip. */
.slider__stage {
  position: relative;
  width: calc(var(--slide-w) * 3);
  height: var(--slide-w);
  margin-left: calc(var(--slide-w) * -1);
  mask-image: linear-gradient(to right, transparent 2%, #000 32%, #000 68%, transparent 98%);
}
.slider__slide {
  position: absolute;
  top: 0;
  left: 50%;
  width: var(--slide-w);
  height: var(--slide-w);
  margin: 0;
  margin-left: calc(var(--slide-w) / -2);
  transform: translateX(calc(var(--o, 0) * var(--step))) scale(0.8);
  opacity: 0.35;
  filter: saturate(0.7);
  transition:
    transform 620ms cubic-bezier(0.32, 0.72, 0, 1),
    opacity 380ms ease,
    filter 380ms ease;
}
.slider__slide.is-current {
  transform: translateX(0) scale(1);
  opacity: 1;
  filter: none;
  z-index: 2;
}
.slider__art {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  border-radius: 14px;
  background: var(--neutral-800);
  border: 1px solid color-mix(in srgb, var(--neutral-100) 8%, transparent);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
}
/* A chip in the corner rather than a bar across the foot of the still: the art
   is the point, and a full-width scrim over it reads as a caption bolted on. */
.slider__label {
  position: absolute;
  top: 10px;
  right: 10px;
  margin: 0;
  padding: 5px 11px;
  border-radius: 999px;
  background: rgba(12, 9, 15, 0.52);
  backdrop-filter: blur(14px) saturate(120%);
  -webkit-backdrop-filter: blur(14px) saturate(120%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.2;
  color: #fff;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 320ms ease;
}
.slider__slide.is-current .slider__label {
  opacity: 1;
}
.slider__side {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 3;
  width: calc(var(--slide-w) * 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: none;
  color: #fff;
  cursor: pointer;
  opacity: 0.5;
  transition: opacity 180ms ease;
}
.slider__side--prev {
  left: 0;
}
.slider__side--next {
  right: 0;
}
.slider__side:hover,
.slider__side:focus-visible {
  opacity: 1;
}
.slider__side:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -4px;
  border-radius: 12px;
}
@media (prefers-reduced-motion: reduce) {
  .slider__slide,
  .slider__label,
  .slider__side {
    transition: none;
  }
}
</style>
