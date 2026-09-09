<script setup lang="ts">
import { computed } from 'vue'
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
  }>(),
  {
    running: false,
    tooltipClass: undefined,
    disableWithMessage: false,
    directStyleClass: false
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
    <button
      type="button"
      :class="[
        buttonClass,
        styleClass,
        {
          'looks-disabled': action.enabled === false && action.disabledMessage,
          'is-running': running
        }
      ]"
      :disabled="disabled"
      @click="emit('action', action)"
    >
      <Loader2 v-if="running" :size="14" :class="spinnerClass" />
      {{ action.label }}
    </button>
  </TooltipWrap>
</template>
