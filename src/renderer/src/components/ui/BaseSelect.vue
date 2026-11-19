<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, type Component } from 'vue'
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
  icon?: Component
  badge?: string
  testId?: string
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
  leading?: string
}

const props = withDefaults(defineProps<Props>(), {
  ariaLabel: undefined,
  placeholder: '',
  loading: false,
  loadingLabel: '',
  disabled: false,
  compact: false,
  leading: undefined
})
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
defineOptions({ inheritAttrs: false })

const open = ref(false)
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
      <component
        :is="selected.icon"
        v-if="selected?.icon"
        class="ui-select-icon mr-2.5 flex-none text-muted-foreground"
        :size="15"
        aria-hidden="true"
      />
      <span v-if="leading" class="ui-select-leading flex-none text-muted-foreground">{{
        leading
      }}</span>
      <SelectValue
        class="ui-select-label"
        :class="{ 'min-w-0 flex-1 text-left': selected?.icon }"
        :placeholder="placeholder"
        >{{ triggerLabel }}</SelectValue
      >
    </SelectTrigger>
    <SelectContent
      class="ui-select-listbox z-[9999] mt-0 max-h-[min(360px,var(--reka-select-content-available-height))] w-min min-w-[var(--reka-select-trigger-width)] border bg-popover p-1 shadow-lg [overflow-wrap:anywhere]"
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
        :data-testid="option.testId"
        class="ui-select-option mt-0.5 min-h-7 shrink-0 rounded-md px-3 py-1.5 first:mt-0 data-[state=checked]:data-highlighted:bg-accent"
        :class="{ 'text-xs': compact, 'py-2': option.description }"
        text-class="min-w-0 whitespace-normal"
      >
        <span class="ui-select-option-row flex min-w-0 items-start gap-2.5">
          <component
            :is="option.icon"
            v-if="option.icon"
            class="ui-select-option-icon mt-0.5 flex-none text-muted-foreground"
            :size="15"
            aria-hidden="true"
          />
          <span class="ui-select-option-body flex min-w-0 flex-col gap-0.5">
            <span class="ui-select-option-label flex min-w-0 items-center gap-2"
              >{{ option.label
              }}<span
                v-if="option.badge"
                class="ui-select-option-badge flex-none rounded-[4px] bg-white/16 px-1.5 py-0.5 text-[10px] leading-[14px] font-semibold tracking-[0.04em] text-text-muted uppercase"
                >{{ option.badge }}</span
              ></span
            >
            <span
              v-if="option.description"
              class="ui-select-option-desc text-xs text-muted-foreground"
            >
              {{ option.description }}
            </span>
          </span>
        </span>
      </SelectItem>
    </SelectContent>
  </Select>
</template>
