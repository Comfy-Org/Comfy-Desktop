<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  ArrowLeft,
  Copy,
  Loader2,
  RefreshCcw,
  SquareTerminal,
  TriangleAlert,
  Wrench
} from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import type { ProtoInstance } from '../../mock'
import { toast } from '../../useProto'
import { OFFLINE_COPY } from '../offline/connection'
import { activityAt, REPAIR_COPY, START_COPY, startFailures } from './comfyStart'
import { openBuild } from './buildTab'
import {
  cancelStart,
  leaveFailedStart,
  repairBuild,
  repairs,
  restartAfterFailure,
  runs,
  START_LOG,
  viewLogs
} from './homeRun'

const { inst } = defineProps<{ inst: ProtoInstance }>()

const run = computed(() => runs.get(inst.id))
const failure = computed(() => startFailures.get(inst.id))
const again = computed(() => (failure.value?.attempt ?? 1) >= 2)
const repairing = computed(() => repairs.get(inst.id))
function copyReport(): void {
  const text = [failure.value?.title, failure.value?.message, logLines.value].join('\n\n')
  void navigator.clipboard?.writeText(text).catch(() => {})
  toast(REPAIR_COPY.reportCopied)
}
const buildLine = computed(() =>
  [inst.name, inst.version && inst.version !== 'unknown' ? inst.version : '']
    .filter(Boolean)
    .join(' · ')
)

const now = ref(Date.now())
const clock = setInterval(() => (now.value = Date.now()), 250)
onBeforeUnmount(() => clearInterval(clock))

const PROCESS_MS = 1500
const secs = computed(() => Math.round((now.value - (run.value?.startedAt ?? now.value)) / 1000))
const status = computed(() => {
  const r = run.value
  if (!r) return ''
  if (r.connecting) return OFFLINE_COPY.connecting(secs.value)
  if (now.value - (r.startedAt ?? now.value) < PROCESS_MS) return START_COPY.process
  return START_COPY.waiting(secs.value)
})
const activity = computed(() =>
  run.value && !run.value.connecting ? activityAt(run.value.percent) : undefined
)
const logLines = computed(() =>
  failure.value && failure.value.kind !== 'cannot-connect'
    ? START_LOG.slice(-6)
        .map((l) => l.text)
        .concat(
          failure.value.kind === 'crashed'
            ? ['Process exited with code 1']
            : ['sqlite3.OperationalError: database is locked']
        )
        .join('\n')
    : ''
)
</script>

