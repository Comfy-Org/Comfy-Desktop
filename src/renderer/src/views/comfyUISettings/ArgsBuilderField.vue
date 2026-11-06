<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import InputGroupButton from '@comfyorg/design-system/input-group/InputGroupButton'
import { Settings } from 'lucide-vue-next'
import ArgsRawInput from './ArgsRawInput.vue'
import BetaArgsPill from './BetaArgsPill.vue'
import { SETTINGS_REOPEN_EPOCH } from './settingsReopenEpoch'
import type { ComfyArgDef, DetailField } from '../../types/ipc'

interface Props {
  field: DetailField
  installationId?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  open: []
  update: [field: DetailField, value: string]
}>()

const { t } = useI18n()

const stringValue = computed(() => (props.field.value == null ? '' : String(props.field.value)))
const localValue = ref(stringValue.value)
watch(stringValue, (v) => {
  if (v !== localValue.value) localValue.value = v
})

const schema = ref<ComfyArgDef[]>([])
const schemaVersion = ref(0)
let schemaSeq = 0

async function loadSchema(id: string | undefined): Promise<void> {
  const seq = ++schemaSeq
  if (!id) {
    schema.value = []
    return
  }
  const result = await window.api.getComfyArgs(id).catch(() => null)
  if (seq !== schemaSeq) return
  schema.value = result?.args ?? []
  schemaVersion.value++
}

const reopenEpoch = inject(SETTINGS_REOPEN_EPOCH, null)
watch(
  () => [props.installationId, reopenEpoch?.value] as const,
  ([id]) => void loadSchema(id),
  { immediate: true }
)

function handleEdit(): void {
  emit('open')
}

function handleInput(value: string): void {
  localValue.value = value
}

function handleChange(value: string): void {
  emit('update', props.field, value)
}
</script>

<template>
  <ArgsRawInput
    :model-value="localValue"
    :schema="schema"
    :placeholder="t('comfyUISettings.argsPlaceholder', 'No arguments set')"
    :aria-label="field.label"
    @update:model-value="handleInput"
    @change="handleChange"
  >
    <template #trailing>
      <BetaArgsPill
        v-if="installationId"
        :installation-id="installationId"
        :args-value="stringValue"
        :schema-version="schemaVersion"
      />
      <InputGroupButton
        size="icon-sm"
        :aria-label="t('comfyUISettings.configureArgs', 'Configure arguments')"
        @click="handleEdit"
      >
        <Settings :size="14" />
      </InputGroupButton>
    </template>
  </ArgsRawInput>
</template>
