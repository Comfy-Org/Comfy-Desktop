<script setup lang="ts">
import { ArrowRight, GitMerge, X } from 'lucide-vue-next'
import Button from '../../landing/ui/Button.vue'
import TokenChip from './TokenChip.vue'
import { tokenByName } from '../inspect/selection'
import { shortName } from '../tokens'
import { changedTokens, draft, removeSwap, resetToken, revertToken, valueOf } from '../tweaks'

/** Every draft change: token values and component token swaps. */
</script>

<template>
  <div class="flex flex-col">
    <div
      v-for="t in changedTokens"
      :key="t.name"
      class="flex items-center gap-2 border-t border-border-default py-2"
    >
      <TokenChip :token="t" class="max-w-36" />
      <span class="min-w-0 flex-1 truncate font-mono text-ui text-subtle-foreground"
        >{{ t.value }} → <span class="text-base-foreground">{{ valueOf(t) }}</span></span
      >
      <Button
        variant="ghost"
        size="icon-xs"
        :aria-label="`Undo ${shortName(t)}`"
        @click="resetToken(t)"
        ><X :size="12"
      /></Button>
    </div>
    <div
      v-for="s in draft.swaps"
      :key="`${s.component}${s.axis}${s.option}${s.from}`"
      class="flex flex-col gap-1.5 border-t border-border-default py-2"
    >
      <div class="flex items-center gap-2">
        <span class="min-w-0 flex-1 truncate text-ui"
          >{{ s.componentName }}
          <span class="text-subtle-foreground">{{
            s.axis === 'base' ? 'base' : s.axis === 'file' ? s.file : `${s.axis} ${s.option}`
          }}</span></span
        >
        <Button variant="ghost" size="icon-xs" aria-label="Undo swap" @click="removeSwap(s)"
          ><X :size="12"
        /></Button>
      </div>
      <div class="flex items-center gap-1.5">
        <TokenChip v-if="tokenByName(s.fromToken)" :token="tokenByName(s.fromToken)!" struck />
        <ArrowRight :size="12" class="shrink-0 text-subtle-foreground" />
        <TokenChip v-if="tokenByName(s.toToken)" :token="tokenByName(s.toToken)!" />
      </div>
    </div>
    <div
      v-for="[from, to] in Object.entries(draft.merges)"
      :key="`merge-${from}`"
      class="flex items-center gap-2 border-t border-border-default py-2"
    >
      <TokenChip v-if="tokenByName(from)" :token="tokenByName(from)!" struck />
      <GitMerge :size="12" class="shrink-0 text-subtle-foreground" />
      <TokenChip v-if="tokenByName(to)" :token="tokenByName(to)!" />
      <span class="min-w-0 flex-1 truncate text-ui text-subtle-foreground">merge</span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Undo merge"
        @click="revertToken(tokenByName(from)!)"
        ><X :size="12"
      /></Button>
    </div>
  </div>
</template>
