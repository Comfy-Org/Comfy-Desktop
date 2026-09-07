<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
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
  <button
    type="button"
    role="switch"
    class="bt-switch"
    :data-state="visualOn ? 'checked' : 'unchecked'"
    :aria-checked="visualOn"
    :aria-label="field.label"
    :aria-disabled="blocked"
    :aria-describedby="blocked && blockedReason ? descriptionId : undefined"
    :title="blockedReason"
    @click="handleClick"
  >
    <span class="bt-track" :aria-hidden="true">
      <span class="bt-thumb"></span>
    </span>
    <!-- `title` is mouse-only, so the reason is repeated here for the accessibility tree.
         `aria-label` above owns the accessible NAME, so this text cannot leak into it. -->
    <span v-if="blocked && blockedReason" :id="descriptionId" class="bt-blocked-reason">
      {{ blockedReason }}
    </span>
  </button>
</template>

<style scoped>
.bt-switch {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
}

/* Keys on aria-disabled, not :disabled — the control stays focusable, so the native
   pseudo-class no longer matches and the blocked state would otherwise look enabled. */
.bt-switch[aria-disabled='true'] {
  cursor: not-allowed;
  opacity: 0.45;
}

/* Reachable by screen readers via aria-describedby, without adding visible copy to a row
   whose blocked state is already conveyed by the dimming and the tooltip. */
.bt-blocked-reason {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.bt-track {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background-color: rgba(120, 120, 128, 0.32);
  transition: background-color 200ms ease;
}

.bt-switch[data-state='checked'] .bt-track {
  background-color: var(--accent-primary);
}

.bt-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #ffffff;
  border-radius: 50%;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.2),
    0 1px 1px rgba(0, 0, 0, 0.08);
  transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
  transform: translateX(0);
}

.bt-switch[data-state='checked'] .bt-thumb {
  transform: translateX(16px);
}

@media (prefers-reduced-motion: reduce) {
  .bt-track,
  .bt-thumb {
    transition-duration: 0ms;
  }
}
</style>
