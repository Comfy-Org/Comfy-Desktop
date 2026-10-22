<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { cn } from '../../landing/ui/cn'
import TokenChip from './TokenChip.vue'
import { GROUPS, tokensIn, type TokenGroup } from '../tokens'
import { valueOf } from '../tweaks'
import { usageOf } from '../inspect/usage'

/** All tokens by group, as found in the theme. Click one to inspect it. */
const LIST = GROUPS.map((g) => ({ group: g.ns.id, label: g.ns.label }))
const open = ref(new Set<TokenGroup>(['color']))
function toggle(g: TokenGroup): void {
  const next = new Set(open.value)
  if (next.has(g)) next.delete(g)
  else next.add(g)
  open.value = next
}
</script>

<template>
  <div v-for="g in LIST" :key="g.group" class="border-b border-border-default">
    <button
      type="button"
      class="flex h-10 w-full items-center gap-2 text-left text-ui font-medium outline-none focus-visible:text-base-foreground"
      :aria-expanded="open.has(g.group)"
      @click="toggle(g.group)"
    >
      <span class="flex-1">{{ g.label }}</span>
      <span class="text-ui text-subtle-foreground">{{ tokensIn(g.group).length }}</span>
      <ChevronDown
        :size="14"
        :class="
          cn('text-subtle-foreground transition-transform', open.has(g.group) && 'rotate-180')
        "
      />
    </button>
    <div v-if="open.has(g.group)" class="flex flex-col gap-1 pb-3">
      <div v-for="t in tokensIn(g.group)" :key="t.name" class="flex items-center gap-2">
        <TokenChip :token="t" class="max-w-44" />
        <span class="min-w-0 flex-1 truncate text-right font-mono text-ui text-subtle-foreground">{{
          valueOf(t)
        }}</span>
        <span class="w-10 shrink-0 text-right font-mono text-ui text-subtle-foreground tabular-nums"
          >{{ usageOf(t).total }}×</span
        >
      </div>
    </div>
  </div>
</template>
