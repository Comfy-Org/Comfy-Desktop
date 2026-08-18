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
  props.intervalMs ?? 5000
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
        <img class="slider__art" :src="slide.art" :alt="slide.label" draggable="false" />

        <!-- Provider mark always, model name only while the pointer is on the
             card: the credit belongs with the art, but at rest the art is the
             point. -->
        <figcaption class="slider__credit">
          <span class="slider__mark" aria-hidden="true">
            <img class="slider__mark-icon" :src="slide.providerIcon" alt="" />
          </span>
          <span class="slider__model">{{ slide.model }}</span>
        </figcaption>
      </figure>
    </div>

    <!-- Out past the neighbours, in the clear the mask fades into, and outside
         the stage: inside it that same mask faded the controls out with the
         art. Auto-advance carries the row anyway, so these are a shortcut,
         never the only way through. -->
    <button
      type="button"
      class="slider__side slider__side--prev"
      :aria-label="$t('common.previous')"
      @click="carousel.prev()"
    >
      <ChevronLeft :size="17" />
    </button>
    <button
      type="button"
      class="slider__side slider__side--next"
      :aria-label="$t('common.next')"
      @click="carousel.next()"
    >
      <ChevronRight :size="17" />
    </button>
  </section>
</template>

<style scoped>
.slider {
  --slide-w: clamp(200px, 19vw, 268px);
  --step: calc(var(--slide-w) * 0.86);
  position: relative;
  width: var(--slide-w);
}
/* The stage bleeds a slide either side of the card so the neighbours stay on
   screen, and the mask fades them out instead of cutting them, which is what
   keeps the row from reading as a filmstrip. */
.slider__stage {
  position: relative;
  width: calc(var(--slide-w) * 3);
  height: calc(var(--slide-w) + 94px);
  margin-left: calc(var(--slide-w) * -1);
  mask-image: linear-gradient(to right, transparent 11%, #000 33%, #000 67%, transparent 89%);
}
.slider__slide {
  position: absolute;
  top: 34px;
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
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.34);
}
/* Bottom-left of the still, frosted so it holds over any art. The disc is
   always there; the name only unfolds on hover of the current card. */
.slider__credit {
  position: absolute;
  left: 8px;
  bottom: 8px;
  display: flex;
  align-items: center;
  max-width: calc(100% - 16px);
  padding: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.11);
  backdrop-filter: blur(20px) saturate(130%);
  -webkit-backdrop-filter: blur(20px) saturate(130%);
  opacity: 0;
  transition: opacity 300ms ease;
}
.slider__slide.is-current .slider__credit {
  opacity: 1;
}
.slider__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  /* No ground of its own: the chip behind it is already a disc at rest, and two
     stacked circles read as a mistake. */
}
/* Neutral, not the partner's own palette: eight brand colours sitting on eight
   different stills would fight both the art and each other. `brightness(0)`
   flattens the mark to black, `invert(1)` lifts it to white, and the alpha
   channel carries the shape through untouched. */
.slider__mark-icon {
  width: 12px;
  height: 12px;
  display: block;
  object-fit: contain;
  filter: brightness(0) invert(1);
  opacity: 0.92;
}
.slider__model {
  display: block;
  max-width: 0;
  overflow: hidden;
  white-space: nowrap;
  font-size: 10.5px;
  font-weight: 500;
  color: #fff;
  opacity: 0;
  padding-inline: 0;
  transition:
    max-width 320ms cubic-bezier(0.32, 0.72, 0, 1),
    opacity 200ms ease,
    padding-inline 320ms cubic-bezier(0.32, 0.72, 0, 1);
}
.slider__slide.is-current:hover .slider__model,
.slider__slide.is-current:focus-within .slider__model {
  max-width: 14rem;
  padding-inline: 6px 8px;
  opacity: 1;
}

/* Frosted, the same recipe the takeover uses for glass, so they read as
   controls without drawing a box around themselves. */
.slider__side {
  position: absolute;
  top: calc(34px + var(--slide-w) / 2);
  z-index: 3;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.13);
  backdrop-filter: blur(20px) saturate(130%);
  -webkit-backdrop-filter: blur(20px) saturate(130%);
  color: #fff;
  cursor: pointer;
  /* Barely there until you reach for them: at rest the row is art, and the
     controls only need to exist the moment the pointer arrives. */
  opacity: 0.4;
  transition:
    opacity 160ms ease,
    background 160ms ease;
}
.slider__side--prev {
  left: calc(var(--slide-w) * -0.68 - 17px);
}
.slider__side--next {
  right: calc(var(--slide-w) * -0.68 - 17px);
}
.slider__side:hover,
.slider__side:focus-visible {
  opacity: 1;
  background: rgba(255, 255, 255, 0.26);
}
.slider__side:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .slider__slide,
  .slider__model,
  .slider__credit,
  .slider__side {
    transition: none;
  }
}
</style>
