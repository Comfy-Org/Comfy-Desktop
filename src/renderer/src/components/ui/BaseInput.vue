<script setup lang="ts">
import { computed, useSlots } from 'vue'
import InputGroup from '@comfyorg/design-system/input-group/InputGroup'
import InputGroupAddon from '@comfyorg/design-system/input-group/InputGroupAddon'
import InputGroupInput from '@comfyorg/design-system/input-group/InputGroupInput'

interface Props {
  modelValue: string
  placeholder?: string
  ariaLabel?: string
  mono?: boolean
  readonly?: boolean
  invalid?: boolean
  /** Forwarded to the native input; pass false to suppress the red squiggly
   *  spell-check underline on non-prose fields (e.g. CLI args). */
  spellcheck?: boolean
  type?: string
  // Only meaningful when `type === 'number'`.
  min?: number
  max?: number
  step?: number
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '',
  ariaLabel: undefined,
  mono: false,
  readonly: false,
  invalid: false,
  spellcheck: undefined,
  type: 'text',
  min: undefined,
  max: undefined,
  step: undefined
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const slots = useSlots()
const hasLeading = computed(() => !!slots.leading)
const hasTrailing = computed(() => !!slots.trailing)

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function onChange(event: Event): void {
  emit('change', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <InputGroup
    class="ui-input"
    :data-mono="mono ? '' : undefined"
    :data-readonly="readonly ? '' : undefined"
    :data-invalid="invalid ? '' : undefined"
    :data-leading="hasLeading ? '' : undefined"
    :data-trailing="hasTrailing ? '' : undefined"
  >
    <InputGroupAddon v-if="hasLeading" class="ui-input-leading" align="inline-start">
      <slot name="leading" />
    </InputGroupAddon>
    <InputGroupInput
      class="ui-input-control"
      :class="{ 'font-mono': mono, 'cursor-default text-muted-foreground': readonly }"
      :type="type"
      :model-value="modelValue"
      :placeholder="placeholder"
      :aria-label="ariaLabel"
      :aria-invalid="invalid || undefined"
      :spellcheck="spellcheck"
      :readonly="readonly"
      :min="min"
      :max="max"
      :step="step"
      @input="onInput"
      @change="onChange"
    />
    <InputGroupAddon v-if="hasTrailing" class="ui-input-trailing" align="inline-end">
      <slot name="trailing" />
    </InputGroupAddon>
  </InputGroup>
</template>
