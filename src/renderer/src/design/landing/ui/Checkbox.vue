<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'

/** `overlay` sits on imagery (gallery selection); `default` on surfaces. */
const { variant = 'default', class: className } = defineProps<{
  variant?: 'default' | 'overlay'
  class?: HTMLAttributes['class']
}>()
const model = defineModel<boolean>({ default: false })
</script>

<template>
  <CheckboxRoot
    v-model="model"
    :class="
      cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-min border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus',
        'data-[state=checked]:border-inverted-background data-[state=checked]:bg-inverted-background data-[state=checked]:text-inverted-foreground',
        variant === 'overlay'
          ? 'size-6 border-white/50 bg-media-overlay backdrop-blur-sm'
          : 'border-border-strong bg-secondary-background',
        className
      )
    "
  >
    <CheckboxIndicator><Check :size="13" /></CheckboxIndicator>
  </CheckboxRoot>
</template>
