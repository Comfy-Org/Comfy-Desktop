<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive } from 'vue'
import { Pause, Play } from 'lucide-vue-next'
import { toast } from '../../useProto'
import portraitSun from '../assets/portrait-sun.jpg'
import portraitSeaside from '../assets/portrait-seaside.jpg'
import hillsFog from '../assets/hills-fog.jpg'
import portraitSmile from '../assets/portrait-smile.jpg'
import lakeFog from '../assets/lake-fog.jpg'
import portraitGrass from '../assets/portrait-grass.jpg'

/**
 * 06 · Queue first (Figma 117:2130): what is running, what waits and what
 * finished today, always in view on the right. Each item shows its thumb,
 * progress and time left. Mock data; the running job advances on its own
 * and the next one in line takes over when it finishes.
 */
interface Job {
  id: string
  name: string
  src: string
  build: string
  /** Sampling steps for the whole run. */
  steps: number
  /** Running: 0-100. */
  progress: number
  /** Done: run time and outputs. */
  took?: string
  outputs?: number
}

const STEP_SECONDS = 2.5
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const q = reactive({
  paused: false,
  running: {
    id: 'product-relight',
    name: 'product-relight',
    src: portraitSun,
    build: 'My Local 1',
    steps: 28,
    progress: 62
  } as Job | null,
  queued: [
    { id: 'hero-shot-v5', name: 'hero-shot-v5', src: portraitSeaside, build: 'My Local 1' },
    { id: 'angles-sheet', name: 'angles-sheet', src: hillsFog, build: 'My Local 1' },
    { id: 'banana-edit-batch', name: 'banana-edit-batch', src: portraitSmile, build: 'My Local 1' }
  ].map((j) => ({ ...j, steps: 28, progress: 0 })) as Job[],
  done: [
    {
      id: 'rice-terraces-i2v',
      name: 'rice-terraces-i2v',
      src: lakeFog,
      build: 'Video Lab',
      steps: 30,
      progress: 100,
      took: '1:12',
      outputs: 4
    },
    {
      id: 'flux-portraits',
      name: 'flux-portraits',
      src: portraitGrass,
      build: 'Flux Sandbox',
      steps: 20,
      progress: 100,
      took: '0:38',
      outputs: 8
    }
  ] as Job[]
})

const step = computed(() =>
  q.running ? Math.max(1, Math.round((q.running.progress / 100) * q.running.steps)) : 0
)
const left = computed(() =>
  q.running ? clock(Math.round((q.running.steps - step.value) * STEP_SECONDS)) : ''
)
const summary = computed(() => {
  if (q.paused) return `Paused · ${q.queued.length} queued`
  const r = q.running ? '1 running' : 'Idle'
  return q.queued.length ? `${r} · ${q.queued.length} queued` : r
})

// The running job moves on; when it ends it joins Done today and the next
// one starts.
let timer: ReturnType<typeof setInterval> | undefined
function tick(): void {
  const r = q.running
  if (q.paused || !r) return
  r.progress = Math.min(100, r.progress + 1)
  if (r.progress < 100) return
  q.done.unshift({ ...r, took: clock(Math.round(r.steps * STEP_SECONDS)), outputs: 4 })
  q.running = q.queued.shift() ?? null
}
onMounted(() => {
  timer = setInterval(tick, 900)
})
onBeforeUnmount(() => clearInterval(timer))

function togglePause(): void {
  q.paused = !q.paused
  toast(q.paused ? 'Queue paused' : 'Queue resumed')
}
function clearDone(): void {
  q.done.splice(0)
  toast('Cleared finished runs')
}
</script>

