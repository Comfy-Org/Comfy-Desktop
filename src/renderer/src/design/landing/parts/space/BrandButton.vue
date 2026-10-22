<script setup lang="ts">
import Button from '../../ui/Button.vue'
import { currentSpace } from '../../spaces'

/** Primary action inside a client portal, in the space's brand colour
 *  (`--brand`, set by the portal shell). */
const { size = 'md', disabled = false } = defineProps<{
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
}>()
</script>

<template>
  <Button
    variant="primary"
    :size
    :disabled
    :class="[
      'rounded-(--brand-radius) bg-(--brand) text-(--on-brand) hover:bg-[color-mix(in_oklab,var(--brand)_85%,white)]',
      currentSpace.brand.theme?.uppercase && 'tracking-wider uppercase'
    ]"
  >
    <slot />
  </Button>
</template>
