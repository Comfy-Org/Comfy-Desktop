<script setup lang="ts">
import DesktopDialogSurface from './ui/DesktopDialogSurface.vue'
import ComfyCLogo from './icons/ComfyCLogo.vue'
import BrandBackground from './BrandBackground.vue'

withDefaults(
  defineProps<{
    theme?: 'dark' | 'light'
    scrollContent?: boolean
    ariaLabel?: string
    dismissible?: boolean
  }>(),
  { theme: 'dark', scrollContent: false, ariaLabel: undefined, dismissible: false }
)

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <DesktopDialogSurface
    :open="true"
    :aria-label="ariaLabel"
    :dismiss-on-escape="dismissible"
    :dismiss-on-outside="false"
    :data-theme="theme"
    overlay-class="fixed inset-0 z-50 flex animate-brand-takeover motion-reduce:animate-none"
    content-class="brand-takeover-root flex size-full max-w-none max-h-none"
    @close="emit('close')"
  >
    <BrandBackground takeover :scroll-content="scrollContent">
      <div class="brand-logo-row absolute top-0 left-0 z-2 flex items-center px-[15px] py-4">
        <ComfyCLogo
          class="brand-logo inline-flex size-[var(--takeover-logo-size)] text-comfy-yellow"
        />
      </div>
      <div
        v-if="$slots['logo-right']"
        class="brand-logo-row brand-logo-row--right absolute top-0 right-0 z-2 flex max-w-[min(60vw,680px)] items-center justify-end py-4 pr-[clamp(16px,2.5vw,32px)] pl-[15px] [&>*]:flex [&>*]:min-h-[var(--takeover-logo-size)] [&>*]:items-center"
      >
        <slot name="logo-right" />
      </div>
      <slot />
      <template #footer-left>
        <slot name="footer-left" />
      </template>
      <template #footer>
        <slot name="footer" />
      </template>
    </BrandBackground>
  </DesktopDialogSurface>
</template>
