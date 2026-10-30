<script setup lang="ts">
// Icon button that copies `value` (or `getValue()`) to the clipboard,
// swapping Copy → Check briefly on success. Use `getValue` for lazy strings.
import { ref, computed, onBeforeUnmount } from 'vue'
import { Copy, Check } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'

interface Props {
  value?: string
  getValue?: () => string
  size?: number
  ariaLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  value: undefined,
  getValue: undefined,
  size: 14,
  ariaLabel: 'Copy to clipboard'
})

const copied = ref(false)
const COPIED_RESET_MS = 1600
let resetTimer: ReturnType<typeof setTimeout> | null = null

function clearResetTimer(): void {
  if (resetTimer) {
    clearTimeout(resetTimer)
    resetTimer = null
  }
}

async function handleClick(): Promise<void> {
  const text = props.value ?? props.getValue?.() ?? ''
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    clearResetTimer()
    resetTimer = setTimeout(() => {
      copied.value = false
      resetTimer = null
    }, COPIED_RESET_MS)
  } catch {
    // Stay silent on clipboard failure: the text is still selectable for
    // manual copy, so a toast would be noisier than the failure warrants.
  }
}

onBeforeUnmount(clearResetTimer)

const Icon = computed(() => (copied.value ? Check : Copy))
</script>

<template>
  <Button
    type="button"
    variant="textonly"
    size="unset"
    class="base-copy-button appearance-none rounded-md border border-solid border-transparent bg-transparent p-1 transition-[color,background-color,border-color] duration-[160ms] ease-[ease] hover:border-[var(--brand-surface-border,rgba(255,255,255,0.08))] hover:bg-[var(--brand-surface-bg,rgba(255,255,255,0.06))] focus-visible:border-[var(--brand-surface-border,rgba(255,255,255,0.08))] focus-visible:bg-[var(--brand-surface-bg,rgba(255,255,255,0.06))] focus-visible:outline-none focus-visible:ring-0"
    :class="
      copied
        ? 'is-copied text-[var(--semantic-success,var(--neutral-50))] hover:text-[var(--semantic-success,var(--neutral-50))] focus-visible:text-[var(--semantic-success,var(--neutral-50))]'
        : 'text-neutral-400 hover:text-neutral-200 focus-visible:text-neutral-200'
    "
    :aria-label="ariaLabel"
    :title="ariaLabel"
    @click="handleClick"
  >
    <component :is="Icon" :size="size" />
  </Button>
</template>
