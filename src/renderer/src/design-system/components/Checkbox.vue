<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from '../cn'

/** Pair it with a `<label>` around it, or give it an `aria-label`. */
const { class: className } = defineProps<{ class?: HTMLAttributes['class'] }>()
const model = defineModel<boolean>({ default: false })
</script>

<template>
  <CheckboxRoot
    v-model="model"
    :class="
      cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-min border border-border-strong bg-secondary-background outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus',
        'data-[state=checked]:border-inverted-background data-[state=checked]:bg-inverted-background data-[state=checked]:text-inverted-foreground',
        className
      )
    "
  >
    <CheckboxIndicator><Check :size="13" /></CheckboxIndicator>
  </CheckboxRoot>
</template>