<template>
  <div
    class="flex min-h-0 flex-1 items-center justify-center p-6 text-base-foreground"
    data-starting-tab
    :data-state="repairing !== undefined ? 'repairing' : failure ? 'failed' : 'starting'"
  >
    <div
      v-if="repairing !== undefined"
      class="flex w-full max-w-[480px] min-w-0 flex-col items-center px-8 py-7 text-center"
      data-state="repairing"
    >
      <span
        class="inline-flex size-14 items-center justify-center rounded-full bg-secondary-background text-base-foreground"
      >
        <Wrench :size="24" />
      </span>
      <h2 class="m-0 mt-3 text-[18px] font-semibold">{{ REPAIR_COPY.repairing(inst.name) }}</h2>
      <p class="m-0 mt-1 text-[13px] text-muted-foreground">{{ buildLine }}</p>
      <div
        class="mt-5 h-1 w-64 overflow-hidden rounded-full bg-secondary-background-hover"
        role="progressbar"
        :aria-valuenow="repairing"
        :aria-label="REPAIR_COPY.repairing(inst.name)"
      >
        <span
          class="block h-full origin-left rounded-full bg-base-foreground"
          :style="{ transform: `scaleX(${repairing / 100})` }"
        />
      </div>
      <p class="m-0 mt-3 text-[13px] text-base-foreground tabular-nums" aria-live="polite">
        {{ REPAIR_COPY.repairSteps }} {{ repairing }}%
      </p>
    </div>

    <div
      v-else-if="failure"
      class="flex w-full max-w-[520px] flex-col items-center gap-3 text-center"
      role="alert"
      :aria-label="failure.title"
    >
      <span
        class="inline-flex size-14 items-center justify-center rounded-full bg-secondary-background text-status-danger"
      >
        <TriangleAlert :size="26" />
      </span>
      <h2 class="m-0 text-[18px] font-semibold">
        {{ again ? REPAIR_COPY.againTitle : failure.title }}
      </h2>
      <p class="m-0 text-[13px] leading-5 text-muted-foreground">
        {{ again ? REPAIR_COPY.againMessage : failure.message }}
      </p>
      <pre
        v-if="logLines"
        class="m-0 mt-1 max-h-36 w-full overflow-auto rounded-control bg-secondary-background p-3 text-left font-mono text-[11px] leading-[1.5] whitespace-pre-wrap text-muted-foreground"
        >{{ logLines }}</pre>
      <div v-if="again" class="mt-2 flex flex-col items-center gap-2" data-start-again>
        <div class="flex items-center gap-2">
          <Button variant="secondary" size="md" @click="restartAfterFailure(inst)">
            <RefreshCcw :size="14" />{{ START_COPY.restart }}
          </Button>
          <Button variant="primary" size="md" @click="repairBuild(inst)">
            <Wrench :size="14" />{{ REPAIR_COPY.repair }}
          </Button>
        </div>
        <div class="flex items-center gap-1">
          <Button variant="ghost" size="md" @click="copyReport">
            <Copy :size="14" />{{ REPAIR_COPY.copyReport }}
          </Button>
          <Button variant="ghost" size="md" @click="openBuild(inst.id, 'terminal')">
            <SquareTerminal :size="14" />{{ REPAIR_COPY.terminal }}
          </Button>
          <Button variant="ghost" size="md" @click="leaveFailedStart(inst)">
            <ArrowLeft :size="14" />{{ START_COPY.backToHome }}
          </Button>
        </div>
      </div>
      <div v-else class="mt-2 flex items-center gap-2">
        <Button variant="ghost" size="md" @click="leaveFailedStart(inst)">
          <ArrowLeft :size="14" />{{ START_COPY.backToHome }}
        </Button>
        <Button variant="primary" size="md" @click="restartAfterFailure(inst)">
          <RefreshCcw :size="14" />{{ START_COPY.restart }}
        </Button>
      </div>
    </div>

    <div
      v-else-if="run"
      class="flex w-full max-w-[480px] min-w-0 flex-col items-center px-8 py-7 text-center"
      data-state="placeholder"
    >
      <div class="inline-flex size-14 items-center justify-center text-base-foreground">
        <Loader2 :size="32" class="animate-spin motion-reduce:animate-none" />
      </div>
      <h2 class="m-0 mt-3 text-[18px] font-semibold">{{ START_COPY.title }}</h2>
      <p
        v-if="buildLine"
        class="m-0 mt-1 max-w-full truncate text-[13px] text-muted-foreground"
        :title="buildLine"
      >
        {{ buildLine }}
      </p>
      <div
        class="mar-start-bar mt-5 h-1 w-64 overflow-hidden rounded-full bg-secondary-background-hover"
        role="progressbar"
        :aria-label="START_COPY.title"
      >
        <span class="block h-full w-1/3 rounded-full bg-base-foreground" />
      </div>
      <p class="m-0 mt-3 text-[13px] text-base-foreground tabular-nums" aria-live="polite">
        {{ status }}
      </p>
      <p class="m-0 mt-1 h-5 text-[12px] text-muted-foreground">{{ activity }}</p>
      <div class="mt-4 flex items-center gap-2">
        <Button variant="ghost" size="md" @click="cancelStart(inst)">{{
          START_COPY.cancel
        }}</Button>
        <Button v-if="!run.connecting" variant="secondary" size="md" @click="viewLogs(inst)">{{
          START_COPY.viewLogs
        }}</Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mar-start-bar > span {
  animation: mar-start-slide 1.4s ease-in-out infinite;
}
@keyframes mar-start-slide {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(300%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mar-start-bar > span {
    animation: none;
    transform: translateX(100%);
  }
}
</style>
