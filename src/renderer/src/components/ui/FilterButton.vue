<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import { ChevronDown } from 'lucide-vue-next'

defineProps<{
  label: string
  value?: string | null
  placeholder: string
}>()
</script>

<template>
  <Button
    class="filter-button min-w-0 gap-1.5 px-3 text-[13px]/5"
    variant="secondary"
    size="md"
    type="button"
  >
    <span class="filter-button__label shrink-0 text-subtle-foreground">{{ label }}</span>
    <slot>
      <span class="filter-button__value truncate" :class="{ 'text-muted-foreground': !value }">
        {{ value || placeholder }}
      </span>
    </slot>
    <ChevronDown :size="14" class="ml-auto shrink-0" aria-hidden="true" />
  </Button>
</template>
