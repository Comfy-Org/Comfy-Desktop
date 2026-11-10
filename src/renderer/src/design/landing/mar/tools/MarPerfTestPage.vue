<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { FileJson, FolderOpen, ImageDown, Info, Play, Square, X } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import Meter from '../../ui/Meter.vue'
import NumberField from '../../ui/NumberField.vue'
import Select from '../../ui/Select.vue'
import Tooltip from '../../ui/Tooltip.vue'
import { INSTANCES } from '../../mock'
import { proto, toast } from '../../useProto'
import MarPage from '../pages/MarPage.vue'
import { fmtSec } from './benchData'
import './tools.css'

/**
 * Performance Tests (Desktop's PerformanceTestView), drawn as Mar's pages:
 * three boxes for what to run (the build, the workflow, how many runs),
 * Run as the page's one white action, then the results and the logs.
 * Everything Desktop does is here: workspace and build, an example
 * workflow with its models downloaded first or an API workflow dropped
 * in, warm-up and measured runs, Stop, progress, the run aggregates, the
 * computer's facts, Open folder and Export results.
 */
const WORKSPACES = [
  { value: 'personal', label: 'Personal' },
  { value: 'design-team', label: 'Design team' }
] as const
const workspace = ref<string>(proto.workspaceId)
const builds = computed(() =>
  INSTANCES.filter(
    (b) =>
      b.kind === 'local' &&
      !b.deployment &&
      b.workspace === (proto.signedIn ? workspace.value : 'personal')
  ).map((b) => ({ value: b.id, label: b.name }))
)
const build = ref('')
watch(
  builds,
  (list) => {
    if (!list.some((b) => b.value === build.value)) build.value = ''
  },
  { immediate: true }
)

const EXAMPLES = [
  { value: 'flux', label: 'Flux.1 Dev · 1024²' },
  { value: 'sdxl', label: 'SDXL Turbo · 512²' },
  { value: 'wan', label: 'Wan 2.2 · image to video' }
]
type Workflow = { name: string; from: 'example' | 'import' }
const workflow = ref<Workflow | null>(null)
const example = ref('')
const downloading = ref(0)
let dlTimer: ReturnType<typeof setInterval> | undefined
watch(example, (v) => {
  if (!v) return
  const name = EXAMPLES.find((e) => e.value === v)!.label
  workflow.value = null
  downloading.value = 1
  clearInterval(dlTimer)
  dlTimer = setInterval(() => {
    downloading.value = Math.min(100, downloading.value + 9)
    if (downloading.value >= 100) {
      clearInterval(dlTimer)
      downloading.value = 0
      workflow.value = { name, from: 'example' }
    }
  }, 120)
})
function cancelDownload(): void {
  clearInterval(dlTimer)
  downloading.value = 0
  example.value = ''
}
function importFile(name = 'my-workflow_api.json'): void {
  example.value = ''
  workflow.value = { name, from: 'import' }
}
function removeWorkflow(): void {
  workflow.value = null
  example.value = ''
}
const over = ref(false)
function onDrop(e: DragEvent): void {
  over.value = false
  importFile(e.dataTransfer?.files[0]?.name)
}

const warmup = ref(1)
const measured = ref(5)

type Phase = 'idle' | 'running' | 'stopping' | 'done'
const phase = ref<Phase>('idle')
const done = ref(0)
const durations = ref<number[]>([])
const logs = ref<string[]>([])
let runTimer: ReturnType<typeof setInterval> | undefined
const buildName = computed(() => builds.value.find((b) => b.value === build.value)?.label ?? '')
const canRun = computed(() => Boolean(build.value && workflow.value) && phase.value !== 'running')

