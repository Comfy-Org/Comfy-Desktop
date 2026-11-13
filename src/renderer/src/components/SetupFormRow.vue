<script setup lang="ts">
import { computed, type Component } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    labelFor?: string
    icon?: Component
    controlHeight?: 'field' | 'cards' | 'line' | 'centered'
  }>(),
  { labelFor: undefined, icon: undefined, controlHeight: 'field' }
)

const rowClass = computed(() => {
  if (props.controlHeight === 'line') return 'items-start py-1.5'
  if (props.controlHeight === 'centered') return 'items-center py-3'
  return 'items-start py-3'
})

const labelClass = computed(() => {
  if (props.controlHeight === 'field') return 'pt-2.5'
  if (props.controlHeight === 'cards') return 'pt-3.5'
  return ''
})
</script>

<template>
  <div
    class="setup-form-row config-form-row config-field grid grid-cols-[148px_minmax(0,1fr)] gap-4"
    :class="rowClass"
  >
    <label
      class="config-label flex items-center gap-2.5 text-[13px] leading-5 text-text-muted"
      :class="labelClass"
      :for="labelFor"
      ><component :is="icon" v-if="icon" class="flex-none" :size="15" aria-hidden="true" />{{
        label
      }}</label
    >
    <div class="setup-form-row__control flex min-w-0 flex-col">
      <slot />
    </div>
  </div>
</template>
