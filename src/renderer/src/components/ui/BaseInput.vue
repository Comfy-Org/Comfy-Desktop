<script setup lang="ts">
import { computed, useSlots } from 'vue'

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

const slotButtonClass =
  '[&_button]:inline-flex [&_button]:size-7 [&_button]:items-center [&_button]:justify-center [&_button]:rounded-md [&_button]:border-none [&_button]:bg-transparent [&_button]:p-0 [&_button]:text-text-muted [&_button]:cursor-pointer [&_button]:transition-[color,background-color] [&_button]:duration-[150ms] [&_button]:ease-[ease] [&_button:hover]:bg-border-hover [&_button:hover]:text-text [&_button:focus-visible]:text-text [&_button:focus-visible]:outline-2 [&_button:focus-visible]:[outline-style:solid] [&_button:focus-visible]:outline-[var(--accent-primary)] [&_button:focus-visible]:outline-offset-[-2px]'

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function onChange(event: Event): void {
  emit('change', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div
    class="ui-input relative flex w-full items-center gap-2 rounded-lg border border-solid bg-neutral-800 transition-[border-color] duration-[150ms] ease-[ease]"
    :class="
      invalid
        ? 'border-danger'
        : 'border-[var(--chooser-surface-border)] focus-within:border-[var(--accent-primary)]'
    "
    :data-mono="mono ? '' : undefined"
    :data-readonly="readonly ? '' : undefined"
    :data-invalid="invalid ? '' : undefined"
    :data-leading="hasLeading ? '' : undefined"
    :data-trailing="hasTrailing ? '' : undefined"
  >
    <span
      v-if="hasLeading"
      class="ui-input-leading inline-flex shrink-0 items-center pl-2 text-text-muted"
      :class="slotButtonClass"
    >
      <slot name="leading" />
    </span>
    <input
      class="ui-input-control min-w-0 flex-1 border-none bg-transparent pt-0 pb-1.5 font-sans text-[14px] outline-none placeholder:text-neutral-100 placeholder:opacity-[0.67]"
      :class="[
        type === 'text' || type === 'number'
          ? 'mt-1.5 w-full rounded-md'
          : 'mt-0 w-auto rounded-none',
        hasLeading ? 'pl-1' : 'pl-2.5',
        hasTrailing ? 'pr-1' : 'pr-2.5',
        readonly ? 'cursor-default text-text-muted' : 'text-neutral-100'
      ]"
      :type="type"
      :value="modelValue"
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
    <span
      v-if="hasTrailing"
      class="ui-input-trailing inline-flex shrink-0 items-center pr-1.5 text-text-muted"
      :class="slotButtonClass"
    >
      <slot name="trailing" />
    </span>
  </div>
</template>
