<script setup lang="ts">
// TODO(stale-old-modal): delete after Settings drawer (v2,
// ComfyUISettingsPanel + EnvVarsField) reaches functional parity and
// ships everywhere.
import { ref, watch, computed } from 'vue'
import Button from '@comfyorg/design-system/button/Button'
import { ShieldAlert } from 'lucide-vue-next'

const inputClass =
  'env-var-input mt-0 w-full rounded-md border border-solid bg-[var(--bg)] px-2 py-1.5 [font-family:monospace] text-[14px] leading-[inherit] text-text outline-none select-text'
const buttonClass =
  'static appearance-auto gap-0 border border-solid font-sans text-[14px] leading-[inherit] whitespace-normal touch-auto transition-none [&]:[appearance:button] focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto]'

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
        <input
          type="text"
          :class="[
            inputClass,
            'env-var-key flex-[2]',
            isDuplicate(i) ? 'env-var-duplicate border-[var(--danger)]' : 'border-[var(--border)]'
          ]"
          :value="entry.key"
          :placeholder="$t('envVars.namePlaceholder')"
          @change="onKeyChange(i, ($event.target as HTMLInputElement).value)"
        />
        <input
          type="text"
          :class="[inputClass, 'env-var-value flex-[3] border-[var(--border)]']"
          :value="entry.value"
          :placeholder="$t('envVars.valuePlaceholder')"
          @change="onValueChange(i, ($event.target as HTMLInputElement).value)"
        />
        <Button
          size="unset"
          variant="textonly"
          :class="[
            buttonClass,
            'env-var-remove flex w-7 shrink-0 items-center justify-center rounded-md border-[var(--border)] bg-surface px-0 py-1.5 font-normal text-text-muted hover:border-[var(--danger)] hover:bg-surface hover:text-[var(--danger)]'
          ]"
          :title="$t('common.cancel')"
          aria-label="Remove variable"
          @click="removeEntry(i)"
        >
          ✕
        </Button>
      </div>
    </div>
    <Button
      size="unset"
      variant="textonly"
      :class="[
        buttonClass,
        'env-var-add inline-flex items-center justify-normal gap-1 self-start rounded-lg border-[var(--border)] bg-[rgba(255,255,255,0.1)] py-2 pr-4 pl-2 font-medium text-neutral-100 hover:bg-[rgba(255,255,255,0.15)] hover:text-text'
      ]"
      @click="addEntry"
    >
      + {{ $t('envVars.add') }}
    </Button>
  </div>
</template>
