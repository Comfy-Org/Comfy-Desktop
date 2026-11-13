<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    labelFor?: string
    controlHeight?: 'field' | 'cards' | 'line'
  }>(),
  { labelFor: undefined, controlHeight: 'field' }
)
</script>

<template>
  <div
    class="setup-form-row config-form-row config-field grid grid-cols-[148px_minmax(0,1fr)] items-start gap-4"
    :class="controlHeight === 'line' ? 'py-1.5' : 'py-3'"
  >
    <label
      class="config-label text-[13px] font-medium text-text-muted"
      :class="{ 'pt-2.5': controlHeight === 'field', 'pt-3.5': controlHeight === 'cards' }"
      :for="labelFor"
      >{{ label }}</label
    >
    <div class="setup-form-row__control flex min-w-0 flex-col">
      <slot />
    </div>
  </div>
</template>
