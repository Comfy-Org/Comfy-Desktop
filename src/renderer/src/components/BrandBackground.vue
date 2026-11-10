<script setup lang="ts">
import filmGrainUrl from '../assets/lighting/film-grain.svg?url'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'

const filmGrainStyle = { '--film-grain': `url("${filmGrainUrl}")` }

const TAKEOVER_SPOTLIGHT_CLASS =
  '[background:var(--film-grain),radial-gradient(ellipse_55%_85%_at_50%_-15%,oklch(0.955_0.002_285/0.07),transparent_70%),radial-gradient(ellipse_45%_60%_at_50%_-15%,oklch(0.955_0.002_285/0.07),transparent_70%),oklch(0.16_0.003_285)]'

withDefaults(
  defineProps<{
    takeover?: boolean
    scrollContent?: boolean
  }>(),
  { takeover: false, scrollContent: false }
)
</script>

<template>
  <div class="brand-background flex h-full w-full flex-auto bg-background" data-theme="dark">
    <div class="brand-outer-frame relative flex flex-auto">
      <div
        class="brand-inner-frame relative isolate flex flex-auto flex-col items-center overflow-hidden rounded-lg p-[clamp(2rem,5vw,48px)]"
        :class="[
          takeover
            ? TAKEOVER_SPOTLIGHT_CLASS
            : [PAGE_SPOTLIGHT_CLASS, '[background-color:var(--color-content-background)]'],
          scrollContent
            ? 'brand-inner-frame--scroll-content justify-start overflow-y-auto'
            : 'justify-center'
        ]"
        :style="takeover ? filmGrainStyle : undefined"
      >
        <slot />
      </div>
      <slot name="footer-left" />
      <slot name="footer" />
    </div>
  </div>
</template>
