<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, X } from 'lucide-vue-next'
import Switch from '../../../ui/Switch.vue'
import { cssOf } from '../theme/color'
import { BARS, NODE_PAIRS, PAIRS, type Kind } from '../theme/checks'
import { MODES, NODE_COLORS } from '../theme/model'
import { editing, results } from '../theme/usePlayground'

/** WCAG 2 and APCA for each pair, as painted, in both modes. Custom node
 *  colours aren't on the prototype's graph, so they are checked here. */
interface Row {
  id: string
  group: string
  label: string
  kind: Kind
}
const ROWS: Row[] = [
  ...PAIRS.map((p) => ({ id: p.id, group: p.group, label: p.label, kind: p.kind })),
  ...NODE_COLORS.flatMap((n) =>
    NODE_PAIRS.map((np) => ({
      id: `${n.id}:${np.suffix}`,
      group: 'Node colours',
      label: `${n.id.replace('_', ' ')} · ${np.label}`,
      kind: np.kind
    }))
  )
]
const failingOnly = ref(true)
const rows = computed(() =>
  ROWS.filter((r) => !failingOnly.value || MODES.some((m) => !results.value[m][r.id]!.pass))
)
const fails = computed(() =>
  MODES.map((m) => ({ m, n: ROWS.filter((r) => !results.value[m][r.id]!.pass).length }))
)
const modes = computed(
  () => (editing.value === 'light' ? ['light', 'dark'] : MODES) as typeof MODES
)
const barText = (k: Kind): string => {
  const b = BARS[k]
  return `${b.label} ${b.wcag ? `${b.wcag}:1 · ` : ''}Lc ${b.lc}`
}
</script>

<template>
  <div class="st-sec">
    <p class="st-note">
      Ratio and Lc as painted (translucent tokens over what they sit on). Bars:
      {{ (['text', 'label', 'ui', 'edge'] as Kind[]).map(barText).join('; ') }}.
    </p>
    <div class="stc-bar">
      <span v-for="f in fails" :key="f.m" :class="['stc-count', f.n && 'is-fail']"
        >{{ f.m === 'dark' ? 'Dark' : 'Light' }}: {{ f.n }} failing</span
      >
      <label class="st-toggle"><Switch v-model="failingOnly" />Only failing</label>
    </div>
    <div class="stc-head">
      <span>Pair</span>
      <span v-for="m in modes" :key="m">{{ m === 'dark' ? 'Dark' : 'Light' }} · ratio · Lc</span>
    </div>
    <div v-for="r in rows" :key="r.id" class="stc-row">
      <div class="stc-pair">
        <span>{{ r.label }}</span>
        <small>{{ r.group }} · {{ BARS[r.kind].label }}</small>
      </div>
      <div
        v-for="m in modes"
        :key="m"
        :class="['stc-score', results[m][r.id]!.pass ? 'is-pass' : 'is-fail']"
      >
        <span
          class="stc-sample"
          :style="{ background: cssOf(results[m][r.id]!.bg), color: cssOf(results[m][r.id]!.fg) }"
          >Aa</span
        >
        <code :class="results[m][r.id]!.wcagPass === false && 'is-off'">{{
          results[m][r.id]!.ratio.toFixed(2)
        }}</code>
        <code :class="!results[m][r.id]!.lcPass && 'is-off'">{{
          Math.round(results[m][r.id]!.lc)
        }}</code>
        <component :is="results[m][r.id]!.pass ? Check : X" :size="13" />
      </div>
    </div>
    <p v-if="!rows.length" class="st-note">Every pair passes in both modes.</p>
  </div>
</template>
