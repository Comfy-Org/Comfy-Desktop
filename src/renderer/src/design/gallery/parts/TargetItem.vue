<script setup lang="ts">
import DropdownMenuItem from '../../landing/ui/DropdownMenuItem.vue'
import type { Token } from '../tokens'
import { valueOf } from '../tweaks'

/** One Tweak target in a section's menu: a component, or a token with
 *  its swatch and value. */
defineProps<{ target: { label: string; token?: Token } }>()
defineEmits<{ select: [] }>()
</script>

<template>
  <DropdownMenuItem @select="$emit('select')">
    <span
      v-if="target.token?.group === 'color'"
      class="size-3 shrink-0 rounded-min border border-border-strong"
      :style="{ background: `var(--${target.token.name})` }"
    />
    <span class="flex-1 truncate">{{ target.label }}</span>
    <span v-if="target.token" class="max-w-28 truncate font-mono text-ui text-subtle-foreground">{{
      valueOf(target.token)
    }}</span>
  </DropdownMenuItem>
</template>
