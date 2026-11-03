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
    variant="muted-textonly"
    size="icon-sm"
    class="base-copy-button"
    :class="{ 'is-copied text-success': copied }"
    :aria-label="ariaLabel"
    :title="ariaLabel"
    @click="handleClick"
  >
    <component :is="Icon" :size="size" />
  </Button>
</template>
