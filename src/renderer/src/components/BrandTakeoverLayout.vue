<script setup lang="ts">
// Takeover chrome shared across the brand-refreshed first-use screens.
// Owns the teleport-to-body root, fixed full-viewport positioning, fade-in,
// the top-left logo, and the dialog a11y baseline (role, aria-modal, focus
// capture/restore). Background visuals live in BrandBackground.vue.
// Forces dark; light-mode brand parity is deferred.
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import ComfyCLogo from './icons/ComfyCLogo.vue'
import BrandBackground from './BrandBackground.vue'

withDefaults(
  defineProps<{
    theme?: 'dark' | 'light'
    vignette?: boolean
    scrollContent?: boolean
    ariaLabel?: string
  }>(),
  { theme: 'dark', vignette: false, scrollContent: false, ariaLabel: undefined }
)

const rootRef = ref<HTMLElement | null>(null)
let returnFocusTo: HTMLElement | null = null

function focusFirstInteractive(): void {
  if (!rootRef.value) return
  // Honor an explicit opt-in (e.g. a text input that should be ready to type),
  // otherwise focus the dialog container itself — not the first button. This
  // keeps focus trapped for keyboard/AT users without painting a focus-visible
  // ring on a control the user didn't tab to. They Tab from here to reach it.
  const explicit = rootRef.value.querySelector<HTMLElement>('[autofocus]')
  ;(explicit ?? rootRef.value).focus()
}

onMounted(() => {
  returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  void nextTick(focusFirstInteractive)
})

onBeforeUnmount(() => {
  try {
    returnFocusTo?.focus()
  } catch {
    /* trigger element was removed while takeover was open */
  }
  returnFocusTo = null
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="rootRef"
      class="brand-takeover-root fixed inset-0 z-50 flex animate-brand-takeover focus:outline-none motion-reduce:animate-none"
      :data-theme="theme"
      role="dialog"
      aria-modal="true"
      :aria-label="ariaLabel"
      tabindex="-1"
    >
      <BrandBackground :vignette="vignette" :scroll-content="scrollContent">
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
    </div>
  </Teleport>
</template>
