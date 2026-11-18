<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../../ui/Button.vue'
import DialogContent from '../../ui/DialogContent.vue'
import { instanceById } from '../../useProto'
import BuildProgress from '../setup/BuildProgress.vue'
import '../setup/setup.css'
import { START_LOG, START_STEPS, cancelRun, logs, runs } from './homeRun'

/**
 * A starting build's View logs (a click on its Home tile, or View logs in
 * its menu): the start's steps in words, the clip, the log under both. No
 * Cloud pitch: Cloud is a build on the Home behind it. Cancel stops the
 * start; it closes on its own once ComfyUI opens.
 */
const inst = computed(() => (logs.id ? instanceById(logs.id) : undefined))
const run = computed(() => (logs.id ? runs.get(logs.id) : undefined))
const open = computed({
  get: () => Boolean(inst.value && run.value?.kind === 'start'),
  set: (v) => {
    if (!v) logs.id = ''
  }
})
const percent = computed(() => run.value?.percent ?? 0)
const now = computed(() => {
  const i = START_STEPS.findIndex((s) => percent.value < s.until)
  return i < 0 ? START_STEPS.length - 1 : i
})
const steps = START_STEPS.map((s) => ({ label: s.label }))
const log = computed(() => START_LOG.filter((l) => l.at <= percent.value))
// Opened from View logs: the log shows.
const logsOpen = ref(true)
watch(open, (o) => o && (logsOpen.value = true))
function cancel(): void {
  if (inst.value) cancelRun(inst.value)
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent size="lg" class="mar-wizard mss w-[min(760px,calc(100vw-48px))] p-0">
      <div class="mar-wizard-body mss-body mss-body-inst">
        <DialogTitle as="h3" class="text-title font-semibold"
          >Starting {{ inst?.name ?? 'ComfyUI' }}</DialogTitle
        >
        <BuildProgress v-model:logs="logsOpen" :steps :now :log />
      </div>
      <footer class="mar-wizard-foot mss-foot">
        <Button variant="secondary" size="lg" class="ml-auto" @click="cancel">Cancel</Button>
      </footer>
    </DialogContent>
  </DialogRoot>
</template>