function run(): void {
  phase.value = 'running'
  done.value = 0
  durations.value = []
  logs.value = [
    `Starting ${buildName.value}…`,
    'ComfyUI ready on 127.0.0.1:8188',
    `Submitting ${warmup.value} warm-up run${warmup.value === 1 ? '' : 's'} and ${measured.value} measured runs…`
  ]
  const total = warmup.value + measured.value
  let step = 0
  runTimer = setInterval(() => {
    step++
    if (step <= warmup.value) {
      logs.value.push(`Warm-up ${step}/${warmup.value} finished`)
    } else {
      const d = 11.6 + Math.random() * 0.4
      durations.value.push(d)
      done.value++
      logs.value.push(`Run ${done.value}/${measured.value}: ${fmtSec(d)}`)
    }
    if (step >= total) finish()
  }, 650)
}
function finish(): void {
  clearInterval(runTimer)
  logs.value.push(
    `Finished ${measured.value} measured runs (0 failed). Results saved to ~/ComfyUI/benchmarks/${buildName.value.toLowerCase().replace(/\s+/g, '-')}`
  )
  phase.value = 'done'
}
function stop(): void {
  phase.value = 'stopping'
  clearInterval(runTimer)
  setTimeout(() => {
    logs.value.push('Stopped.')
    phase.value = durations.value.length ? 'done' : 'idle'
  }, 700)
}
onBeforeUnmount(() => {
  clearInterval(runTimer)
  clearInterval(dlTimer)
})

const stats = computed(() => {
  const s = [...durations.value].sort((a, b) => a - b)
  if (!s.length) return null
  const mid = Math.floor(s.length / 2)
  return {
    fastest: s[0]!,
    slowest: s[s.length - 1]!,
    average: s.reduce((a, b) => a + b, 0) / s.length,
    median: s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
  }
})
const STAT_TILES = computed(() =>
  stats.value
    ? [
        { label: 'Fastest run', value: fmtSec(stats.value.fastest) },
        { label: 'Average run', value: fmtSec(stats.value.average) },
        { label: 'Median run', value: fmtSec(stats.value.median) },
        { label: 'Slowest run', value: fmtSec(stats.value.slowest) },
        { label: 'Measured runs', value: String(durations.value.length) },
        { label: 'Failed runs', value: '0' }
      ]
    : []
)
// The bar spans a little either side of the fastest and slowest runs, so
// the spread between them reads.
const span = computed(() => {
  if (!stats.value) return { lo: 0, hi: 1 }
  const pad = Math.max(0.05, (stats.value.slowest - stats.value.fastest) * 0.5)
  return { lo: stats.value.fastest - pad, hi: stats.value.slowest + pad }
})
const pct = (v: number): string =>
  `${((v - span.value.lo) / (span.value.hi - span.value.lo)) * 100}%`

const SYSTEM = [
  { label: 'Compute device', value: 'NVIDIA GeForce RTX 4090' },
  { label: 'VRAM', value: '24 GB' },
  { label: 'RAM', value: '64 GB' },
  { label: 'PyTorch version', value: '2.9.0+cu128' },
  { label: 'xFormers version', value: '0.0.32' },
  { label: 'CPU', value: 'AMD Ryzen 9 7950X' },
  { label: 'CPU cores', value: '16' },
  { label: 'Operating system', value: 'Windows 11' },
  { label: 'Architecture', value: 'x64' }
]
</script>

