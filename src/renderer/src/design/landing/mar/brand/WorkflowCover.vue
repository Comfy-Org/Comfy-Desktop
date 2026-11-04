<script setup lang="ts">
import { computed } from 'vue'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import { ComfyWorkflow } from '../icons/comfyIcons'
import MarTrio from './MarTrio.vue'
import { LATENT_GRADE, WIRE } from './imagery'
import type { BrandedCover } from '../cover'

/**
 * A workflow's cover when there is no picture to show (workflows carry
 * none yet): one of Comfy's own brand pieces instead of a gap. `wire`:
 * a link in the colour ComfyUI draws the workflow's output type with.
 * `trio`: the brand motif, the workflow glyph in its third slab.
 * `latent`: the Latent grade as a field. `mark`: the canvas's dot grid,
 * signed with the C mark. Never a made-up picture.
 */
const {
  kind,
  category = 'image',
  name = ''
} = defineProps<{
  kind: BrandedCover
  category?: 'image' | 'video'
  name?: string
}>()

const wire = computed(() => (category === 'video' ? WIRE.latent : WIRE.image))
/** Each card bends its link a little differently, so a grid isn't cloned. */
const bend = computed(() => 18 + ([...name].reduce((n, c) => n + c.charCodeAt(0), 0) % 5) * 7)
</script>

<template>
  <div class="wfc" :class="`is-${kind}`" :style="{ '--wire': wire }" aria-hidden="true">
    <svg v-if="kind === 'wire'" class="wfc-link" viewBox="0 0 160 100" preserveAspectRatio="none">
      <path
        :d="`M18 ${50 + bend / 2} C 70 ${50 + bend / 2}, 90 ${50 - bend / 2}, 142 ${50 - bend / 2}`"
        fill="none"
        stroke="var(--wire)"
        stroke-width="2.5"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <span v-if="kind === 'wire'" class="wfc-dot is-in" :style="{ top: `${50 + bend / 2}%` }" />
    <span v-if="kind === 'wire'" class="wfc-dot is-out" :style="{ top: `${50 - bend / 2}%` }" />

    <MarTrio v-else-if="kind === 'trio'" :u="26" :icon="ComfyWorkflow" :icon-size="13" />

    <span
      v-else-if="kind === 'latent'"
      class="wfc-latent"
      :style="{ '--sh': LATENT_GRADE.shadow, '--li': LATENT_GRADE.light }"
      ><ComfyWorkflow :size="26"
    /></span>

    <ComfyWorkflow v-else :size="26" class="wfc-glyph" />

    <span v-if="kind !== 'trio'" class="wfc-sign"><ComfyCLogo :size="12" /></span>
  </div>
</template>

<style scoped>
.wfc {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
.wfc.is-mark,
.wfc.is-wire {
  background-image: radial-gradient(
    color-mix(in oklch, var(--color-base-foreground) 12%, transparent) 1px,
    transparent 1.2px
  );
  background-size: 14px 14px;
  background-position: center;
}
.wfc-link {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.wfc-dot {
  position: absolute;
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--wire);
  box-shadow: 0 0 0 3px var(--color-secondary-background);
  translate: -50% -50%;
}
.wfc-dot.is-in {
  left: 11.25%;
}
.wfc-dot.is-out {
  left: 88.75%;
}
.wfc-latent {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--sh), var(--li));
  color: oklch(0.98 0.005 85 / 0.92);
}
.wfc-glyph {
  opacity: 0.8;
}
.wfc-sign {
  position: absolute;
  right: 10px;
  bottom: 9px;
  display: flex;
  color: var(--color-subtle-foreground);
}
.is-latent .wfc-sign {
  color: oklch(0.98 0.005 85 / 0.75);
}
</style>
