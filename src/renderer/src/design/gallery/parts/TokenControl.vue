<script setup lang="ts">
import { computed } from 'vue'
import { RotateCcw } from 'lucide-vue-next'
import Badge from '../../landing/ui/Badge.vue'
import Button from '../../landing/ui/Button.vue'
import Input from '../../landing/ui/Input.vue'
import SegmentedControl from '../../landing/ui/SegmentedControl.vue'
import Select from '../../landing/ui/Select.vue'
import OklchControl from './OklchControl.vue'
import { GRID_GROUPS, onGrid, shortName, type Token } from '../tokens'
import { isChanged, resetToken, setToken, valueOf } from '../tweaks'

/** Edits one token. Size tokens only offer values on the 4px grid; colors
 *  are edited in OKLCH. */
const { token } = defineProps<{ token: Token }>()

const value = computed({
  get: () => valueOf(token),
  set: (v: string) => setToken(token, v)
})
const steps = (from: number, to: number) =>
  Array.from({ length: (to - from) / 4 + 1 }, (_, i) => `${from + i * 4}px`)
const RADII = steps(0, 24).map((v) => ({ value: v, label: v.replace('px', '') }))
const LEADING = steps(12, 48).map((v) => ({ value: v, label: v }))
const BLUR = steps(0, 48).map((v) => ({ value: v, label: v }))
// Keep the current value selectable even if it's off-grid, so it shows.
const withCurrent = (opts: { value: string; label: string }[]) =>
  opts.some((o) => o.value === value.value)
    ? opts
    : [{ value: value.value, label: `${value.value} (off grid)` }, ...opts]

const offGrid = computed(() => GRID_GROUPS.includes(token.group) && !onGrid(value.value))
</script>

<template>
  <div class="flex flex-col gap-2 py-2">
    <div class="flex h-6 items-center gap-2">
      <span class="min-w-0 flex-1 truncate font-mono text-ui text-muted-foreground">{{
        shortName(token)
      }}</span>
      <Badge v-if="offGrid" variant="outline" size="sm">off grid</Badge>
      <Button
        v-if="isChanged(token)"
        variant="ghost"
        size="icon-xs"
        :aria-label="`Reset ${shortName(token)}`"
        @click="resetToken(token)"
        ><RotateCcw :size="12"
      /></Button>
    </div>

    <SegmentedControl
      v-if="token.group === 'radius'"
      v-model="value"
      size="sm"
      variant="contained"
      :options="withCurrent(RADII)"
    />
    <Select
      v-else-if="token.group === 'leading'"
      v-model="value"
      size="sm"
      :options="withCurrent(LEADING)"
    />
    <Select
      v-else-if="token.group === 'blur'"
      v-model="value"
      size="sm"
      :options="withCurrent(BLUR)"
    />
    <OklchControl v-else-if="token.group === 'color'" :token />
    <Input v-else v-model="value" size="sm" mono :aria-label="shortName(token)" />
  </div>
</template>
