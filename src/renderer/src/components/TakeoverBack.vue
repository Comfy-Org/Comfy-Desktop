<script setup lang="ts">
// Back affordance for binding takeover-modals: a chevron + label that
// emits `back`, which the host modal wires to its `close` emit.
import { ChevronLeft } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'

defineProps<{
  /** Visible label sat next to the chevron (e.g. "Back to Dashboard"). */
  label: string
}>()

const emit = defineEmits<{
  back: []
}>()
</script>

<template>
  <Button
    size="unset"
    variant="textonly"
    type="button"
    class="takeover-back static inline-flex shrink-0 appearance-auto items-center justify-normal gap-1.5 rounded-md border border-solid border-[var(--border)] bg-transparent pt-1 pr-2.5 pb-1 pl-1.5 font-sans text-[13px] leading-[1.2] font-normal whitespace-normal text-text-muted touch-auto transition-[color,background,border-color] duration-150 ease-[ease] [&]:[appearance:button] hover:border-[var(--border-strong,var(--border))] hover:bg-[var(--surface-hover,rgba(127,127,127,0.08))] hover:text-text focus-visible:ring-0 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--accent,#60a5fa)] focus-visible:outline-offset-2"
    :title="label"
    :aria-label="label"
    @click="emit('back')"
  >
    <ChevronLeft :size="18" class="takeover-back-icon shrink-0" aria-hidden="true" />
    <span class="takeover-back-label whitespace-nowrap">{{ label }}</span>
  </Button>
</template>
