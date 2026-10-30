<script setup lang="ts">
import { ref } from 'vue'
import { EXAMPLES, playLoop, runExample } from './examples'

/**
 * First-time examples · Fan: Pablo's hand of cards (parts/StarterCards.vue)
 * as he drew it: same size, spread, tilt, lift and shimmer, with the
 * example's type and run time under its name. Hovering a card straightens
 * it and lifts it; picking one runs it on Comfy Cloud.
 */
const hovered = ref<number | null>(null)
const mid = (EXAMPLES.length - 1) / 2

/** Fanned like a hand of cards. Hover lifts an inner layer only (CSS),
 *  so the hit area never slips out from under the cursor. */
function pose(i: number): Record<string, string> {
  const d = i - mid
  return {
    // Hovered card straightens up; the rest keep their angle.
    transform: `translate(${d * 112}px, ${Math.abs(d) * 12}px) rotate(${hovered.value === i ? 0 : d * 6}deg)`,
    zIndex: String(hovered.value === i ? 20 : 10 - Math.abs(Math.round(d)))
  }
}
function enter(i: number, e: Event): void {
  hovered.value = i
  playLoop(e.currentTarget as Element, true)
}
</script>

<template>
  <div
    class="relative mx-auto h-62 w-full"
    role="list"
    aria-label="Examples"
    @mouseleave="hovered = null"
  >
    <button
      v-for="(x, i) in EXAMPLES"
      :key="x.label"
      type="button"
      role="listitem"
      class="starter group absolute top-4 left-1/2 -ml-[78px] h-52 w-39 rounded-card p-0 text-left outline-none transition-transform duration-500 ease-(--ease-out-expo) focus-visible:ring-2 focus-visible:ring-border-focus"
      :style="pose(i)"
      @mouseenter="enter(i, $event)"
      @mouseleave="playLoop($event.currentTarget as Element, false)"
      @focus="enter(i, $event)"
      @blur="playLoop($event.currentTarget as Element, false)"
      @click="runExample(x)"
    >
      <span
        class="lift relative block size-full overflow-hidden rounded-card border border-white/10 bg-card-background shadow-[0_18px_40px_-18px_rgb(0_0_0/0.8)] transition-transform duration-300 ease-(--ease-out-expo)"
      >
        <img :src="x.src" alt="" class="absolute inset-0 size-full object-cover" />
        <video
          v-if="x.video"
          :src="x.video"
          muted
          loop
          playsinline
          preload="none"
          class="loop absolute inset-0 size-full object-cover"
        />
        <span
          class="absolute inset-0 bg-[linear-gradient(180deg,transparent_45%,rgb(0_0_0/0.75))]"
        />
        <span class="shimmer pointer-events-none absolute inset-0" />
        <span class="absolute inset-x-3 bottom-3 flex flex-col gap-0.5">
          <span class="text-ui leading-snug font-medium text-white">{{ x.label }}</span>
          <span class="text-[11px] text-white/65">{{ x.kind }} · {{ x.runs }}</span>
        </span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.starter {
  --ease-out-expo: cubic-bezier(0.19, 1, 0.22, 1);
}
.loop {
  opacity: 0;
  transition: opacity 300ms ease;
}
/* Hover: a small lift and 2% scale on the inner layer, mouse only. */
@media (hover: hover) and (pointer: fine) {
  .starter:hover .lift {
    transform: translateY(-6px) scale(1.02);
  }
  .starter:hover .loop {
    opacity: 1;
  }
}
.starter:focus-visible .lift {
  transform: translateY(-6px) scale(1.02);
}
.starter:focus-visible .loop {
  opacity: 1;
}
/* Shimmer: a faint band passes every few seconds, staggered per card. */
.shimmer {
  background: linear-gradient(
    105deg,
    transparent 40%,
    rgb(255 255 255 / 0.07) 50%,
    transparent 60%
  );
  background-size: 250% 100%;
  background-position: 150% 0;
  animation: sweep 9s cubic-bezier(0.645, 0.045, 0.355, 1) infinite;
}
.starter:nth-child(2) .shimmer {
  animation-delay: 0.6s;
}
.starter:nth-child(3) .shimmer {
  animation-delay: 1.2s;
}
.starter:nth-child(4) .shimmer {
  animation-delay: 1.8s;
}
.starter:nth-child(5) .shimmer {
  animation-delay: 2.4s;
}
@keyframes sweep {
  0% {
    background-position: 150% 0;
  }
  25%,
  100% {
    background-position: -100% 0;
  }
}
/* Reduced motion: no sweep, no movement; keep the instant hover state. */
@media (prefers-reduced-motion: reduce) {
  .shimmer {
    animation: none;
  }
  .starter,
  .lift,
  .loop {
    transition: none;
  }
}
</style>
