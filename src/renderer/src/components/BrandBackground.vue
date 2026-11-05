<script setup lang="ts">
// Brand-refresh backdrop (frame + angled SVG beams), extracted from
// BrandTakeoverLayout so non-takeover surfaces can reuse the visuals
// without the takeover chrome. Forces dark; the brand palette is dark-only.
import { ref, watch } from 'vue'
import beamSvg from '../assets/lighting/beam.svg?raw'
import beam2Svg from '../assets/lighting/beam_2.svg?raw'

const props = withDefaults(
  defineProps<{
    vignette?: boolean
    scrollContent?: boolean
  }>(),
  { vignette: false, scrollContent: false }
)

const innerFrameRef = ref<HTMLElement | null>(null)
const scrollAreaRef = ref<HTMLElement | null>(null)

// The non-scrolling frame is still a scroll container (overflow: hidden), and
// the beams give it a scroll range. Without this, a step that scrolled hands
// its offset to the next, non-scrolling step, which then sits shifted up with
// no way to scroll back. The scroll area is reset on the way in instead: once
// scrolling is off it is display: contents and has no box to reset.
watch(
  () => props.scrollContent,
  (scrolls) => {
    if (scrolls) {
      if (scrollAreaRef.value) scrollAreaRef.value.scrollTop = 0
    } else if (innerFrameRef.value) {
      innerFrameRef.value.scrollTop = 0
    }
  },
  { flush: 'post' }
)
</script>

<template>
  <div class="brand-background" data-theme="dark">
    <div class="brand-outer-frame">
      <div
        ref="innerFrameRef"
        class="brand-inner-frame"
        :class="{
          'brand-inner-frame--vignette': vignette,
          'brand-inner-frame--scroll-content': scrollContent
        }"
      >
        <div class="brand-beam" aria-hidden="true" v-html="beamSvg" />
        <div class="brand-beam brand-beam--2" aria-hidden="true" v-html="beam2Svg" />
        <!-- In scroll mode the step content scrolls here, apart from the beams:
             they are taller than the window and would otherwise stretch the
             scroll range past the end of the content. Always rendered (not
             v-if) so toggling scroll mode never remounts the step. -->
        <div
          ref="scrollAreaRef"
          class="brand-scroll-area"
          :class="{ 'brand-scroll-area--active': scrollContent }"
        >
          <slot />
        </div>
      </div>
      <slot name="footer-left" />
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.brand-background {
  display: flex;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  background: var(--neutral-900);
}

.brand-outer-frame {
  position: relative;
  flex: 1 1 auto;
  display: flex;
}

.brand-beam {
  position: absolute;
  position-anchor: --brand-beam-torch;
  top: -17%;
  left: anchor(center, clamp(39%, calc(52.5vw - 135px), 44%));
  pointer-events: none;
  z-index: -1;
  overflow: visible;
  transform: translateX(-50%);
}
.brand-beam--2 {
  position-anchor: --brand-beam-target;
  anchor-name: --brand-beam-torch;
  top: -10%;
  left: anchor(end, clamp(45%, calc(56vw - 115px), 50%));
}
.brand-beam :deep(svg) {
  display: block;
  overflow: visible;
}

.brand-inner-frame {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: clamp(2rem, 5vw, 48px);
  border-radius: 8px;
  background: var(--neutral-800);
  overflow: hidden;
  isolation: isolate;
}

.brand-inner-frame--vignette {
  background:
    radial-gradient(circle 196px at 50% 50%, #151317 0%, #151317 35%, var(--neutral-800) 100%),
    var(--neutral-800);
}
.brand-inner-frame--scroll-content {
  justify-content: flex-start;
  padding: 0;
}

/* Inactive: no box of its own, so the step lays out in the frame as before. */
.brand-scroll-area {
  display: contents;
}
.brand-scroll-area--active {
  position: relative;
  flex: 1 1 auto;
  align-self: stretch;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: clamp(2rem, 5vw, 48px);
  overflow-x: hidden;
  overflow-y: auto;
}
</style>
