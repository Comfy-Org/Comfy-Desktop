<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(
  defineProps<{
    label: string
    labelFor?: string
    icon?: Component
    controlHeight?: 'field' | 'cards' | 'line'
  }>(),
  { labelFor: undefined, icon: undefined, controlHeight: 'field' }
)
</script>

<template>
  <div
    class="setup-form-row config-form-row config-field grid grid-cols-[148px_minmax(0,1fr)] items-start gap-4"
    :class="controlHeight === 'line' ? 'py-1.5' : 'py-3'"
  >
    <label
      class="config-label flex items-center gap-2.5 text-[13px] leading-5 text-text-muted"
      :class="{ 'pt-2.5': controlHeight === 'field', 'pt-3.5': controlHeight === 'cards' }"
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
