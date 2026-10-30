<script setup lang="ts">
// Shared backdrop for the dashboard, onboarding, progress and performance
// screens. The content wash and overhead light follow the Desktop redesign;
// the existing frame, beams and content layout are preserved.
import beamSvg from '../assets/lighting/beam.svg?raw'
import beam2Svg from '../assets/lighting/beam_2.svg?raw'
import contentWashUrl from '../assets/lighting/content-wash.svg?url'

const contentWashStyle = { '--content-wash': `url("${contentWashUrl}")` }

// Bound the glow to the frame while keeping its fade at fixed design positions.
const surfaceLightingClasses = [
  '[--content-lighting:linear-gradient(180deg,oklch(1_0_0/0.035),oklch(1_0_0/0.012)_260px,transparent_520px),var(--content-wash)_center/100%_100%_no-repeat]',
  'before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:max-h-[900px] before:content-[""]',
  '[--content-glow:radial-gradient(900px_560px_at_20%_-14%,oklch(0.82_0.035_285/0.08),transparent_62%),radial-gradient(800px_500px_at_90%_-10%,oklch(1_0_0/0.03),transparent_60%)] before:[background:var(--content-glow)]',
  'before:[mask-image:linear-gradient(to_bottom,black_495px,transparent_900px)]'
]

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
          surfaceLightingClasses,
          vignette
            ? 'brand-inner-frame--vignette [background:var(--content-lighting),radial-gradient(circle_196px_at_50%_50%,var(--neutral-950)_0%,var(--neutral-950)_35%,var(--color-content-background)_100%)]'
            : '[background:var(--content-lighting),var(--color-content-background)]',
          scrollContent
            ? 'brand-inner-frame--scroll-content justify-start overflow-y-auto'
            : 'justify-center'
        ]"
        :style="contentWashStyle"
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
