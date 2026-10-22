<script setup lang="ts">
/**
 * One setting inside a SettingsSection card.
 * - `stack` (default): label, then the control full width, then the hint.
 *   For text and number fields.
 * - `inline`: label (and hint) left, a compact value or picker right, in a
 *   card narrow enough that the two stay close.
 */
const {
  label,
  hint,
  layout = 'stack'
} = defineProps<{
  label: string
  hint?: string
  layout?: 'stack' | 'inline'
}>()
</script>

<template>
  <div v-if="layout === 'stack'" class="flex flex-col gap-2 px-5 py-4">
    <span class="text-ui font-medium text-base-foreground">{{ label }}</span>
    <slot />
    <p v-if="hint" class="text-ui text-subtle-foreground">{{ hint }}</p>
  </div>
  <div v-else class="flex min-h-15 items-center gap-4 px-5 py-3">
    <div class="min-w-0 flex-1">
      <p class="text-ui font-medium text-base-foreground">{{ label }}</p>
      <p v-if="hint" class="mt-0.5 text-ui text-subtle-foreground">{{ hint }}</p>
    </div>
    <div class="flex shrink-0 items-center gap-1.5"><slot /></div>
  </div>
</template>
