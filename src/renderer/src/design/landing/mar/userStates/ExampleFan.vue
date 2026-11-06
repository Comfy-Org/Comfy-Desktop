<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { ArrowRight } from 'lucide-vue-next'
import { go } from '../../useProto'
import { can } from '../../milestones'
import { EXAMPLES, playLoop, runExample } from './examples'

/**
 * First-time examples · Fan: Pablo's hand of cards (parts/StarterCards.vue)
 * as one centred block under the Home's centred greeting. The section's
 * title moves onto the fan's axis, and the cards carry only their picture,
 * so nothing clips under a neighbour. The hand never moves: pointing at a
 * card (or focusing it) lifts and straightens an inner layer in place,
 * shows its type chip, and the caption above, fixed on the fan's axis,
 * crossfades to its name, type, run time and "Run on Comfy Cloud"; the
 * last one stays until you leave the block.
 * Arrow keys move across the cards, Enter runs one.
 */
const root = ref<HTMLElement>()
const cards = ref<HTMLElement[]>([])
const hovered = ref<number | null>(null)
const focusIndex = ref(Math.floor(EXAMPLES.length / 2))
const eyebrow = ref('Run an example on Comfy Cloud')
const mid = (EXAMPLES.length - 1) / 2
const current = computed(() => (hovered.value === null ? null : EXAMPLES[hovered.value]!))

onMounted(() => {
  // The section's own header (left-aligned) gives its title to the fan's
  // centred caption and steps aside (global style below).
  const title = root.value?.previousElementSibling?.querySelector('h2')?.textContent
  if (title) eyebrow.value = title
})

/** Fanned like a hand of cards, symmetric and evenly spaced. The slot
 *  never changes; the active card only rises above its neighbours and its
 *  inner layer straightens (`--tilt` undoes the slot's angle), so the hit
 *  area never slips out from under the cursor. */
function pose(i: number): Record<string, string> {
  const d = i - mid
  return {
    transform: `translate(${d * 112}px, ${Math.abs(d) * 12}px) rotate(${d * 6}deg)`,
    zIndex: String(hovered.value === i ? 20 : 10 - Math.abs(Math.round(d))),
    '--tilt': `${-d * 6}deg`
  }
}

function enter(i: number, e: Event): void {
  hovered.value = i
  focusIndex.value = i
  playLoop(e.currentTarget as Element, true)
}
async function key(e: KeyboardEvent): Promise<void> {
  const by = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!by) return
  e.preventDefault()
  focusIndex.value = (focusIndex.value + by + EXAMPLES.length) % EXAMPLES.length
  await nextTick()
  cards.value[focusIndex.value]?.focus()
}
</script>

