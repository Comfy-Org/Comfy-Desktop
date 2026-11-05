<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChartColumn, Gauge, Play } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Select from '../../ui/Select.vue'
import { instances, toast } from '../../useProto'
import MarPage from './MarPage.vue'
import MarEmpty from './MarEmpty.vue'

/**
 * Tools (the sidebar's group before Home): Benchmarks and Performance
 * Tests, each run against one build on this computer. Nothing has run yet,
 * so each is its empty state with the build to run it on.
 */
const { id } = defineProps<{ id: string }>()

const TOOLS: Record<string, { title: string; icon: typeof Gauge; text: string; action: string }> = {
  benchmarks: {
    title: 'Benchmarks',
    icon: ChartColumn,
    text: 'Run a set of workflows on a build and see how long each takes on this computer.',
    action: 'Run benchmark'
  },
  performance: {
    title: 'Performance Tests',
    icon: Gauge,
    text: 'Measure startup time, memory and the first generation for a build.',
    action: 'Run test'
  }
}
const tool = computed(() => TOOLS[id] ?? TOOLS.benchmarks!)
const local = computed(() =>
  instances.value.filter((b) => b.kind === 'local').map((b) => ({ value: b.id, label: b.name }))
)
const build = ref(local.value[0]?.value ?? '')
const buildName = computed(() => local.value.find((b) => b.value === build.value)?.label)
</script>

<template>
  <MarPage :title="tool.title" state="live">
    <template #actions>
      <Select v-model="build" :options="local" label="Build" class="w-48" />
      <Button variant="primary" @click="toast(`Running on ${buildName}…`)"
        ><Play :size="14" />{{ tool.action }}</Button
      >
    </template>
    <MarEmpty :icon="tool.icon" :title="`No ${tool.title.toLowerCase()} yet`" :text="tool.text" />
  </MarPage>
</template>
