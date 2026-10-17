<script setup lang="ts">
import { Search, X } from 'lucide-vue-next'
import { useTemplateRef } from 'vue'
import type { HTMLAttributes } from 'vue'
import { cn } from '../cn'
import { fieldClass, fieldInputClass } from './field.variants'

const {
  placeholder,
  clearLabel,
  class: className
} = defineProps<{
  placeholder: string
  /** Accessible name of the clear button. */
  clearLabel: string
  class?: HTMLAttributes['class']
}>()
const model = defineModel<string>({ default: '' })
const input = useTemplateRef<HTMLInputElement>('input')

function clear(): void {
  model.value = ''
  input.value?.focus()
}
</script>

<template>
  <label :class="cn(fieldClass, 'cursor-text', className)">
    <Search :size="14" class="shrink-0 text-subtle-foreground" aria-hidden="true" />
    <input
      ref="input"
      v-model="model"
      type="search"
      :placeholder
      :aria-label="placeholder"
      :class="cn(fieldInputClass, '[&::-webkit-search-cancel-button]:hidden')"
      @keydown.esc="clear"
    />
    <button
      v-if="model"
      type="button"
      :aria-label="clearLabel"
      class="-mr-1 inline-flex size-5 items-center justify-center rounded-min text-subtle-foreground outline-none hover:bg-secondary-background hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
      @click="clear"
    >
      <X :size="12" />
    </button>
  </label>
</template>
