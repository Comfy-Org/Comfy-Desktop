<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import type { DetailField } from '../../types/ipc'

/**
 * macOS Settings-style boolean switch. The parent field row owns the
 * label; this component renders only the switch control on the right.
 *
 * `turnOnDisabled` makes the switch one-way: an off row cannot be turned
 * on, while an on row can always be turned off. That asymmetry is the
 * point — a user whose entry condition lapsed keeps the ability to leave.
 */

interface Props {
  field: DetailField
  turnOnDisabled?: boolean
  turnOnDisabledTooltipKey?: string
}

const props = defineProps<Props>()
const { t } = useI18n()

const emit = defineEmits<{
  update: [value: boolean]
}>()

const visualOn = ref(props.field.value === true)

watch(
  () => props.field.value,
  (next) => {
    visualOn.value = next === true
  }
)

const blocked = computed(() => props.turnOnDisabled === true && !visualOn.value)
const blockedReason = computed(() =>
  blocked.value && props.turnOnDisabledTooltipKey ? t(props.turnOnDisabledTooltipKey) : undefined
)
// Per instance: a literal id would make every blocked toggle on a settings page describe the
// same element, so each one would announce the first one's reason.
const descriptionId = useId()

function handleClick(): void {
  if (blocked.value) return
  const next = !visualOn.value
  visualOn.value = next
  emit('update', next)
}
</script>

<template>
  <Button
    type="button"
    role="switch"
    variant="textonly"
    size="unset"
    class="bt-switch inline-flex shrink-0 items-center rounded-lg border-none bg-transparent p-0 hover:bg-transparent appearance-auto aria-disabled:cursor-not-allowed aria-disabled:opacity-[0.45] focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto]"
    :data-state="visualOn ? 'checked' : 'unchecked'"
    :aria-checked="visualOn"
    :aria-label="field.label"
    :aria-disabled="blocked"
    :aria-describedby="blocked && blockedReason ? descriptionId : undefined"
    :title="blockedReason"
    @click="handleClick"
  >
    <span
      class="bt-track relative inline-block h-5 w-9 rounded-[999px] transition-[background-color] duration-200 ease-[ease] motion-reduce:duration-0"
      :class="visualOn ? 'bg-[var(--accent-primary)]' : 'bg-[oklch(1_0_0/0.14)]'"
      :aria-hidden="true"
    >
      <span
        class="bt-thumb absolute top-0.5 left-0.5 size-4 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:duration-0"
        :class="
          visualOn
            ? '[transform:translateX(16px)] bg-background shadow-none'
            : '[transform:translateX(0)] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_1px_1px_rgba(0,0,0,0.08)]'
        "
      ></span>
    </span>
    <!-- `title` is mouse-only, so the reason is repeated here for the accessibility tree.
         `aria-label` above owns the accessible NAME, so this text cannot leak into it. -->
    <span v-if="blocked && blockedReason" :id="descriptionId" class="bt-blocked-reason sr-only">
      {{ blockedReason }}
    </span>
  </Button>
</template>
