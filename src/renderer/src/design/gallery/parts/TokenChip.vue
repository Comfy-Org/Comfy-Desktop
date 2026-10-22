<script setup lang="ts">
import { cn } from '../../landing/ui/cn'
import { shortName, type Token } from '../tokens'
import { isChanged, mergedInto, valueOf } from '../tweaks'
import { selectToken } from '../inspect/selection'

/** A token reference: swatch/value preview + name. Click to inspect it. */
const { token, struck = false } = defineProps<{ token: Token; struck?: boolean }>()
</script>

<template>
  <button
    type="button"
    :class="
      cn(
        'inline-flex h-6 min-w-0 items-center gap-2 rounded-control border border-border-default bg-secondary-background px-2 font-mono text-ui text-base-foreground outline-none hover:bg-secondary-background-hover focus-visible:ring-2 focus-visible:ring-border-focus',
        (struck || mergedInto(token)) && 'line-through opacity-50'
      )
    "
    :title="
      mergedInto(token)
        ? `Merging into --${mergedInto(token)}`
        : `--${token.name}: ${valueOf(token)}`
    "
    @click="selectToken(token)"
  >
    <span
      v-if="token.group === 'color'"
      class="size-3 shrink-0 rounded-min border border-border-strong"
      :style="{ background: `var(--${token.name})` }"
    />
    <span class="truncate">{{ shortName(token) }}</span>
    <span v-if="isChanged(token)" class="size-1.5 shrink-0 rounded-full bg-status-running" />
  </button>
</template>
