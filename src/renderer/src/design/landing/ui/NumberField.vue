<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { Minus, Plus } from 'lucide-vue-next'
import {
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldRoot
} from 'reka-ui'
import { cn } from './cn'
import { fieldInputClass, fieldVariants, type FieldVariants } from './field.variants'

/** Number entry on the shared field shell, with − / + steppers. Arrow
 *  keys step, Page Up/Down step ×10, Home/End jump to min/max; typed values
 *  are clamped on blur. `unit` sits inside the field after the number. */
const {
  size = 'sm',
  min,
  max,
  step = 1,
  unit,
  ariaLabel,
  disabled = false,
  class: className
} = defineProps<{
  size?: FieldVariants['size']
  min?: number
  max?: number
  step?: number
  unit?: string
  ariaLabel?: string
  disabled?: boolean
  class?: HTMLAttributes['class']
}>()
const model = defineModel<number>({ required: true })
// Clearing the field mid-edit sends no value: keep the last good one.
const value = computed({
  get: () => model.value,
  set: (v: number | undefined) => {
    if (v !== undefined && Number.isFinite(v)) model.value = v
  }
})
// Wide enough for the longest value it can hold: squeezed by the unit and
// steppers, the input scrolled the second digit out of view. A definite
// width (not flex-basis 0) also keeps a fit-content field from sizing to
// the input's default ~20 characters.
const chars = computed(() =>
  Math.max(
    1,
    ...[min, max, step, model.value]
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
      .map((n) => String(n).length)
  )
)
const stepper =
  'flex size-5 shrink-0 items-center justify-center rounded-min text-muted-foreground outline-none transition-colors hover:bg-secondary-background hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus disabled:pointer-events-none disabled:opacity-40'
</script>

<template>
  <NumberFieldRoot
    v-model="value"
    :min
    :max
    :step
    :disabled
    :class="cn(fieldVariants({ size }), 'gap-1 px-1', className)"
  >
    <NumberFieldDecrement :class="stepper"><Minus :size="12" /></NumberFieldDecrement>
    <NumberFieldInput
      :aria-label="ariaLabel"
      :class="cn(fieldInputClass, 'flex-[1_0_auto] text-center tabular-nums')"
      :style="{ width: `${chars + 1}ch` }"
    />
    <span v-if="unit" class="shrink-0 text-ui text-subtle-foreground">{{ unit }}</span>
    <NumberFieldIncrement :class="stepper"><Plus :size="12" /></NumberFieldIncrement>
  </NumberFieldRoot>
</template>
