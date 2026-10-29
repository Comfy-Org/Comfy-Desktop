<script setup lang="ts">
// Brand-refresh backdrop (frame + angled SVG beams), extracted from
// BrandTakeoverLayout so non-takeover surfaces can reuse the visuals
// without the takeover chrome. Forces dark; the brand palette is dark-only.
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
        class="brand-inner-frame relative isolate flex flex-auto flex-col items-center overflow-hidden rounded-lg p-[clamp(2rem,5vw,48px)]"
        :class="[
          vignette
            ? 'brand-inner-frame--vignette bg-[radial-gradient(circle_196px_at_50%_50%,var(--neutral-950)_0%,var(--neutral-950)_35%,var(--color-content-background)_100%)]'
            : 'bg-content-background',
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
