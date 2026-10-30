<script setup lang="ts">
// Shared backdrop for the dashboard, onboarding, progress and performance
// screens. The content wash and overhead light follow the Desktop redesign;
// the existing frame, beams and content layout are preserved.
import beamSvg from '../assets/lighting/beam.svg?raw'
import beam2Svg from '../assets/lighting/beam_2.svg?raw'

withDefaults(
  defineProps<{
    vignette?: boolean
    scrollContent?: boolean
  }>(),
  { vignette: false, scrollContent: false }
)
</script>

<template>
  <div class="brand-background flex h-full w-full flex-auto bg-background" data-theme="dark">
    <div class="brand-outer-frame relative flex flex-auto">
      <div
        class="brand-inner-frame relative isolate flex flex-auto flex-col items-center overflow-hidden rounded-lg bg-content-background p-[clamp(2rem,5vw,48px)]"
        :class="[
          vignette ? 'brand-inner-frame--vignette' : '',
          scrollContent
            ? 'brand-inner-frame--scroll-content justify-start overflow-y-auto'
            : 'justify-center'
        ]"
      >
        <div
          class="brand-beam pointer-events-none absolute -top-[17%] -z-1 overflow-visible opacity-45 grayscale [position-anchor:--brand-beam-torch] [left:anchor(center,clamp(39%,calc(52.5vw_-_135px),44%))] [transform:translateX(-50%)] [&_svg]:block [&_svg]:overflow-visible"
          aria-hidden="true"
          v-html="beamSvg"
        />
        <div
          class="brand-beam brand-beam--2 pointer-events-none absolute -top-[10%] -z-1 overflow-visible opacity-45 grayscale [position-anchor:--brand-beam-target] [anchor-name:--brand-beam-torch] [left:anchor(end,clamp(45%,calc(56vw_-_115px),50%))] [transform:translateX(-50%)] [&_svg]:block [&_svg]:overflow-visible"
          aria-hidden="true"
          v-html="beam2Svg"
        />
        <slot />
      </div>
      <slot name="footer-left" />
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.brand-inner-frame {
  /* These layers are part of the design's content surface, not a new base
     color. Keeping them on the shared backdrop gives every main screen the
     same treatment without changing its controls or theme aliases. */
  --content-lighting:
    linear-gradient(180deg, oklch(1 0 0 / 0.035), oklch(1 0 0 / 0.012) 260px, transparent 520px),
    url('../assets/lighting/content-wash.svg') center / 100% 100% no-repeat;
  background: var(--content-lighting), var(--color-content-background);
}

.brand-inner-frame--vignette {
  background:
    var(--content-lighting),
    radial-gradient(
      circle 196px at 50% 50%,
      var(--neutral-950) 0%,
      var(--neutral-950) 35%,
      var(--color-content-background) 100%
    );
}

.brand-inner-frame::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  max-height: 900px;
  pointer-events: none;
  background:
    radial-gradient(900px 560px at 20% -14%, oklch(0.82 0.035 285 / 0.08), transparent 62%),
    radial-gradient(800px 500px at 90% -10%, oklch(1 0 0 / 0.03), transparent 60%);
  /* Fixed fade stops retain the design at shorter heights without a 900px
     pseudo-element creating extra scrollable space in small windows. */
  mask-image: linear-gradient(to bottom, black 495px, transparent 900px);
}
</style>
