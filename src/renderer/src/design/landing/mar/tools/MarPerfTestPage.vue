<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FolderOpen,
  ImageDown,
  Info,
  LayoutGrid,
  Play,
  Square,
  Trash2,
  Upload
} from 'lucide-vue-next'
import {
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import Button from '../../ui/Button.vue'
import DialogContent from '../../ui/DialogContent.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuSeparator from '../../ui/DropdownMenuSeparator.vue'
import Tooltip from '../../ui/Tooltip.vue'
import { INSTANCES } from '../../mock'
import { proto, toast } from '../../useProto'
import MarPage from '../pages/MarPage.vue'
import './perfTest.css'

/**
 * Performance Tests, as Desktop ships it (Comfy-Desktop#2018): what to run
 * is one row of filter buttons (Build, Workflow, the two run counts) with
 * Run at its end and one status line under it; then one Results section
 * (the median big, one bar per measure on a shared scale), System
 * information in a three-column facts grid, and Logs folded to their last
 * line. Sections sit on the page, no fill (UI rules).
 */
const builds = computed(() =>
  INSTANCES.filter(
    (b) => b.kind === 'local' && !b.deployment && b.workspace === proto.workspaceId
  ).map((b) => ({ value: b.id, label: b.name }))
)
const build = ref('')
watch(
  builds,
  (list) => {
    if (!list.some((b) => b.value === build.value)) build.value = list[0]?.value ?? ''
  },
  { immediate: true }
)
const buildName = computed(() => builds.value.find((b) => b.value === build.value)?.label ?? '')

const EXAMPLES = [
  {
    file: 'flux_dev_fp8_api.json',
    title: 'Flux.1 Dev',
    text: 'Text to image, 1024²',
    model: 'flux1-dev-fp8.safetensors'
  },
  {
    file: 'sdxl_turbo_api.json',
    title: 'SDXL Turbo',
    text: 'Text to image, 512²',
    model: 'sd_xl_turbo_1.0_fp16.safetensors'
  },
  {
    file: 'audio_yue2_text2music.json',
    title: 'YuE 2',
    text: 'Text to music',
    model: 'yue2_s1_en_cot.safetensors'
  }
]
type Workflow = { name: string; from: 'example' | 'api' }
const workflow = ref<Workflow | null>(null)
const pending = ref('')
const download = ref<{ message: string; percent: number } | null>(null)
const importError = ref('')
const dragging = ref(false)
const pickerOpen = ref(false)
const picked = ref(EXAMPLES[0]!.file)
let prepTimer: ReturnType<typeof setTimeout> | undefined
let dlTimer: ReturnType<typeof setInterval> | undefined

function useExample(): void {
  const ex = EXAMPLES.find((e) => e.file === picked.value)!
  pickerOpen.value = false
  importError.value = ''
  workflow.value = null
  pending.value = ex.file
  clearTimeout(prepTimer)
  clearInterval(dlTimer)
  prepTimer = setTimeout(() => {
    download.value = { message: `Downloading ${ex.model}`, percent: 0 }
    dlTimer = setInterval(() => {
      const p = Math.min(100, (download.value?.percent ?? 0) + 7)
      download.value = { message: `Downloading ${ex.model} (${p}%)`, percent: p }
      if (p >= 100) {
        clearInterval(dlTimer)
        download.value = null
        pending.value = ''
        workflow.value = { name: ex.file, from: 'example' }
      }
    }, 160)
  }, 900)
}
function importWorkflow(name = 'my_workflow_api.json'): void {
  if (!name.endsWith('.json')) {
    importError.value = 'Could not import the workflow.'
    return
  }
  importError.value = ''
  workflow.value = { name, from: 'api' }
}
function deleteWorkflow(): void {
  clearTimeout(prepTimer)
  clearInterval(dlTimer)
  download.value = null
  pending.value = ''
  workflow.value = null
}
const locked = computed(() => phase.value === 'running' || phase.value === 'stopping')
function onDrop(e: DragEvent): void {
  dragging.value = false
  if (locked.value) return
  importWorkflow(e.dataTransfer?.files[0]?.name)
}
function onLeave(e: DragEvent): void {
  const to = e.relatedTarget as Node | null
  if (!to || !(e.currentTarget as HTMLElement).contains(to)) dragging.value = false
}
const shownName = computed(() => pending.value || workflow.value?.name || '')
const shownTag = computed(() =>
  pending.value || workflow.value?.from === 'example' ? 'Example' : 'API'
)

const warmup = ref(1)
const measured = ref(5)
const SETTINGS = [
  {
    id: 'warmup',
    label: 'Warm-up runs',
    hint: 'Runs executed first to load models and warm up caches. They are not included in the results.',
    min: 0,
    max: 5,
    model: warmup
  },
  {
    id: 'measured',
    label: 'Measured runs',
    hint: 'Runs timed after the warm-up runs. Their durations are used to calculate the results.',
    min: 1,
    max: 100,
    model: measured
  }
]
function commit(s: (typeof SETTINGS)[number]): void {
  const v = Math.round(Number(s.model.value))
  s.model.value = Number.isFinite(v) ? Math.min(s.max, Math.max(s.min, v)) : s.min
}

type Phase = 'idle' | 'running' | 'stopping' | 'done'
const phase = ref<Phase>('idle')
const completed = ref(0)
const durations = ref<number[]>([])
const logs = ref<string[]>([])
const logsOpen = ref(false)
const ran = ref<{ workflow: string; build: string; warmups: number; total: number } | null>(null)
let runTimer: ReturnType<typeof setInterval> | undefined
const canRun = computed(() => Boolean(build.value && workflow.value) && !locked.value)

const fmt = (s: number): string => `${s.toFixed(3)} s`

function run(): void {
  if (!workflow.value) return
  phase.value = 'running'
  completed.value = 0
  durations.value = []
  logsOpen.value = true
  ran.value = {
    workflow: workflow.value.name,
    build: buildName.value,
    warmups: warmup.value,
    total: warmup.value + measured.value
  }
  logs.value = [
    `Starting ${buildName.value}...`,
    'ComfyUI ready on 127.0.0.1:8188',
    `Submitting ${warmup.value} warm-up runs and ${measured.value} measured runs...`
  ]
  runTimer = setInterval(() => {
    const r = ran.value!
    completed.value++
    if (completed.value <= r.warmups) {
      logs.value.push(`Warm-up run ${completed.value} of ${r.warmups} finished`)
    } else {
      const d = 49 + Math.random() * 28
      durations.value.push(d)
      logs.value.push(`Measured run ${durations.value.length} of ${measured.value}: ${fmt(d)}`)
    }
    if (completed.value >= r.total) finish()
  }, 700)
}
function finish(): void {
  clearInterval(runTimer)
  logs.value.push(
    `Finished ${durations.value.length} measured runs (0 failed). Final response saved to ~/ComfyUI/user/performance-tests/${buildName.value.toLowerCase().replace(/\s+/g, '-')}`
  )
  phase.value = 'done'
  logsOpen.value = false
}
function stop(): void {
  phase.value = 'stopping'
  clearInterval(runTimer)
  setTimeout(() => {
    logs.value.push('Stopped.')
    durations.value = []
    ran.value = null
    phase.value = 'idle'
  }, 800)
}
onBeforeUnmount(() => {
  clearInterval(runTimer)
  clearInterval(dlTimer)
  clearTimeout(prepTimer)
})

const progressPercent = computed(() => (ran.value ? (completed.value / ran.value.total) * 100 : 0))
const runPhase = computed(() => {
  const r = ran.value
  if (!r) return ''
  const current = Math.min(completed.value + 1, r.total)
  return current <= r.warmups
    ? 'warm-up run'
    : `measured run ${current - r.warmups} of ${r.total - r.warmups}`
})
const segClass = (i: number): string => {
  const r = ran.value!
  if (i <= completed.value) return i <= r.warmups ? 'is-warm' : 'is-done'
  return i === completed.value + 1 ? 'is-now' : ''
}

const chart = computed(() => {
  if (phase.value !== 'done' || !durations.value.length) return null
  const s = [...durations.value].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  const median = s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
  const rows = [
    { label: 'Fastest run', seconds: s[0]! },
    { label: 'Median run', seconds: median },
    { label: 'Average run', seconds: s.reduce((a, b) => a + b, 0) / s.length },
    { label: 'Slowest run', seconds: s[s.length - 1]! }
  ]
  const max = Math.max(...rows.map((r) => r.seconds))
  return {
    median: fmt(median),
    count: s.length,
    rows: rows.map((r, i) => ({
      label: r.label,
      value: fmt(r.seconds),
      width: `${(r.seconds / max) * 100}%`,
      highlight: i === 1
    }))
  }
})

const SYSTEM = [
  { label: 'Compute device', value: 'NVIDIA GeForce RTX 4090' },
  { label: 'VRAM', value: '24 GB' },
  { label: 'RAM', value: '64 GB' },
  { label: 'PyTorch version', value: '2.9.0+cu128' },
  { label: 'xFormers version', value: '0.0.32' },
  { label: 'CPU', value: 'AMD Ryzen 9 7950X 16-Core Processor' },
  { label: 'CPU cores', value: '16' },
  { label: 'Operating system', value: 'Microsoft Windows 11 Pro 10.0.26100' },
  { label: 'Architecture', value: 'x64' }
]
const hasResult = computed(() => phase.value === 'done' && !!chart.value)
</script>

<template>
  <MarPage title="Performance Tests" state="live">
    <div class="mar-pt">
      <div class="mar-pt-setup">
        <div class="mar-pt-what">
          <DropdownMenuRoot :modal="false">
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                class="mar-pt-filter mar-pt-full max-w-64"
                :aria-label="buildName ? `Build: ${buildName}` : 'Select a build'"
                :disabled="!builds.length"
              >
                <span class="shrink-0 text-subtle-foreground">Build</span>
                <span class="truncate" :class="!buildName && 'text-muted-foreground'">{{
                  buildName || 'Select a build'
                }}</span>
                <ChevronDown :size="14" class="ml-auto shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="min-w-(--reka-dropdown-menu-trigger-width)">
              <div class="flex flex-col gap-0.5">
                <DropdownMenuItem
                  v-for="b in builds"
                  :key="b.value"
                  :class="b.value === build && 'bg-secondary-background font-medium'"
                  @select="build = b.value"
                  >{{ b.label }}</DropdownMenuItem
                >
              </div>
            </DropdownMenuContent>
          </DropdownMenuRoot>

          <div
            class="mar-pt-drop"
            :class="dragging && 'is-over'"
            @dragenter.prevent="dragging = !locked"
            @dragover.prevent="dragging = !locked"
            @dragleave.prevent="onLeave"
            @drop.prevent="onDrop"
          >
            <DropdownMenuRoot :modal="false">
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="mar-pt-filter mar-pt-full max-w-[26rem]"
                  :disabled="locked"
                  :title="workflow ? `~/ComfyUI/user/workflows/${workflow.name}` : undefined"
                >
                  <span class="shrink-0 text-subtle-foreground">Workflow</span>
                  <span v-if="shownName" class="flex min-w-0 items-center gap-1.5">
                    <span class="truncate">{{ shownName }}</span>
                    <span class="mar-pt-tag">{{ shownTag }}</span>
                  </span>
                  <span v-else class="truncate text-muted-foreground">Choose a workflow</span>
                  <ChevronDown :size="14" class="ml-auto shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="min-w-[260px]">
                <DropdownMenuItem :disabled="!build" @select="pickerOpen = true"
                  ><LayoutGrid :size="15" />Choose an example workflow</DropdownMenuItem
                >
                <DropdownMenuItem @select="importWorkflow()"
                  ><Upload :size="15" />Import API workflow<span
                    class="ml-auto pl-4 text-[12px] text-subtle-foreground"
                    >or drop the .json</span
                  ></DropdownMenuItem
                >
                <template v-if="workflow || pending">
                  <DropdownMenuSeparator />
                  <DropdownMenuItem class="mar-pt-danger" @select="deleteWorkflow"
                    ><Trash2 :size="15" />{{
                      download || pending ? 'Cancel download' : 'Delete workflow'
                    }}</DropdownMenuItem
                  >
                </template>
              </DropdownMenuContent>
            </DropdownMenuRoot>
          </div>
        </div>
        <div class="mar-pt-how">
          <div class="mar-pt-settings">
            <div v-for="s in SETTINGS" :key="s.id" class="mar-pt-chip">
              <label :for="`mar-pt-${s.id}`" class="whitespace-nowrap">{{ s.label }}</label>
              <Tooltip wrap :content="s.hint"
                ><Info :size="13" class="text-subtle-foreground"
              /></Tooltip>
              <input
                :id="`mar-pt-${s.id}`"
                v-model.number="s.model.value"
                type="number"
                :min="s.min"
                :max="s.max"
                step="1"
                :disabled="locked"
                @change="commit(s)"
                @blur="commit(s)"
              />
            </div>
          </div>

          <Button
            v-if="locked"
            class="mar-pt-run"
            variant="secondary"
            :disabled="phase === 'stopping'"
            @click="stop"
            ><Square :size="13" fill="currentColor" />{{
              phase === 'stopping' ? 'Stopping...' : 'Stop'
            }}</Button
          >
          <Button v-else class="mar-pt-run" variant="primary" :disabled="!canRun" @click="run"
            ><Play :size="14" fill="currentColor" />Run</Button
          >
        </div>
      </div>

      <p v-if="importError" class="mar-pt-status mar-pt-danger" role="alert">
        <CircleAlert :size="13" class="shrink-0" />{{ importError }}
      </p>
      <div v-if="pending || download" class="mar-pt-status">
        <template v-if="download">
          <span class="truncate">{{ download.message }}</span>
          <span class="mar-pt-dl" role="progressbar" :aria-valuenow="download.percent"
            ><span :style="{ width: `${download.percent}%` }"
          /></span>
        </template>
        <template v-else>Preparing workflow and downloading required models...</template>
      </div>

      <section class="mar-pt-section mt-6">
        <div class="mar-pt-head">
          <h2 class="mar-pt-label">Results</h2>
          <span v-if="ran" class="mar-pt-summary">
            <span class="text-base-foreground">{{ ran.workflow }}</span> on {{ ran.build }}
          </span>
          <div v-if="hasResult" class="mar-pt-actions">
            <button type="button" @click="toast('Opened the results folder')">
              <FolderOpen :size="15" />Open folder
            </button>
            <button type="button" @click="toast('Exported the results image')">
              <ImageDown :size="15" />Export results
            </button>
          </div>
        </div>
        <div class="mt-2.5">
          <div v-if="locked && ran" class="grid gap-4">
            <div class="flex items-baseline gap-2.5">
              <span class="mar-pt-run-no"
                >Run {{ Math.min(completed + 1, ran.total) }} of {{ ran.total }}</span
              >
              <span class="tabular-nums text-muted-foreground">{{ runPhase }}</span>
            </div>
            <div
              class="mar-pt-track"
              role="progressbar"
              aria-label="Progress"
              :aria-valuenow="completed"
              :aria-valuemax="ran.total"
            >
              <template v-if="ran.total <= 30">
                <i v-for="i in ran.total" :key="i" :class="segClass(i)" />
              </template>
              <span v-else class="mar-pt-track-one"
                ><i :style="{ width: `${progressPercent}%` }"
              /></span>
            </div>
          </div>
          <div v-else-if="chart" class="mar-pt-summary-grid">
            <div class="flex flex-col gap-2.5">
              <span class="mar-pt-median">{{ chart.median }}</span>
              <span class="text-[12.5px] text-muted-foreground"
                >Median run · {{ chart.count }} measured · 0 failed</span
              >
            </div>
            <dl class="m-0 grid min-w-0" aria-label="Run duration">
              <div v-for="r in chart.rows" :key="r.label" class="mar-pt-bar">
                <dt>{{ r.label }}</dt>
                <dd class="mar-pt-bar-track" aria-hidden="true">
                  <i :class="r.highlight && 'is-hi'" :style="{ width: r.width }" />
                </dd>
                <dd class="mar-pt-bar-value" :class="r.highlight && 'is-hi'">{{ r.value }}</dd>
              </div>
            </dl>
          </div>
          <div v-else class="pt-1 pb-1.5">
            <p class="m-0 mb-1.5 text-[15px] font-medium text-base-foreground">No results yet</p>
            <p class="m-0 text-ui text-muted-foreground">
              Choose a workflow and press Run. Results stay here until the next run.
            </p>
          </div>
        </div>
      </section>

      <section v-if="hasResult" class="mar-pt-section mt-9">
        <div class="mar-pt-head"><h2 class="mar-pt-label">System information</h2></div>
        <dl class="mar-pt-facts">
          <div v-for="f in SYSTEM" :key="f.label">
            <dt>{{ f.label }}</dt>
            <dd :title="f.value">{{ f.value }}</dd>
          </div>
        </dl>
      </section>

      <section class="mar-pt-section mt-9">
        <div class="mar-pt-head">
          <button
            type="button"
            class="mar-pt-toggle"
            :aria-expanded="logsOpen"
            @click="logsOpen = !logsOpen"
          >
            <ChevronRight :size="14" class="mar-pt-chev" :class="logsOpen && 'is-open'" />Logs
          </button>
          <span v-if="!logsOpen" class="mar-pt-summary mar-pt-mono">{{
            logs.at(-1) ?? 'Build logs will appear here.'
          }}</span>
        </div>
        <div v-show="logsOpen" class="mar-pt-logs mar-pt-mono">
          {{ logs.length ? logs.join('\n') : 'Build logs will appear here.' }}
        </div>
      </section>
    </div>

    <DialogRoot v-model:open="pickerOpen">
      <DialogContent size="md">
        <div class="flex flex-col gap-1.5 px-5 pt-5">
          <DialogTitle class="m-0 text-base font-semibold">Choose an example workflow</DialogTitle>
          <DialogDescription class="m-0 text-ui text-muted-foreground"
            >Missing models will be downloaded automatically.</DialogDescription
          >
        </div>
        <div class="flex flex-col gap-0.5 p-3">
          <button
            v-for="e in EXAMPLES"
            :key="e.file"
            type="button"
            class="mar-pt-example"
            :class="picked === e.file && 'is-on'"
            @click="picked = e.file"
          >
            <span class="text-ui font-medium text-base-foreground">{{ e.title }}</span>
            <span class="text-[12px] text-muted-foreground">{{ e.text }} · {{ e.file }}</span>
          </button>
        </div>
        <div class="flex justify-end gap-2 px-5 pb-5">
          <Button variant="secondary" size="lg" @click="pickerOpen = false">Cancel</Button>
          <Button variant="primary" size="lg" @click="useExample">Use workflow</Button>
        </div>
      </DialogContent>
    </DialogRoot>
  </MarPage>
</template>
