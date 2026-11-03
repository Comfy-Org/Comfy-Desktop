<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import Select from '@comfyorg/design-system/select/Select'
import SelectContent from '@comfyorg/design-system/select/SelectContent'
import SelectItem from '@comfyorg/design-system/select/SelectItem'
import SelectTrigger from '@comfyorg/design-system/select/SelectTrigger'
import SelectValue from '@comfyorg/design-system/select/SelectValue'

export interface BaseSelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

interface Props {
  modelValue: string
  options: BaseSelectOption[]
  ariaLabel?: string
  placeholder?: string
  loading?: boolean
  loadingLabel?: string
  disabled?: boolean
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  ariaLabel: undefined,
  placeholder: '',
  loading: false,
  loadingLabel: '',
  disabled: false,
  compact: false
})
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
defineOptions({ inheritAttrs: false })

const open = ref(false)
// Reka reserves an empty string for clearing the selection. Desktop uses it for
// choices such as "All", so map every option through a stable per-control prefix.
const prefix = useId()
const choices = computed(() =>
  props.options.map((option, index) => ({ ...option, key: `${prefix}-${index}` }))
)
const selected = computed(() => choices.value.find((option) => option.value === props.modelValue))
const triggerLabel = computed(() =>
  props.loading && props.loadingLabel
    ? props.loadingLabel
    : (selected.value?.label ?? props.placeholder)
)

function select(value: unknown): void {
  const option = choices.value.find((option) => option.key === value)
  if (option && !option.disabled) emit('update:modelValue', option.value)
}

let suppressFocusReturn = false
function onWindowBlur(): void {
  // Clicking another Electron view is outside this document; the shared
  // dismissable layer cannot observe that pointer event.
  if (!open.value) return
  suppressFocusReturn = true
  open.value = false
}
function onCloseAutoFocus(event: Event): void {
  if (suppressFocusReturn) event.preventDefault()
  suppressFocusReturn = false
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  open.value = false
}
onMounted(() => window.addEventListener('blur', onWindowBlur))
onBeforeUnmount(() => window.removeEventListener('blur', onWindowBlur))
</script>

<template>
  <Select
    v-model:open="open"
    :model-value="selected?.key"
    :disabled="disabled"
    @update:model-value="select"
  >
    <SelectTrigger
      v-bind="$attrs"
      class="ui-select-trigger data-[state=open]:hover:bg-secondary"
      :class="{ 'ui-select-trigger--compact': compact }"
      :size="compact ? 'md' : 'lg'"
      :aria-label="ariaLabel"
      :aria-busy="loading || undefined"
    >
      <SelectValue class="ui-select-label" :placeholder="placeholder">{{
        triggerLabel
      }}</SelectValue>
    </SelectTrigger>
    <SelectContent
      class="ui-select-listbox z-[9999] mt-0 max-h-[min(280px,var(--reka-select-content-available-height))] w-min min-w-[var(--reka-select-trigger-width)] bg-popover [overflow-wrap:anywhere]"
      :class="{ 'ui-select-listbox--compact': compact }"
      :side-offset="2"
      :collision-padding="8"
      :aria-label="ariaLabel"
      :body-lock="false"
      :disable-outside-pointer-events="false"
      @keydown.capture="onKeydown"
      @close-auto-focus="onCloseAutoFocus"
    >
      <SelectItem
        v-for="option in choices"
        :key="option.key"
        :value="option.key"
        :disabled="option.disabled"
        :text-value="option.label"
        class="ui-select-option"
        :class="compact ? 'py-1.5 text-xs' : 'py-2'"
        text-class="min-w-0 whitespace-normal"
      >
        <span class="ui-select-option-body flex min-w-0 flex-col gap-0.5">
          <span class="ui-select-option-label">{{ option.label }}</span>
          <span
            v-if="option.description"
            class="ui-select-option-desc text-xs text-muted-foreground"
          >
            {{ option.description }}
          </span>
        </span>
      </SelectItem>
    </SelectContent>
  </Select>
</template>
