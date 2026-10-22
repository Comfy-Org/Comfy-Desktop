<script setup lang="ts">
import { Search, X } from 'lucide-vue-next'
import { ref, type HTMLAttributes } from 'vue'
import { cn } from './cn'
import { fieldInputClass, fieldVariants, type FieldVariants } from './field.variants'

const {
  placeholder = 'Search',
  size,
  class: className
} = defineProps<{
  placeholder?: string
  size?: FieldVariants['size']
  class?: HTMLAttributes['class']
}>()
const model = defineModel<string>({ default: '' })
const input = ref<HTMLInputElement>()

function clear(): void {
  model.value = ''
  input.value?.focus()
}
</script>

<template>
  <label :class="cn(fieldVariants({ size }), 'cursor-text', className)">
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
      aria-label="Clear search"
      class="-mr-1 inline-flex size-5 items-center justify-center rounded-min text-subtle-foreground outline-none hover:bg-secondary-background hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
      @click="clear"
    >
      <X :size="12" />
    </button>
  </label>
</template>
