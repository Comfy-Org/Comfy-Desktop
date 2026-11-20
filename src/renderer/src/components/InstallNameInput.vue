<script setup lang="ts">
import InputGroup from '@comfyorg/design-system/input-group/InputGroup'
import InputGroupInput from '@comfyorg/design-system/input-group/InputGroupInput'
import { Pencil } from '@lucide/vue'

const props = defineProps<{
  modelValue: string
  placeholder: string
  error: string
  initialFocus?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

let valueBeforeEditing = ''

function nameInput(target: EventTarget | null): HTMLInputElement | null {
  return (target as HTMLElement | null)?.closest('.config-input')?.querySelector('input') ?? null
}

function startEditing(event: FocusEvent): void {
  valueBeforeEditing = props.modelValue
  ;(event.target as HTMLInputElement).select()
}

function focusFromGroup(event: MouseEvent): void {
  const input = nameInput(event.target)
  if (input && event.target !== input) input.focus()
}

function finishEditing(event: KeyboardEvent): void {
  ;(event.target as HTMLInputElement).blur()
}

function cancelEditing(event: KeyboardEvent): void {
  emit('update:modelValue', valueBeforeEditing)
  ;(event.target as HTMLInputElement).blur()
}
</script>

<template>
  <InputGroup
    class="config-input -my-1.5 -ml-2.5 h-7 w-fit max-w-[360px] cursor-text justify-self-start gap-1.5 bg-transparent pr-2.5 transition-colors duration-150 hover:bg-white/8 focus-within:bg-secondary"
    :class="{ 'config-input--invalid': error }"
    data-testid="install-name-field"
    @click="focusFromGroup"
  >
    <InputGroupInput
      id="inst-name-standalone"
      class="min-w-[4ch] flex-none pr-0 pl-2.5 text-[13px] text-neutral-100 [field-sizing:content]"
      :data-initial-focus="initialFocus || undefined"
      :model-value="modelValue"
      type="text"
      :placeholder="placeholder"
      :aria-invalid="!!error"
      :aria-describedby="error ? 'inst-name-error' : undefined"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @focus="startEditing"
      @keydown.enter.prevent="finishEditing"
      @keydown.esc.stop.prevent="cancelEditing"
    />
    <Pencil
      :size="11"
      class="shrink-0 text-subtle-foreground"
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