<template>
  <MarPage title="Performance Tests" state="live">
    <template #actions>
      <Button
        v-if="phase === 'running' || phase === 'stopping'"
        variant="secondary"
        :disabled="phase === 'stopping'"
        @click="stop"
        ><Square :size="13" />{{ phase === 'stopping' ? 'Stopping…' : 'Stop' }}</Button
      >
      <Button v-else variant="primary" :disabled="!canRun" @click="run"
        ><Play :size="14" />Run</Button
      >
    </template>

    <div class="mar-tl">
      <div class="mar-tl-setup">
        <Card class="mar-tl-box">
          <p class="mar-tl-title">Build</p>
          <div class="flex flex-col gap-2">
            <Select
              v-if="proto.signedIn"
              v-model="workspace"
              :options="[...WORKSPACES]"
              label="Workspace"
            />
            <Select v-model="build" :options="builds" label="Build" />
          </div>
        </Card>

        <Card
          class="mar-tl-box"
          @dragover.prevent="over = true"
          @dragleave="over = false"
          @drop.prevent="onDrop"
        >
          <p class="mar-tl-title">Workflow</p>
          <template v-if="downloading">
            <div class="mar-tl-progress">
              <span>Preparing workflow and downloading required models…</span>
              <Meter :value="downloading" :max="100" />
            </div>
            <Button variant="ghost" size="sm" class="self-start" @click="cancelDownload"
              >Cancel download</Button
            >
          </template>
          <div v-else-if="workflow" class="mar-tl-file">
            <FileJson :size="15" class="shrink-0 text-subtle-foreground" />
            <span class="grow truncate">{{ workflow.name }}</span>
            <span class="mar-tag">{{ workflow.from === 'example' ? 'Example' : 'API' }}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Delete workflow"
              title="Delete workflow"
              @click="removeWorkflow"
              ><X :size="13"
            /></Button>
          </div>
          <template v-else>
            <Select v-model="example" :options="EXAMPLES" label="Example workflow" />
            <p class="mar-tl-hint">Missing models will be downloaded automatically.</p>
            <p class="mar-tl-or">or import an API workflow</p>
            <button
              type="button"
              class="mar-tl-drop"
              :class="over && 'is-over'"
              @click="importFile()"
            >
              <FileJson :size="16" class="text-subtle-foreground" />
              Drop a workflow .json in API format, or click to browse
            </button>
          </template>
        </Card>

        <Card class="mar-tl-box">
          <p class="mar-tl-title">Runs</p>
          <div class="mar-tl-fact">
            <span class="mar-tl-label flex items-center gap-1.5"
              >Warm-up runs
              <Tooltip
                wrap
                content="Runs executed first to load models and warm up caches. They are not included in the results."
                ><Info :size="12" /></Tooltip
            ></span>
            <NumberField v-model="warmup" :min="0" :max="20" aria-label="Warm-up runs" />
          </div>
          <div class="mar-tl-fact">
            <span class="mar-tl-label flex items-center gap-1.5"
              >Measured runs
              <Tooltip
                wrap
                content="Runs timed after the warm-up runs. Their durations are used to calculate the results."
                ><Info :size="12" /></Tooltip
            ></span>
            <NumberField v-model="measured" :min="1" :max="50" aria-label="Measured runs" />
          </div>
        </Card>
      </div>

      <Card class="mar-tl-box">
        <p class="mar-tl-title">
          Results
          <span v-if="phase === 'done'" class="mar-tl-tools">
            <Button variant="ghost" size="sm" @click="toast('Opened the results folder')"
              ><FolderOpen :size="14" />Open folder</Button
            >
            <Button variant="ghost" size="sm" @click="toast('Exported the results image')"
              ><ImageDown :size="14" />Export results</Button
            >
          </span>
        </p>
        <div v-if="phase === 'running' || phase === 'stopping'" class="mar-tl-progress">
          <span>{{ done }} of {{ measured }} runs completed</span>
          <Meter :value="done" :max="measured" />
        </div>
        <template v-if="stats">
          <div class="mar-tl-stats" :class="phase !== 'done' && 'mt-3'">
            <div v-for="s in STAT_TILES" :key="s.label" class="mar-tl-stat">
              <span>{{ s.label }}</span
              ><strong>{{ s.value }}</strong>
            </div>
          </div>
          <div class="mar-tl-chart mt-3" aria-label="Run duration aggregates">
            <div class="mar-tl-series" style="--series: var(--color-base-foreground)">
              <span />
              <span class="mar-tl-series-name text-ui"
                ><i class="mar-tl-dot" /><span class="truncate">{{ workflow?.name }}</span></span
              >
              <span class="mar-tl-track">
                <i
                  class="mar-tl-range"
                  :style="{
                    left: pct(stats.fastest),
                    width: `calc(${pct(stats.slowest)} - ${pct(stats.fastest)})`
                  }"
                /><i class="mar-tl-avg" :style="{ left: pct(stats.average) }" />
              </span>
              <span class="mar-tl-value"
                >{{ fmtSec(stats.fastest) }} – {{ fmtSec(stats.slowest) }}</span
              >
            </div>
          </div>
        </template>
        <p v-else-if="phase === 'idle'" class="mar-tl-hint mb-1">
          Performance test results will appear here.
        </p>
      </Card>

      <Card v-if="phase === 'done'" class="mar-tl-box">
        <p class="mar-tl-title">System information</p>
        <div class="mar-tl-sys">
          <div v-for="f in SYSTEM" :key="f.label" class="mar-tl-fact">
            <span class="mar-tl-label">{{ f.label }}</span>
            <span class="truncate text-ui text-base-foreground" :title="f.value">{{
              f.value
            }}</span>
          </div>
        </div>
      </Card>

      <Card class="mar-tl-box">
        <p class="mar-tl-title">Logs</p>
        <div class="mar-tl-logs">
          {{ logs.length ? logs.join('\n') : 'Build logs will appear here.' }}
        </div>
      </Card>
    </div>
  </MarPage>
</template>
