<script setup lang="ts">
import Input from '@comfyorg/design-system/input/Input'
// TODO(stale-old-modal): delete after Settings drawer (v2,
// ComfyUISettingsPanel + EnvVarsField) reaches functional parity and
// ships everywhere.
import { ref, watch, computed } from 'vue'
import Button from '@comfyorg/design-system/button/Button'
import { ShieldAlert } from 'lucide-vue-next'

const inputClass = 'env-var-input mt-0 font-mono'

const props = defineProps<{
  modelValue: Record<string, string>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string>]
}>()

interface EnvVar {
  key: string
  value: string
}

const entries = ref<EnvVar[]>([])

watch(
  () => props.modelValue,
  (val) => {
    const incoming = Object.entries(val || {}).map(([key, value]) => ({ key, value }))
    // Reset only if structurally different to avoid cursor jumps.
    if (
      JSON.stringify(incoming) !== JSON.stringify(entries.value.filter((e) => e.key || e.value))
    ) {
      entries.value = incoming.length > 0 ? incoming : []
    }
  },
  { immediate: true }
)

const duplicateKeys = computed(() => {
  const seen = new Map<string, number>()
  for (const entry of entries.value) {
    const k = entry.key.trim()
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  const dupes = new Set<string>()
  for (const [k, count] of seen) {
    if (count > 1) dupes.add(k)
  }
  return dupes
})

function isDuplicate(index: number): boolean {
  const k = entries.value[index]?.key.trim()
  return !!k && duplicateKeys.value.has(k)
}

function emitUpdate(): void {
  const result: Record<string, string> = {}
  for (const entry of entries.value) {
    const k = entry.key.trim()
    if (k) result[k] = entry.value
  }
  emit('update:modelValue', result)
}

function addEntry(): void {
  entries.value.push({ key: '', value: '' })
}

function removeEntry(index: number): void {
  entries.value.splice(index, 1)
  emitUpdate()
}

function onKeyChange(index: number, val: string): void {
  entries.value[index]!.key = val
  emitUpdate()
}

function onValueChange(index: number, val: string): void {
  entries.value[index]!.value = val
  emitUpdate()
}
</script>

<template>
  <div class="env-vars-editor">
    <div v-if="entries.length" class="env-vars-list mb-2 flex flex-col gap-1.5">
      <div class="env-vars-notice mb-1 flex items-center gap-1 text-[12px] text-[var(--info)]">
        <ShieldAlert :size="14" class="env-vars-notice-icon shrink-0" />{{
          $t('envVars.securityWarning')
        }}
      </div>
      <div v-for="(entry, i) in entries" :key="i" class="env-var-row flex items-center gap-1.5">
        <Input
          type="text"
          :class="[inputClass, 'env-var-key flex-[2]', { 'env-var-duplicate': isDuplicate(i) }]"
          :model-value="entry.key"
          :aria-invalid="isDuplicate(i)"
          :aria-label="$t('envVars.name')"
          :placeholder="$t('envVars.namePlaceholder')"
          @change="onKeyChange(i, ($event.target as HTMLInputElement).value)"
        />
        <Input
          type="text"
          :class="[inputClass, 'env-var-value flex-[3]']"
          :model-value="entry.value"
          :aria-label="$t('envVars.value')"
          :placeholder="$t('envVars.valuePlaceholder')"
          @change="onValueChange(i, ($event.target as HTMLInputElement).value)"
        />
        <Button
          size="icon"
          variant="destructive-textonly"
          class="env-var-remove shrink-0"
          :title="$t('common.cancel')"
          aria-label="Remove variable"
          @click="removeEntry(i)"
        >
          ✕
        </Button>
      </div>
    </div>
    <Button size="md" variant="secondary" class="env-var-add" @click="addEntry">
      + {{ $t('envVars.add') }}
    </Button>
  </div>
</template>
