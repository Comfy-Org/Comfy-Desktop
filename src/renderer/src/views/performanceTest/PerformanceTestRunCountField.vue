<script setup lang="ts">
import Input from '@comfyorg/design-system/input/Input'
import InfoTooltip from '../../components/InfoTooltip.vue'
import { clampRunCount, type RunCountLimits } from '../../lib/performanceTestResults'

const props = defineProps<{
  id: string
  label: string
  hint: string
  limits: RunCountLimits
}>()

const count = defineModel<string>({ required: true })

function commit(event?: Event): void {
  const input = event?.target instanceof HTMLInputElement ? event.target : undefined
  const corrected = String(clampRunCount(input?.value ?? count.value, props.limits))
  if (input) input.value = corrected
  count.value = corrected
}
</script>

<template>
  <div
    class="performance-test__setting inline-flex h-8 items-center gap-1.5 rounded-lg bg-secondary pr-1 pl-3 text-[13px]/5 transition-colors focus-within:bg-accent hover:bg-accent"
  >
    <span class="inline-flex shrink-0 items-center text-subtle-foreground">
      <label :for="id" class="whitespace-nowrap">{{ label }}</label>
      <InfoTooltip :text="hint" icon="info" />
    </span>
    <Input
      :id="id"
      class="h-6 w-9 flex-none [appearance:textfield] rounded-md border-0 bg-transparent p-0 text-center text-[13px] tabular-nums shadow-none focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      :model-value="count"
      type="number"
      :min="limits.min"
      :max="limits.max"
      step="1"
      @update:model-value="count = String($event ?? '')"
      @change="commit"
      @blur="commit"
    />
  </div>
</template>
