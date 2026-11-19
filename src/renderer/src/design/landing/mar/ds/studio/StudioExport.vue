<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Copy } from 'lucide-vue-next'
import Select from '../../../ui/Select.vue'
import { exportDiff, exportJson, exportPalette, exportTheme } from '../theme/model'
import { state } from '../theme/usePlayground'

/** The patch for ComfyUI_frontend, one file at a time. */
type Out = 'palette' | 'theme' | 'dark' | 'light' | 'diff'
const OUTS: { value: Out; label: string; note: string }[] = [
  {
    value: 'palette',
    label: '_palette.css',
    note: 'packages/design-system/src/css/_palette.css: replaces the charcoal lines in @theme.'
  },
  {
    value: 'theme',
    label: 'theme.css',
    note: 'packages/design-system/src/css/theme.css: the @theme constants, :root (dark) and the @theme inline names it needs.'
  },
  {
    value: 'dark',
    label: 'dark.json',
    note: 'src/assets/palettes/dark.json: merge into colors.theme and colors.litegraph_base.'
  },
  {
    value: 'light',
    label: 'light.json',
    note: 'src/assets/palettes/light.json: merge into colors.theme and colors.litegraph_base.'
  },
  {
    value: 'diff',
    label: 'Diff vs main',
    note: 'Every value that moves from origin/main, in both modes.'
  }
]
const out = ref<Out>('palette')
const text = computed(() => {
  const s = state.value
  if (out.value === 'palette') return exportPalette(s)
  if (out.value === 'theme') return exportTheme(s)
  if (out.value === 'dark' || out.value === 'light') return exportJson(s, out.value)
  return exportDiff(s)
})
const copied = ref(false)
async function copy(): Promise<void> {
  await navigator.clipboard.writeText(text.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}
</script>

<template>
  <div class="st-sec">
    <Select v-model="out" :options="OUTS" size="sm" class="pg-pick" />
    <div class="ds-play-code">
      <div class="ds-play-code-head">
        <span>{{ OUTS.find((o) => o.value === out)!.note }}</span>
        <button type="button" @click="copy">
          <component :is="copied ? Check : Copy" :size="13" />Copy
        </button>
      </div>
      <pre><code>{{ text }}</code></pre>
    </div>
  </div>
</template>
