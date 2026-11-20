<script setup lang="ts">
import InputGroup from '@comfyorg/design-system/input-group/InputGroup'
import InputGroupInput from '@comfyorg/design-system/input-group/InputGroupInput'

defineProps<{
  modelValue: string
  placeholder: string
  error: string
  initialFocus?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <InputGroup class="config-input" :class="{ 'config-input--invalid': error }">
    <InputGroupInput
      id="inst-name-standalone"
      class="text-[13px] text-neutral-100"
      :data-initial-focus="initialFocus || undefined"
      :model-value="modelValue"
      type="text"
      :placeholder="placeholder"
      :aria-invalid="!!error"
      :aria-describedby="error ? 'inst-name-error' : undefined"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </InputGroup>
  <div
    v-if="error"
    id="inst-name-error"
    class="config-field-error col-start-2 mt-1.5 text-[13px] text-[var(--danger)]"
    role="alert"
  >
    {{ error }}
  </div>
</template>
