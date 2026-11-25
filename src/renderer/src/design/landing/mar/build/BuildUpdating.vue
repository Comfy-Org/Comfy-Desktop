<script setup lang="ts">
import { computed } from 'vue'
import { ScrollText } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import type { ProtoInstance } from '../../mock'
import { pendingOf, stateOf } from './buildFacts'
import { UPDATE_STEPS, cancelRun, runs, viewLogs } from './homeRun'

/**
 * An update running on the build (Comfy-Desktop#2216), in place of the
 * page's tabs, like an uninstall: "Updating · N%", the step, the bar, View
 * logs and Cancel. No full-screen loader; the tile and the sidebar row
 * show the same run (homeRun.ts).
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const state = stateOf(env)
const next = pendingOf(env)
const pct = computed(() => runs.get(env.id)?.percent ?? 0)
const step = computed(
  () => UPDATE_STEPS.find((s) => pct.value < s.until)?.label ?? UPDATE_STEPS.at(-1)!.label
)
</script>

<template>
  <div class="mar-op" role="status" aria-live="polite">
    <p class="mar-op-title tabular-nums">Updating · {{ pct }}%</p>
    <p class="mar-op-sub">
      {{ state.name }} · ComfyUI {{ state.version }}<template v-if="next"> to {{ next }}</template>
    </p>
    <div class="mar-op-bar-head">
      <span>{{ step }}</span>
    </div>
    <div class="mar-op-bar"><i :style="{ width: `${pct}%` }" /></div>
    <div class="mt-5 flex gap-2">
      <Button variant="ghost" @click="viewLogs(env)"><ScrollText :size="13" />View logs</Button>
      <Button variant="subtle" @click="cancelRun(env)">Cancel</Button>
    </div>
  </div>
</template>
