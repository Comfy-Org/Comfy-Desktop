<script setup lang="ts">
import { Comment, Fragment, computed, onMounted, ref, useSlots, type VNode } from 'vue'
import { KEY_STATES, useMode, useSection } from './mode'

/**
 * A row of equal cells, one per state, wrapping when narrow. As the hero
 * only the hero cell shows, large; in States a long row shows the key
 * states first and the rest behind “Show all states”.
 */
const { min = 160 } = defineProps<{ min?: number }>()
const slots = useSlots()
const ctx = useMode()
const section = useSection()
const hero = ctx.mode === 'hero' || ctx.mode === 'specs'
const open = ref(false)
const heroRow = hero && section === ctx.hero[0] && !ctx.heroTaken
if (heroRow) ctx.heroTaken = true

// The cells, with v-for fragments and comments unwrapped.
function flat(nodes: VNode[]): VNode[] {
  return nodes.flatMap((n) =>
    n.type === Fragment ? flat(n.children as VNode[]) : n.type === Comment ? [] : [n]
  )
}
const cells = computed(() => flat(slots.default?.() ?? []))
const shown = computed(() => {
  if (hero) return heroRow ? cells.value.slice(ctx.hero[1], ctx.hero[1] + 1) : []
  return open.value || ctx.mode !== 'states' ? cells.value : cells.value.slice(0, cap)
})
// Large cells (whole-app shots) fill two rows sooner.
const cap = min >= 400 ? 2 : KEY_STATES
// The hero's row tells the frame how many examples it has.
onMounted(() => {
  if (heroRow) ctx.heroCount = cells.value.length
})
const more = computed(() => (ctx.mode === 'states' ? cells.value.length - cap : 0))
const Render = (): VNode[] => shown.value
</script>

<template>
  <div
    v-if="shown.length"
    :class="['ds-cells', hero && 'is-hero']"
    :style="{ '--cell-min': `${min}px` }"
  >
    <Render />
  </div>
  <button v-if="more > 0" type="button" class="ds-more" @click="open = !open">
    {{ open ? 'Show key states' : `Show all states (${cells.length})` }}
  </button>
</template>
