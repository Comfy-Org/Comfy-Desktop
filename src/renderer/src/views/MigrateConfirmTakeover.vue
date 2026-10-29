<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import Button from '@comfyorg/design-system/button/Button'
import BrandTakeoverLayout from '../components/BrandTakeoverLayout.vue'
import MigrateConfirmBody, {
  type MigrateDetailGroup,
  type MigrateCheckbox
} from '../components/MigrateConfirmBody.vue'
import type { SnapshotDetailData } from '../types/ipc'

interface OpenOpts {
  title: string
  confirmLabel: string
  preview: SnapshotDetailData
  details: MigrateDetailGroup[]
  checkboxes: MigrateCheckbox[]
}

const isOpen = ref(false)
const loading = ref(true)
const title = ref('')
const confirmLabel = ref('')
const preview = ref<SnapshotDetailData | null>(null)
const details = ref<MigrateDetailGroup[]>([])
const checkboxes = ref<MigrateCheckbox[]>([])
const dialogRef = ref<HTMLElement | null>(null)
/** Focus owner before open, restored on commit regardless of close path. */
let returnFocusTo: HTMLElement | null = null

let resolver:
  | ((value: { confirmed: boolean; checkboxValues: Record<string, boolean> }) => void)
  | null = null

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isOpen.value) commit(false)
}

// Bind/unbind ESC + focus per open() rather than onMounted, since the instance outlives the visible surface.
watch(isOpen, async (open) => {
  if (open) {
    document.addEventListener('keydown', onKeydown)
    returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    // Focus the dialog container, not the cancel button — keeps focus trapped
    // for keyboard/AT without painting a focus-visible ring on open.
    dialogRef.value?.focus()
  } else {
    document.removeEventListener('keydown', onKeydown)
    returnFocusTo?.focus()
    returnFocusTo = null
  }
})

async function open(
  initialTitle: string,
  initialConfirmLabel: string
): Promise<{
  confirmed: boolean
  checkboxValues: Record<string, boolean>
}> {
  title.value = initialTitle
  confirmLabel.value = initialConfirmLabel
  loading.value = true
  preview.value = null
  details.value = []
  checkboxes.value = []
  isOpen.value = true
  return new Promise((resolve) => {
    resolver = resolve
  })
}

function update(opts: Partial<OpenOpts> & { loading?: boolean }): void {
  if (opts.title !== undefined) title.value = opts.title
  if (opts.confirmLabel !== undefined) confirmLabel.value = opts.confirmLabel
  if (opts.preview !== undefined) preview.value = opts.preview
  if (opts.details !== undefined)
    details.value = opts.details.map((g) => ({ ...g, items: [...g.items] }))
  if (opts.checkboxes !== undefined) checkboxes.value = opts.checkboxes.map((c) => ({ ...c }))
  if (opts.loading !== undefined) loading.value = opts.loading
}

function onToggle(id: string, checked: boolean): void {
  const cb = checkboxes.value.find((c) => c.id === id)
  if (cb) cb.checked = checked
}

function commit(confirmed: boolean): void {
  const checkboxValues = Object.fromEntries(checkboxes.value.map((c) => [c.id, c.checked]))
  isOpen.value = false
  resolver?.({ confirmed, checkboxValues })
  resolver = null
}

defineExpose({ open, update, commit })
</script>

<template>
  <BrandTakeoverLayout v-if="isOpen">
    <div
      ref="dialogRef"
      class="migrate-takeover relative z-1 flex w-full max-w-[640px] flex-col items-center gap-[var(--takeover-gap-md)] text-center"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      tabindex="-1"
    >
      <h1
        class="migrate-takeover__title m-0 font-display text-[length:var(--takeover-fs-title)] leading-[1.15] font-extrabold tracking-normal text-[var(--legacy-color-text)] opacity-85"
      >
        {{ title }}
      </h1>
      <div
        class="migrate-takeover__card w-full rounded-xl border border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] p-5"
      >
        <div
          v-if="loading"
          class="migrate-takeover__loading py-6 text-center text-[length:var(--takeover-fs-body)] text-neutral-300"
        >
          {{ $t('common.loading') }}
        </div>
        <MigrateConfirmBody
          v-else
          :preview="preview"
          :details="details"
          :checkboxes="checkboxes"
          @toggle-checkbox="onToggle"
        />
      </div>
      <div class="migrate-takeover__actions flex w-full items-center justify-end gap-3">
        <Button
          size="unset"
          variant="textonly"
          type="button"
          class="static inline-flex appearance-auto items-center justify-center gap-0 border border-solid px-4 py-2.5 font-sans text-[length:var(--takeover-fs-body)] leading-[inherit] font-medium whitespace-normal touch-auto transition-[background,border-color,color] duration-120 ease-[ease] [&]:[appearance:button] focus-visible:ring-0 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-55 rounded-md border-transparent bg-transparent text-neutral-300 enabled:hover:bg-[var(--brand-surface-bg)] enabled:hover:text-neutral-100"
          data-testid="migrate-takeover-cancel"
          @click="commit(false)"
        >
          {{ $t('common.cancel') }}
        </Button>
        <Button
          size="unset"
          variant="textonly"
          type="button"
          class="static inline-flex appearance-auto items-center justify-center gap-0 border border-solid px-4 py-2.5 font-sans text-[length:var(--takeover-fs-body)] leading-[inherit] font-medium whitespace-normal touch-auto transition-[background,border-color,color] duration-120 ease-[ease] [&]:[appearance:button] focus-visible:ring-0 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-55 rounded-[var(--radius-control)] border-comfy-yellow bg-comfy-yellow text-neutral-900 enabled:hover:border-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] enabled:hover:bg-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] disabled:hover:bg-comfy-yellow [&:focus-visible]:outline-[color-mix(in_srgb,var(--comfy-yellow)_80%,var(--neutral-100))]"
          data-testid="migrate-takeover-confirm"
          :disabled="loading"
          @click="commit(true)"
        >
          {{ confirmLabel }}
        </Button>
      </div>
    </div>
  </BrandTakeoverLayout>
</template>
