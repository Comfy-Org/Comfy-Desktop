<script setup lang="ts">
import InputGroup from '@comfyorg/design-system/input-group/InputGroup'
import InputGroupInput from '@comfyorg/design-system/input-group/InputGroupInput'
import { Pencil } from '@lucide/vue'

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
  <InputGroup
    class="config-input -my-1.5 -ml-2.5 h-7 w-auto max-w-[360px] cursor-text bg-white/[0.04] pr-2.5 transition-colors duration-150 hover:bg-white/8 focus-within:bg-secondary"
    :class="{ 'config-input--invalid': error }"
  >
    <InputGroupInput
      id="inst-name-standalone"
      class="px-2.5 text-[13px] text-neutral-100"
      :data-initial-focus="initialFocus || undefined"
      :model-value="modelValue"
      type="text"
      :placeholder="placeholder"
      :aria-invalid="!!error"
      :aria-describedby="error ? 'inst-name-error' : undefined"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <Pencil
      :size="12"
      class="pointer-events-none shrink-0 text-subtle-foreground"
      aria-hidden="true"
      data-testid="install-name-edit-hint"
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