<template>
  <aside class="p06-queue" aria-label="Queue">
    <header class="p06-head">
      <h2 class="p06-title">Queue</h2>
      <span class="p06-chip">{{ summary }}</span>
    </header>

    <div class="p06-scroll">
      <template v-if="q.running">
        <p class="p06-label">Running</p>
        <div class="p06-item is-running">
          <img :src="q.running.src" alt="" class="p06-thumb" />
          <div class="p06-body">
            <div class="p06-line">
              <span class="p06-name">{{ q.running.name }}</span>
              <span class="p06-aside">{{ q.running.progress }}%</span>
            </div>
            <div
              class="p06-track"
              role="progressbar"
              :aria-valuenow="q.running.progress"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="`${q.running.name} progress`"
            >
              <span class="is-live" :style="{ width: `${q.running.progress}%` }" />
            </div>
            <p class="p06-meta">
              {{ q.paused ? 'Paused' : 'Sampling' }} · step {{ step }} of {{ q.running.steps }} ·
              {{ left }} left
            </p>
          </div>
        </div>
      </template>

      <template v-if="q.queued.length">
        <p class="p06-label">Queued</p>
        <div v-for="(j, i) in q.queued" :key="j.id" class="p06-item">
          <img :src="j.src" alt="" class="p06-thumb" />
          <div class="p06-body">
            <div class="p06-line">
              <span class="p06-name">{{ j.name }}</span>
              <span class="p06-aside">#{{ i + 2 }}</span>
            </div>
            <div class="p06-track" aria-hidden="true"><span /></div>
            <p class="p06-meta">Waiting · {{ j.build }}</p>
          </div>
        </div>
      </template>

      <template v-if="q.done.length">
        <p class="p06-label">Done today</p>
        <div v-for="j in q.done" :key="j.id" class="p06-item is-done">
          <img :src="j.src" alt="" class="p06-thumb" />
          <div class="p06-body">
            <div class="p06-line">
              <span class="p06-name">{{ j.name }}</span>
              <span class="p06-aside">{{ j.took }}</span>
            </div>
            <p class="p06-meta">{{ j.build }} · {{ j.outputs }} outputs</p>
          </div>
        </div>
      </template>

      <p v-if="!q.running && !q.queued.length && !q.done.length" class="p06-empty">
        Nothing in the queue. Runs you start show up here.
      </p>
    </div>

    <footer class="p06-foot">
      <button type="button" class="p06-btn" @click="togglePause">
        <Play v-if="q.paused" :size="13" /><Pause v-else :size="13" />
        {{ q.paused ? 'Resume queue' : 'Pause queue' }}
      </button>
      <button type="button" class="p06-link" :disabled="!q.done.length" @click="clearDone">
        Clear done
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.p06-queue {
  position: fixed;
  top: var(--mar-chrome, 0px);
  right: 0;
  bottom: 0;
  z-index: 30;
  display: flex;
  width: 340px;
  flex-direction: column;
  background: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  backdrop-filter: blur(32px) saturate(1.2);
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  -webkit-app-region: no-drag;
}
.p06-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 16px 16px 4px;
}
.p06-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.p06-chip {
  display: inline-flex;
  height: 22px;
  align-items: center;
  padding: 0 9px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-muted-foreground);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.p06-scroll {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  padding: 0 8px 12px;
  scrollbar-width: none;
}
.p06-label {
  padding: 16px 8px 6px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.p06-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: 14px;
  transition: background-color 150ms ease;
}
.p06-item:hover,
.p06-item.is-running {
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
.p06-thumb {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 10px;
  object-fit: cover;
}
.p06-body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 5px;
}
.p06-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.p06-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.p06-aside {
  flex-shrink: 0;
  color: var(--color-subtle-foreground);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.p06-track {
  display: block;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.p06-track > span {
  display: block;
  width: 2%;
  height: 100%;
  border-radius: inherit;
  background: color-mix(in oklch, var(--color-base-foreground) 30%, transparent);
}
.p06-track > span.is-live {
  background: var(--color-status-running);
  transition: width 600ms cubic-bezier(0.16, 1, 0.3, 1);
}
.p06-meta {
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.p06-item.is-done .p06-body {
  gap: 3px;
}
.p06-empty {
  padding: 24px 8px;
  color: var(--color-subtle-foreground);
}
.p06-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 16px;
}
@media (prefers-reduced-motion: reduce) {
  .p06-track > span.is-live {
    transition: none;
  }
}
</style>

<style>
/* Pablo's reset wipes padding and width on buttons inside .proto-ui. */
:root .proto-ui.proto-ui.proto-ui .p06-btn {
  display: inline-flex;
  width: auto;
  height: 32px;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  transition: background-color 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui .p06-btn:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .p06-link {
  width: auto;
  padding: 4px 0;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  transition: color 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui .p06-link:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .p06-link:disabled {
  opacity: 0.4;
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui :is(.p06-btn, .p06-link):focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}

/* The page leaves room for the panel on the right. */
:root[data-mar-ui='on'][data-mar-panel='queue'] .proto-main.proto-main {
  padding-right: 340px;
}
</style>
