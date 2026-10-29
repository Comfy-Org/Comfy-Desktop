<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { Eye, EyeOff, Plus, X } from 'lucide-vue-next'
import BaseInput from '../../components/ui/BaseInput.vue'
import type { DetailField } from '../../types/ipc'

const SENSITIVE_KEY = /TOKEN|KEY|SECRET|PASSWORD|PASS(?!_)|AUTH|CREDENTIAL|API/i

function looksSensitive(key: string): boolean {
  return SENSITIVE_KEY.test(key)
}

/**
 * Environment variables key/value editor. The field header and security
 * callout live in SettingsSectionList — this component is body only.
 */

interface Props {
  field: DetailField
}

const props = defineProps<Props>()

const emit = defineEmits<{
  update: [field: DetailField, value: Record<string, string>]
}>()

const { t } = useI18n()

interface Row {
  key: string
  value: string
}

const rows = ref<Row[]>([])
const revealed = ref<Set<number>>(new Set())
const rowRefs = ref<(HTMLElement | null)[]>([])

function setRowRef(i: number, el: Element | null): void {
  rowRefs.value[i] = el as HTMLElement | null
}

function isRevealed(i: number): boolean {
  return revealed.value.has(i)
}

function toggleReveal(i: number): void {
  const next = new Set(revealed.value)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  revealed.value = next
}

function isMasked(i: number): boolean {
  const row = rows.value[i]
  if (!row) return false
  if (isRevealed(i)) return false
  return looksSensitive(row.key)
}

watch(
  () => props.field.value,
  (val) => {
    const dict =
      val && typeof val === 'object' && !Array.isArray(val) ? (val as Record<string, string>) : {}
    const serverRows: Row[] = Object.entries(dict).map(([key, value]) => ({ key, value }))
    // Keep keyless in-progress rows; the server never saw them (emitUpdate filters them out), so a snapshot can't evict them.
    const localPartial = rows.value.filter((r) => !r.key.trim())
    rows.value = [...serverRows, ...localPartial]
  },
  { immediate: true }
)

const duplicateKeys = computed(() => {
  const counts = new Map<string, number>()
  for (const r of rows.value) {
    const k = r.key.trim()
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const dupes = new Set<string>()
  for (const [k, n] of counts) {
    if (n > 1) dupes.add(k)
  }
  return dupes
})

function isDuplicate(i: number): boolean {
  const k = rows.value[i]?.key.trim()
  return !!k && duplicateKeys.value.has(k)
}

function emitUpdate(): void {
  const out: Record<string, string> = {}
  for (const r of rows.value) {
    const k = r.key.trim()
    if (k) out[k] = r.value
  }
  emit('update', props.field, out)
}

async function addRow(): Promise<void> {
  rows.value.push({ key: '', value: '' })
  await nextTick()
  const last = rowRefs.value[rowRefs.value.length - 1]
  last?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  last?.querySelector<HTMLInputElement>('input')?.focus()
}

function removeRow(i: number): void {
  rows.value.splice(i, 1)
  emitUpdate()
}

function onKeyChange(i: number, val: string): void {
  if (rows.value[i]) {
    rows.value[i].key = val
    emitUpdate()
  }
}

function onValueChange(i: number, val: string): void {
  if (rows.value[i]) {
    rows.value[i].value = val
    emitUpdate()
  }
}
</script>

<template>
  <div class="env-vars-field flex flex-col gap-2.5">
    <div v-if="rows.length > 0" class="env-vars-rows flex flex-col gap-1.5">
      <div
        class="env-vars-head grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)_32px] items-center gap-2 px-0.5 text-[11px] leading-4 font-medium text-text-muted"
        aria-hidden="true"
      >
        <span>{{ t('envVars.name') }}</span>
        <span>{{ t('envVars.value') }}</span>
        <span class="env-vars-head-action w-8"></span>
      </div>

      <div
        v-for="(row, i) in rows"
        :key="i"
        :ref="(el) => setRowRef(i, el as Element | null)"
        class="env-var-row grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)_32px] items-center gap-2"
      >
        <div class="env-var-cell min-w-0">
          <BaseInput
            mono
            :model-value="row.key"
            :placeholder="t('envVars.namePlaceholder')"
            :aria-label="t('envVars.name')"
            :invalid="isDuplicate(i)"
            :aria-invalid="isDuplicate(i)"
            @change="onKeyChange(i, $event)"
          />
          <p
            v-if="isDuplicate(i)"
            class="env-var-error mt-1 text-[11px] leading-4 text-danger"
            role="alert"
          >
            {{ t('envVars.duplicateKey', 'Duplicate key') }}
          </p>
        </div>
        <div
          class="env-var-cell env-var-value-cell relative min-w-0 [&:has(.env-var-reveal)_.ui-input-control]:pt-[5px] [&:has(.env-var-reveal)_.ui-input-control]:pr-9"
        >
          <BaseInput
            mono
            :type="isMasked(i) ? 'password' : 'text'"
            :model-value="row.value"
            :placeholder="t('envVars.valuePlaceholder')"
            :aria-label="t('envVars.value')"
            @change="onValueChange(i, $event)"
          />
          <Button
            v-if="looksSensitive(row.key)"
            type="button"
            variant="textonly"
            size="unset"
            class="env-var-reveal absolute top-1/2 right-1 inline-flex size-7 [transform:translateY(-50%)] items-center justify-center rounded-md border-none bg-transparent p-0 text-neutral-100 appearance-auto gap-0 font-normal leading-[1.5] whitespace-normal transition-[color,background-color] duration-[120ms] ease-[ease] hover:bg-border-hover hover:text-text focus-visible:bg-border-hover focus-visible:text-text focus-visible:outline-none focus-visible:ring-0"
            :aria-label="
              isRevealed(i)
                ? t('envVars.hideValue', 'Hide value')
                : t('envVars.revealValue', 'Reveal value')
            "
            :aria-pressed="isRevealed(i)"
            @click="toggleReveal(i)"
          >
            <EyeOff v-if="isRevealed(i)" :size="14" />
            <Eye v-else :size="14" />
          </Button>
        </div>
        <Button
          type="button"
          variant="textonly"
          size="unset"
          class="env-var-remove static gap-0 font-normal leading-[1.5] whitespace-normal inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-solid border-transparent bg-transparent p-0 text-text-muted appearance-auto transition-[background-color,border-color,color] duration-[120ms] ease-[ease] hover:border-[var(--chooser-surface-border)] hover:bg-[var(--brand-surface-bg-hover)] hover:text-danger focus-visible:border-[var(--chooser-surface-border)] focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:text-danger focus-visible:outline-none focus-visible:ring-0"
          :aria-label="t('envVars.remove', 'Remove variable')"
          @click="removeRow(i)"
        >
          <X :size="14" />
        </Button>
      </div>
    </div>

    <Button
      type="button"
      variant="textonly"
      size="unset"
      class="env-var-add static inline-flex h-8 items-center justify-center gap-1 self-start rounded-lg border-none bg-[var(--chooser-surface-border-hover)] px-3.5 py-2 text-[12px] leading-4 font-medium text-neutral-100 appearance-auto transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-[var(--brand-surface-border-hover)] hover:text-text focus-visible:bg-[var(--brand-surface-border-hover)] focus-visible:text-text focus-visible:outline-none focus-visible:ring-0"
      @click="addRow"
    >
      <Plus :size="16" aria-hidden="true" />
      <span>{{ t('envVars.add') }}</span>
    </Button>
  </div>
</template>
