<script setup lang="ts">
import { computed, ref } from 'vue'
import { hostActions, instances } from '../useProto'
import { INSTANCES, thumb } from '../mock'

/**
 * Example workflows, as a hand of cards. Picking one runs it on Comfy
 * Cloud: nothing to set up first.
 */
export interface Starter {
  label: string
  thumbId: string
}
const STARTERS: Starter[] = [
  {
    label: 'Remove a background',
    thumbId: 'api_google_nano_banana2_image_edit~start-remove-a-background'
  },
  {
    label: 'Turn a photo into video',
    thumbId: 'video_ltx2_5_i2v~start-turn-a-photo-into-video'
  },
  {
    label: 'Reshoot your product',
    thumbId: 'template_product_placement~start-reshoot-your-product'
  },
  {
    label: 'Upscale to 4K',
    thumbId: 'utility_seedvr2_image_upscale~start-upscale-to-4k'
  },
  {
    label: 'Build an API for product shots',
    thumbId: 'image_flux2~start-build-an-api-for-product-shots'
  }
]

/** `sm`: smaller cards, flatter fan (when they sit under the prompt).
 *  `items` and `onSelect` reuse the fan elsewhere (the Agent's landing). */
const {
  size = 'md',
  items,
  onSelect,
  label = 'Example workflows'
} = defineProps<{
  size?: 'sm' | 'md'
  items?: Starter[]
  onSelect?: (s: Starter) => void
  label?: string
}>()
const hovered = ref<number | null>(null)
const list = computed(() => items ?? STARTERS)
const mid = computed(() => (list.value.length - 1) / 2)

/** Fanned like a hand of cards. Hover lifts an inner layer only (CSS),
 *  so the hit area never slips out from under the cursor. */
function pose(i: number): Record<string, string> {
  const d = i - mid.value
  return {
    // Hovered card straightens up; the rest keep their angle.
    transform: `translate(${d * (size === 'sm' ? 86 : 112)}px, ${Math.abs(d) * (size === 'sm' ? 6 : 12)}px) rotate(${hovered.value === i ? 0 : d * (size === 'sm' ? 4 : 6)}deg)`,
    zIndex: String(hovered.value === i ? 20 : 10 - Math.abs(Math.round(d)))
  }
}

function pick(s: Starter): void {
  if (onSelect) return onSelect(s)
  const cloud = instances.value.find((i) => i.kind === 'cloud') ?? INSTANCES[0]!
  hostActions.launch(cloud, s.label)
}
</script>

<template>
  <div
    :class="['relative mx-auto w-full', size === 'sm' ? 'h-46' : 'h-62']"
    role="list"
    :aria-label="label"
    @mouseleave="hovered = null"
  >
    <button
      v-for="(s, i) in list"
      :key="s.label"
      type="button"
      role="listitem"
      :class="[
        'starter group absolute top-4 left-1/2 rounded-card',
        size === 'sm' ? '-ml-[60px] h-36 w-30' : '-ml-[78px] h-52 w-39'
      ]"
      class="text-left outline-none transition-transform duration-500 ease-(--ease-out-expo) focus-visible:ring-2 focus-visible:ring-border-focus"
      :style="pose(i)"
      @mouseenter="hovered = i"
      @focus="hovered = i"
      @click="pick(s)"
    >
      <span
        class="lift relative block size-full overflow-hidden rounded-card border border-white/10 bg-card-background shadow-[0_18px_40px_-18px_rgb(0_0_0/0.8)] transition-transform duration-300 ease-(--ease-out-expo)"
      >
        <img :src="thumb(s.thumbId)" alt="" class="absolute inset-0 size-full object-cover" />
        <span
          class="absolute inset-0 bg-[linear-gradient(180deg,transparent_45%,rgb(0_0_0/0.75))]"
        />
        <span class="shimmer pointer-events-none absolute inset-0" />
        <span class="absolute inset-x-3 bottom-3 text-ui leading-snug font-medium text-white">{{
          s.label
        }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.starter {
  --ease-out-expo: cubic-bezier(0.19, 1, 0.22, 1);
}
/* Hover: a small lift and 2% scale on the inner layer, mouse only. */
@media (hover: hover) and (pointer: fine) {
  .starter:hover .lift {
    transform: translateY(-6px) scale(1.02);
  }
}
.starter:focus-visible .lift {
  transform: translateY(-6px) scale(1.02);
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
  .lift {
    transition: none;
  }
}
</style>
