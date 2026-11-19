<script setup lang="ts" generic="T extends string">
import ToggleGroup from '@comfyorg/design-system/toggle-group/ToggleGroup'
import ToggleGroupItem from '@comfyorg/design-system/toggle-group/ToggleGroupItem'
import { vSlidingPill } from './vSlidingPill'

defineProps<{
  options: { value: T; label: string; testId?: string }[]
  label: string
  disabled?: boolean
}>()

const model = defineModel<T>({ required: true })
</script>

<template>
  <ToggleGroup
    v-model="model"
    v-sliding-pill="'bg-accent'"
    type="single"
    :allow-empty="false"
    :disabled="disabled"
    roving-focus
    class="inline-flex shrink-0 gap-0.5 rounded-[10px] bg-secondary p-[3px]"
    :aria-label="label"
  >
    <ToggleGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :data-testid="option.testId"
      class="h-[26px] rounded-[7px] px-[11px] text-[13px] whitespace-nowrap hover:bg-transparent hover:text-foreground data-[state=on]:bg-accent data-[state=on]:hover:bg-accent"
    >
      {{ option.label }}
    </ToggleGroupItem>
  </ToggleGroup>
</template>