<template>
  <div ref="root" class="mar-fan2" @mouseleave="hovered = null">
    <!-- Caption, behind the fan: the prompt at rest, the card's name on hover. -->
    <div class="mar-fan2-caption" aria-live="polite">
      <Transition name="mar-fan2-swap">
        <div v-if="current" :key="current.label" class="mar-fan2-text">
          <span class="mar-fan2-eyebrow">{{ current.kind }} · {{ current.runs }}</span>
          <span class="mar-fan2-title">{{ current.label }}</span>
        </div>
        <div v-else key="rest" class="mar-fan2-text">
          <span class="mar-fan2-eyebrow">{{ eyebrow }}</span>
          <span class="mar-fan2-title is-rest">Pick an example to try</span>
        </div>
      </Transition>
    </div>

    <div class="mar-fan2-hand" role="list" aria-label="Examples" @keydown="key">
      <button
        v-for="(x, i) in EXAMPLES"
        :key="x.label"
        ref="cards"
        type="button"
        role="listitem"
        class="starter group absolute top-4 left-1/2 -ml-[78px] h-52 w-39 rounded-card p-0 text-left outline-none"
        :class="hovered === i && 'is-active'"
        :style="pose(i)"
        :tabindex="i === focusIndex ? 0 : -1"
        :aria-label="`Run ${x.label} on Comfy Cloud, ${x.kind}, ${x.runs}`"
        @mouseenter="enter(i, $event)"
        @mouseleave="playLoop($event.currentTarget as Element, false)"
        @focus="enter(i, $event)"
        @blur="playLoop($event.currentTarget as Element, false)"
        @click="runExample(x)"
      >
        <span
          class="lift relative block size-full overflow-hidden rounded-card border border-white/10 bg-card-background shadow-[0_18px_40px_-18px_rgb(0_0_0/0.8)]"
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
          <span class="shimmer pointer-events-none absolute inset-0" />
          <span class="mar-fan2-chip">{{ x.kind }}</span>
        </span>
      </button>
    </div>
    <div class="mar-fan2-action">
      <button
        v-if="current"
        type="button"
        class="mar-fan2-run"
        tabindex="-1"
        @click="runExample(current)"
      >
        Run on Comfy Cloud<ArrowRight :size="14" />
      </button>
      <button v-else-if="can.exploreApps" type="button" class="mar-fan2-all" @click="go('explore')">
        See all examples<ArrowRight :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.mar-fan2 {
  --ease-out-expo: cubic-bezier(0.19, 1, 0.22, 1);
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.mar-fan2-caption {
  position: relative;
  width: 100%;
  height: 92px;
}
.mar-fan2-text {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  text-align: center;
}
.mar-fan2-eyebrow {
  color: var(--color-subtle-foreground);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.mar-fan2-title {
  color: var(--color-base-foreground);
  font-size: 40px;
  font-weight: 600;
  letter-spacing: -0.025em;
  line-height: 1.05;
  white-space: nowrap;
}
.mar-fan2-title.is-rest {
  color: color-mix(in oklch, var(--color-base-foreground) 38%, transparent);
}
.mar-fan2-action {
  display: flex;
  height: 40px;
  align-items: center;
  justify-content: center;
}
.mar-fan2-hand {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 248px;
  /* Clear air between the caption and the lifted card. */
  margin-top: 24px;
}
.mar-fan2-chip {
  position: absolute;
  top: 10px;
  left: 10px;
  border-radius: 999px;
  padding: 2px 8px;
  background: var(--color-media-overlay);
  backdrop-filter: blur(12px);
  color: rgb(255 255 255 / 0.92);
  font-size: 11px;
  opacity: 0;
  transition: opacity 200ms ease;
}
.is-active .mar-fan2-chip {
  opacity: 1;
}
/* Crossfade: the new caption rises in as the old one settles out. */
/* Crossfade in place: the text never travels, so the caption stays put. */
.mar-fan2-swap-enter-active,
.mar-fan2-swap-leave-active {
  transition:
    opacity 240ms ease,
    filter 240ms ease;
}
.mar-fan2-swap-enter-from,
.mar-fan2-swap-leave-to {
  opacity: 0;
  filter: blur(3px);
}
.starter {
  --ease-out-expo: cubic-bezier(0.19, 1, 0.22, 1);
}
.loop {
  opacity: 0;
  transition: opacity 300ms ease;
}
/* Active (pointer or keyboard): the inner layer lifts and straightens in
   its slot; transitions are interruptible, so sweeping across stays smooth. */
.lift {
  transition:
    transform 450ms var(--ease-out-expo),
    box-shadow 300ms ease;
}
.is-active .lift {
  transform: translateY(-10px) rotate(var(--tilt)) scale(1.03);
}
.is-active .loop {
  opacity: 1;
}
.starter:focus-visible .lift {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
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
/* Reduced motion: no sweep, no movement; the caption only crossfades. */
@media (prefers-reduced-motion: reduce) {
  .shimmer {
    animation: none;
  }
  .lift,
  .loop,
  .mar-fan2-chip {
    transition: none;
  }
  /* Nothing moves: the active card keeps its slot and pose; only the
     caption crossfades. */
  .is-active .lift {
    transform: none;
  }
  .mar-fan2-swap-enter-from,
  .mar-fan2-swap-leave-to {
    filter: none;
  }
}
</style>

<style>
/* The fan carries its section's title on its own axis, so the section's
   left-aligned header steps aside. */
:root .proto-ui section:has(> .mar-fan2) > :first-child:not(.mar-fan2) {
  display: none;
}
/* Global: these are buttons, past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mar-fan2-run,
:root .proto-ui.proto-ui.proto-ui .mar-fan2-all {
  display: inline-flex;
  width: auto;
  height: 30px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-radius: var(--radius-control);
  font-size: 13px;
  font-weight: 500;
  outline: none;
  transition:
    background-color 160ms ease,
    opacity 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-fan2-run {
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-fan2-run:hover {
  opacity: 0.88;
}
:root .proto-ui.proto-ui.proto-ui .mar-fan2-all {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-fan2-all:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
}
</style>
