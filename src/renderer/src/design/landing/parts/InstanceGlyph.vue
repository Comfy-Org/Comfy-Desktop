<script setup lang="ts">
import LocationIcon from '../ui/LocationIcon.vue'
import type { ProtoInstance } from '../mock'

/** An instance's mark: where it runs, plus a running dot whose ring
 *  matches the surface it sits on (`--glyph-ring`). */
const {
  inst,
  size = 'md',
  dot = false
} = defineProps<{
  inst: ProtoInstance
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  dot?: boolean
}>()
const PX = { xs: 16, sm: 20, md: 28, lg: 36, xl: 40 } as const
</script>

<template>
  <span class="relative inline-flex shrink-0">
    <LocationIcon :kind="inst.kind === 'cloud' ? 'cloud' : 'local'" :size="PX[size]" />
    <span
      v-if="dot && inst.state === 'running'"
      class="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border-2 border-(--glyph-ring,var(--color-card-background)) bg-status-running"
    />
  </span>
</template>
