<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Switch from '@comfyorg/design-system/switch/Switch'
import type { DetailField } from '../../types/ipc'

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
const descriptionId = useId()

function handleUpdate(next: boolean): void {
  if (blocked.value) return
  visualOn.value = next
  emit('update', next)
}
</script>

<template>
  <Switch
    class="bt-switch aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
    :model-value="visualOn"
    :readonly="blocked"
    :aria-label="field.label"
    :aria-disabled="blocked"
    :aria-describedby="blocked && blockedReason ? descriptionId : undefined"
    :title="blockedReason"
    @update:model-value="handleUpdate"
  />
  <span v-if="blocked && blockedReason" :id="descriptionId" class="bt-blocked-reason sr-only">
    {{ blockedReason }}
  </span>
</template>
