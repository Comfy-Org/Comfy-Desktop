<script setup lang="ts">
import Switch from '@comfyorg/design-system/switch/Switch'
import { Check } from 'lucide-vue-next'
import type { SnapshotDetailData } from '../types/ipc'

export interface MigrateDetailGroup {
  label: string
  items: string[]
}

export interface MigrateCheckbox {
  id: string
  label: string
  checked: boolean
}

defineProps<{
  preview: SnapshotDetailData | null
  details: MigrateDetailGroup[]
  checkboxes: MigrateCheckbox[]
}>()

const emit = defineEmits<{
  'toggle-checkbox': [id: string, checked: boolean]
}>()

function onCheckboxToggle(id: string, checked: boolean): void {
  emit('toggle-checkbox', id, checked)
}
</script>

<template>
  <div class="mig-body flex flex-col gap-4">
    <div
      v-if="preview"
      class="mig-summary flex flex-col gap-0.5 rounded-lg border border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] px-4 py-3.5 [&>div+div]:border-t [&>div+div]:border-solid [&>div+div]:border-[color-mix(in_oklab,var(--neutral-100)_6%,transparent)]"
    >
      <div
        class="mig-summary__row flex items-baseline justify-between py-1.5 text-[length:var(--takeover-fs-body)]"
      >
        <span class="mig-summary__label text-neutral-300">{{
          $t('snapshots.comfyuiVersion')
        }}</span>
        <span class="mig-summary__value font-medium text-neutral-100">{{
          preview.comfyuiVersion
        }}</span>
      </div>
      <div
        class="mig-summary__row flex items-baseline justify-between py-1.5 text-[length:var(--takeover-fs-body)]"
      >
        <span class="mig-summary__label text-neutral-300">{{ $t('snapshots.customNodes') }}</span>
        <span class="mig-summary__value font-medium text-neutral-100">{{
          preview.customNodes.length
        }}</span>
      </div>
      <div
        class="mig-summary__row flex items-baseline justify-between py-1.5 text-[length:var(--takeover-fs-body)]"
      >
        <span class="mig-summary__label text-neutral-300">{{ $t('snapshots.pipPackages') }}</span>
        <span class="mig-summary__value font-medium text-neutral-100">{{
          preview.pipPackageCount
        }}</span>
      </div>
    </div>

    <div v-if="details.length" class="mig-actions-list flex flex-col gap-2">
      <div v-for="(group, gi) in details" :key="gi" class="mig-actions-group flex flex-col gap-2">
        <span
          class="mig-actions-label text-[length:var(--takeover-fs-caption)] font-semibold tracking-[0.06em] text-neutral-300 uppercase"
          >{{ group.label }}</span
        >
        <ul class="mig-actions-items m-0 flex list-none flex-col gap-1.5 p-0 text-neutral-100">
          <li
            v-for="(item, ii) in group.items"
            :key="ii"
            class="mig-actions-item flex items-start gap-2 text-[length:var(--takeover-fs-body)] leading-[1.5] text-neutral-200"
          >
            <Check
              :size="14"
              :stroke-width="2"
              class="mig-actions-check mt-1 flex-none text-neutral-100"
              aria-hidden="true"
            />
            <span>{{ item }}</span>
          </li>
        </ul>
      </div>
    </div>

    <div v-if="checkboxes.length" class="mig-options flex flex-col gap-2">
      <label
        v-for="cb in checkboxes"
        :key="cb.id"
        class="mig-option flex cursor-pointer items-center gap-2.5 text-[length:var(--takeover-fs-body)] text-neutral-200"
      >
        <Switch
          class="mt-2"
          :model-value="cb.checked"
          @update:model-value="onCheckboxToggle(cb.id, $event)"
        />
        <span>{{ cb.label }}</span>
      </label>
    </div>
  </div>
</template>
