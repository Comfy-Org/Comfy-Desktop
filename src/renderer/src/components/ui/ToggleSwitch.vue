<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui'

const { disabled = false, readonly = false } = defineProps<{
  disabled?: boolean
  readonly?: boolean
}>()

const model = defineModel<boolean>({ default: false })

function update(next: boolean): void {
  if (readonly) return
  model.value = next
}
</script>

<template>
  <SwitchRoot
    data-slot="toggle-switch"
    :model-value="model"
    :disabled="disabled"
    :aria-readonly="readonly || undefined"
    class="group inline-flex h-6 w-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none disabled:cursor-not-allowed disabled:opacity-45 aria-readonly:cursor-default aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
    @update:model-value="update"
  >
    <span
      data-slot="toggle-switch-track"
      class="pointer-events-none inline-flex h-5 w-9 items-center rounded-full bg-foreground/20 p-0.5 transition-colors duration-200 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-ring group-data-[state=checked]:bg-foreground motion-reduce:transition-none"
    >
      <SwitchThumb
        data-slot="toggle-switch-knob"
        class="pointer-events-none block size-4 rounded-full bg-foreground shadow-[0_1px_2px_oklch(0_0_0/0.35),0_1px_1px_oklch(0_0_0/0.1)] transition-[translate,background-color] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] data-[state=checked]:translate-x-4 data-[state=checked]:bg-background data-[state=checked]:shadow-none motion-reduce:transition-none"
      />
    </span>
  </SwitchRoot>
</template>
