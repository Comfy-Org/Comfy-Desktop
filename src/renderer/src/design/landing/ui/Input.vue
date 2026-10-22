<script setup lang="ts">
import { ref, type HTMLAttributes } from 'vue'
import { cn } from './cn'
import { fieldInputClass, fieldVariants, type FieldVariants } from './field.variants'

defineOptions({ inheritAttrs: false })

const {
  size,
  mono = false,
  class: className
} = defineProps<{
  size?: FieldVariants['size']
  mono?: boolean
  class?: HTMLAttributes['class']
}>()
const model = defineModel<string>({ default: '' })
const input = ref<HTMLInputElement>()
defineExpose({ focus: () => input.value?.focus(), select: () => input.value?.select() })
</script>

<template>
  <label
    :class="cn(fieldVariants({ size }), 'cursor-text', className)"
    :style="$attrs.style as never"
  >
    <slot name="leading" />
    <input
      ref="input"
      v-model="model"
      type="text"
      v-bind="$attrs"
      :class="cn(fieldInputClass, mono && 'font-mono text-ui')"
    />
    <slot name="trailing" />
  </label>
</template>
