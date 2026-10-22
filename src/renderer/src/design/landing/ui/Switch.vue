<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui'
import { useId } from 'vue'

/** On/off control. With `label` it renders as a labelled row; without one
 *  it renders the bare switch (pass `aria-label` for inline use in lists). */
const { label, ariaLabel } = defineProps<{ label?: string; ariaLabel?: string }>()
const model = defineModel<boolean>({ default: false })
const id = useId()
const root =
  'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-secondary-background-hover p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus data-[state=checked]:bg-inverted-background'
const thumb =
  'block size-4 rounded-full bg-base-foreground shadow transition-transform duration-150 data-[state=checked]:translate-x-4 data-[state=checked]:bg-inverted-foreground'
</script>

<template>
  <div v-if="label" class="flex items-center justify-between gap-3">
    <label :for="id" class="cursor-pointer text-ui text-base-foreground">{{ label }}</label>
    <SwitchRoot :id v-model="model" :class="root"><SwitchThumb :class="thumb" /></SwitchRoot>
  </div>
  <SwitchRoot v-else v-model="model" :aria-label="ariaLabel" :class="root"
    ><SwitchThumb :class="thumb"
  /></SwitchRoot>
</template>
