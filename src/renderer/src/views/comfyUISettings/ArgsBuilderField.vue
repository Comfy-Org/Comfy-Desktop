<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Settings } from 'lucide-vue-next'
import ArgsRawInput from './ArgsRawInput.vue'
import BetaArgsPill from './BetaArgsPill.vue'
import { SETTINGS_REOPEN_EPOCH } from './settingsReopenEpoch'
import type { ComfyArgDef, DetailField } from '../../types/ipc'

/**
 * Compact summary row for the `launchArgs` field. Shows the current
 * arg string with inline autocomplete and a gear icon that opens the
 * full `ArgsBuilderPage` sub-page, after the Core beta args pill.
 */

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
/** Bumped as each schema load settles, for the beta pill's preview. */
const schemaVersion = ref(0)

async function loadSchema(id: string | undefined): Promise<void> {
  if (!id) {
    schema.value = []
    return
  }
  try {
    const result = await window.api.getComfyArgs(id)
    schema.value = result?.args ?? []
  } catch {
    schema.value = []
  }
  schemaVersion.value++
}

const reopenEpoch = inject(SETTINGS_REOPEN_EPOCH, null)
// Also on each reopen: the checkout may have moved while the host was hidden.
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
      <button
        type="button"
        :aria-label="t('comfyUISettings.configureArgs', 'Configure arguments')"
        @click="handleEdit"
      >
        <Settings :size="14" />
      </button>
    </template>
  </ArgsRawInput>
</template>
