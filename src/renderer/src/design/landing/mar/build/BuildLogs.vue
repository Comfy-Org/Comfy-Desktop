<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../../ui/Button.vue'
import DialogContent from '../../ui/DialogContent.vue'
import { instanceById } from '../../useProto'
import BuildProgress from '../setup/BuildProgress.vue'
import '../setup/setup.css'
import { START_LOG, START_STEPS, UPDATE_LOG, UPDATE_STEPS, cancelRun, logs, runs } from './homeRun'

/**
 * A build's View logs (a click on its Home tile, or View logs in its menu).
 * Starting or updating: the steps in words, the clip, the log under both;
 * Cancel stops it, and it closes on its own once ComfyUI opens. No Cloud
 * pitch: Cloud is a build on the Home behind it. Running: the build's
 * ComfyUI log window (Comfy-Desktop#2213), everything ComfyUI printed since
 * it started, on its newest line, following the new ones.
 */
const inst = computed(() => (logs.id ? instanceById(logs.id) : undefined))
const run = computed(() => (logs.id ? runs.get(logs.id) : undefined))
const live = computed(() => Boolean(inst.value && logs.running && !run.value))
const open = computed({
  get: () =>
    Boolean(
      inst.value && (run.value?.kind === 'start' || run.value?.kind === 'update' || live.value)
    ),
  set: (v) => {
    if (!v) {
      logs.id = ''
      logs.running = false
    }
  }
})
const updating = computed(() => run.value?.kind === 'update')
const STEPS = computed(() => (updating.value ? UPDATE_STEPS : START_STEPS))
const percent = computed(() => run.value?.percent ?? 0)
const now = computed(() => {
  const i = STEPS.value.findIndex((s) => percent.value < s.until)
  return i < 0 ? STEPS.value.length - 1 : i
})
const steps = computed(() => STEPS.value.map((s) => ({ label: s.label })))
const log = computed(() =>
  (updating.value ? UPDATE_LOG : START_LOG).filter((l) => l.at <= percent.value)
)
// Opened from View logs: the log shows.
const logsOpen = ref(true)
watch(open, (o) => o && (logsOpen.value = true))
function cancel(): void {
  if (inst.value) cancelRun(inst.value)
}

// Running: the whole output, then a new line now and then.
const LIVE = [
  'got prompt',
  'Requested to load SDXLClipModel',
  'loaded completely 9.5 GB',
  '100%|██████████| 20/20 [00:04<00:00,  4.61it/s]',
  'Prompt executed in 5.12 seconds'
]
const extra = ref<string[]>([])
const liveText = computed(() => [...START_LOG.map((x) => x.text), ...extra.value].join('\n'))
const box = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setInterval> | undefined
watch(
  live,
  async (on) => {
    clearInterval(timer)
    extra.value = []
    if (!on) return
    await nextTick()
    if (box.value) box.value.scrollTop = box.value.scrollHeight
    let n = 0
    timer = setInterval(() => {
      extra.value.push(LIVE[n++ % LIVE.length]!)
      void nextTick(() => {
        const el = box.value
        if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 40)
          el.scrollTop = el.scrollHeight
      })
    }, 1600)
  },
  { immediate: true }
)
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent size="lg" class="mar-wizard mss w-[min(760px,calc(100vw-48px))] p-0">
      <div v-if="live" class="mar-wizard-body mss-body">
        <DialogTitle as="h3" class="text-title font-semibold"
          >{{ inst?.name ?? 'ComfyUI' }} logs</DialogTitle
        >
        <pre ref="box" class="mss-logs mbl-live">{{ liveText }}</pre>
      </div>
      <template v-else>
        <div class="mar-wizard-body mss-body mss-body-inst">
          <DialogTitle as="h3" class="text-title font-semibold"
            >{{ updating ? 'Updating' : 'Starting' }} {{ inst?.name ?? 'ComfyUI' }}</DialogTitle
          >
          <BuildProgress v-model:logs="logsOpen" :steps :now :log />
        </div>
        <footer class="mar-wizard-foot mss-foot">
          <Button variant="secondary" size="lg" class="ml-auto" @click="cancel">Cancel</Button>
        </footer>
      </template>
    </DialogContent>
  </DialogRoot>
</template>

<style>
.mss-logs.mbl-live {
  height: min(420px, 60vh);
  max-height: none;
  margin-top: 16px;
}
</style>
