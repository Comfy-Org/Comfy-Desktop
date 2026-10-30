<script setup lang="ts">
import { computed } from 'vue'
import Button from '@comfyorg/design-system/button/Button'
import { Loader2 } from 'lucide-vue-next'
import TooltipWrap from '../../components/TooltipWrap.vue'
import type { ActionDef } from '../../types/ipc'

const props = withDefaults(
  defineProps<{
    action: ActionDef
    running?: boolean
    buttonClass: string
    tooltipClass?: string
    spinnerClass: string
    disableWithMessage?: boolean
    directStyleClass?: boolean
    /** Explicit utility colors supplied by migrated callers instead of legacy style classes. */
    variantClass?: string
  }>(),
  {
    running: false,
    tooltipClass: undefined,
    disableWithMessage: false,
    directStyleClass: false,
    variantClass: undefined
  }
)

const emit = defineEmits<{ action: [action: ActionDef] }>()

const tooltipText = computed(() =>
  props.action.enabled === false && props.action.disabledMessage
    ? props.action.disabledMessage
    : props.action.tooltip
)
const disabled = computed(
  () =>
    (props.action.enabled === false &&
      (props.disableWithMessage || !props.action.disabledMessage)) ||
    props.running
)
const styleClass = computed(() => {
  if (props.variantClass !== undefined) return props.variantClass
  if (props.directStyleClass) return props.action.style
  return {
    primary: props.action.style === 'primary',
    danger: props.action.style === 'danger'
  }
})
</script>

<template>
  <TooltipWrap
    :class="tooltipClass"
    :text="tooltipText"
    :tabindex="disabled && tooltipText ? 0 : undefined"
  >
    <Button
      variant="textonly"
      size="unset"
      class="static inline-block rounded-lg border border-solid border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[14px] leading-[1.5] font-normal text-text whitespace-normal appearance-auto transition-none hover:bg-[var(--border)] focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] focus-visible:outline-[-webkit-focus-ring-color] disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40"
      type="button"
      :class="[
        buttonClass,
        styleClass,
        {
          'looks-disabled':
            variantClass === undefined && action.enabled === false && action.disabledMessage,
          'is-running': running
        }
      ]"
      :disabled="disabled"
      @click="emit('action', action)"
    >
      <Loader2 v-if="running" :size="14" :class="spinnerClass" />
      {{ action.label }}
    </Button>
  </TooltipWrap>
</template>
