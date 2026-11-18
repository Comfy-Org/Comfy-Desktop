<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  ArrowDownToLine,
  CircleAlert,
  FileBox,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  X
} from 'lucide-vue-next'
import { PopoverRoot, PopoverTrigger } from 'reka-ui'
import PopoverContent from '../../ui/PopoverContent.vue'
import { toast } from '../../useProto'

/**
 * The title bar's downloads (Mar's proposal for Desktop's downloads
 * popup). Rows, not cards: a 32px tile (the picture for an image, a file
 * icon for a model), the file name, "folder · size" under it, and a thin
 * 3px bar under the text while it downloads. Pause, retry and cancel stay
 * in view; open folder and remove show on hover. A failure is red, with
 * its reason. IN PROGRESS and RECENT as uppercase sections, no borders,
 * the panel a step lighter. Empty, it says what will land here.
 */
interface Row {
  id: string
  name: string
  folder: string
  thumb?: string
  status: 'downloading' | 'paused' | 'completed' | 'error'
  /** 0 to 1. */
  progress: number
  totalMb: number
  speed?: number
  error?: string
}

const pic = (slot: string): string =>
  new URL(`../assets/mock/asset-${slot}.webp`, import.meta.url).href

const START: Row[] = [
  {
    id: 'flux',
    name: 'flux1-dev-fp8.safetensors',
    folder: 'checkpoints',
    status: 'downloading',
    progress: 0.42,
    totalMb: 11900,
    speed: 48
  },
  {
    id: 'lora',
    name: 'detail-tweaker-xl.safetensors',
    folder: 'loras',
    status: 'downloading',
    progress: 0.78,
    totalMb: 228,
    speed: 31
  },
  {
    id: 'lake',
    name: 'alpine_lake_00012.png',
    folder: 'output',
    thumb: pic('alpine-lake'),
    status: 'completed',
    progress: 1,
    totalMb: 3.4
  },
  {
    id: 'vae',
    name: 'ae.safetensors',
    folder: 'vae',
    status: 'error',
    progress: 0.31,
    totalMb: 335,
    error: 'Not enough disk space'
  },
  {
    id: 'astro',
    name: 'astronaut_sunflowers_00004.png',
    folder: 'output',
    thumb: pic('astronaut-sunflowers'),
    status: 'completed',
    progress: 1,
    totalMb: 2.9
  }
]
const rows = reactive<Row[]>(START.map((r) => ({ ...r })))
const active = computed(() =>
  rows.filter((r) => r.status === 'downloading' || r.status === 'paused')
)
const recent = computed(() => rows.filter((r) => r.status === 'completed' || r.status === 'error'))
const groups = computed(() => [
  { label: 'In progress', items: active.value },
  { label: 'Recent', items: recent.value }
])

function size(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
}
function sub(r: Row): string {
  if (r.status === 'error') return `Failed · ${r.error}`
  if (r.status === 'completed') return `${r.folder} · ${size(r.totalMb)}`
  const done = `${size(r.totalMb * r.progress)} of ${size(r.totalMb)}`
  if (r.status === 'paused') return `${done} · Paused`
  const left = Math.max(1, Math.round((r.totalMb * (1 - r.progress)) / (r.speed ?? 1)))
  const eta = left >= 60 ? `${Math.round(left / 60)} min` : `${left} s`
  return `${done} · ${r.speed} MB/s · ${eta} left`
}
const remove = (r: Row): void => {
  rows.splice(rows.indexOf(r), 1)
}
const retry = (r: Row): void => {
  r.status = 'downloading'
  r.progress = 0
  r.speed = 40
  r.error = undefined
}

const open = ref(false)
// While it's open, the downloads move.
let timer: ReturnType<typeof setInterval> | undefined
watch(open, (o) => {
  clearInterval(timer)
  if (!o) return
  timer = setInterval(() => {
    for (const r of rows) {
      if (r.status !== 'downloading') continue
      r.progress = Math.min(1, r.progress + (r.speed ?? 30) / r.totalMb / 2)
      if (r.progress >= 1) r.status = 'completed'
    }
  }, 500)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        aria-label="Downloads"
        title="Downloads"
        class="mar-dl-trigger"
        :class="open && 'is-open'"
      >
        <ArrowDownToLine :size="15" />
        <span v-if="active.length" class="mar-dl-dot" aria-hidden="true"></span>
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" :side-offset="8" class="proto-ui mar-dl" role="dialog">
      <div v-if="!rows.length" class="mar-dl-empty">
        <span class="mar-dl-empty-title">No downloads yet</span>
        <span class="mar-dl-empty-text">Models and images you download show up here.</span>
      </div>
      <template v-for="g in groups" :key="g.label">
        <template v-if="g.items.length">
          <p class="mar-dl-sec">{{ g.label }}</p>
          <ul class="mar-dl-list">
            <li v-for="r in g.items" :key="r.id" class="mar-dl-row">
              <span class="mar-dl-tile">
                <img v-if="r.thumb" :src="r.thumb" alt="" />
                <CircleAlert v-else-if="r.status === 'error'" :size="16" class="is-bad" />
                <FileBox v-else :size="16" />
              </span>
              <span class="mar-dl-text">
                <span class="mar-dl-name" :title="r.name">{{ r.name }}</span>
                <span class="mar-dl-sub" :class="r.status === 'error' && 'is-bad'">{{
                  sub(r)
                }}</span>
                <span
                  v-if="r.status === 'downloading' || r.status === 'paused'"
                  class="mar-dl-bar"
                  aria-hidden="true"
                  ><span :style="{ transform: `scaleX(${r.progress})` }"></span
                ></span>
              </span>
              <!-- Pause, retry and cancel stay; open folder and remove on hover. -->
              <span class="mar-dl-tools" :class="r.status === 'completed' && 'on-hover'">
                <button
                  v-if="r.status === 'downloading'"
                  type="button"
                  aria-label="Pause"
                  title="Pause"
                  @click="r.status = 'paused'"
                >
                  <Pause :size="14" />
                </button>
                <button
                  v-else-if="r.status === 'paused'"
                  type="button"
                  aria-label="Resume"
                  title="Resume"
                  @click="r.status = 'downloading'"
                >
                  <Play :size="14" />
                </button>
                <button
                  v-if="r.status === 'error'"
                  type="button"
                  aria-label="Retry"
                  title="Retry"
                  @click="retry(r)"
                >
                  <RotateCcw :size="14" />
                </button>
                <button
                  v-if="r.status === 'completed'"
                  type="button"
                  aria-label="Open folder"
                  title="Open folder"
                  @click="toast(`Opened ${r.folder}`)"
                >
                  <FolderOpen :size="14" />
                </button>
                <button
                  type="button"
                  :aria-label="
                    r.status === 'completed' || r.status === 'error' ? 'Remove' : 'Cancel'
                  "
                  :title="r.status === 'completed' || r.status === 'error' ? 'Remove' : 'Cancel'"
                  @click="remove(r)"
                >
                  <X :size="14" />
                </button>
              </span>
            </li>
          </ul>
        </template>
      </template>
    </PopoverContent>
  </PopoverRoot>
</template>

<style>
.mar-dl-trigger {
  position: relative;
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: var(--radius-control, 8px);
  color: var(--color-muted-foreground);
  transition: background-color 140ms ease;
}
.mar-dl-trigger:hover,
.mar-dl-trigger.is-open {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
.mar-dl-dot {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-base-foreground);
}
/* The panel a step lighter than the page, no stroke. */
:root .proto-ui.proto-ui.proto-ui.mar-dl {
  z-index: 60;
  display: flex;
  width: 360px;
  max-height: min(520px, calc(100vh - 80px));
  flex-direction: column;
  overflow: auto;
  padding: 4px;
  border: 0;
  border-radius: 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, var(--color-content-background));
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.35);
}
.mar-dl-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 32px 16px;
  text-align: center;
}
.mar-dl-empty-title {
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
}
.mar-dl-empty-text {
  color: var(--color-muted-foreground);
  font-size: 12px;
}
.mar-dl-sec {
  margin: 0;
  padding: 12px 12px 6px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.mar-dl-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.mar-dl-row {
  display: flex;
  min-height: 48px;
  align-items: center;
  gap: 12px;
  padding: 6px 8px;
  border-radius: 8px;
  transition: background-color 140ms ease;
}
.mar-dl-row:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
.mar-dl-tile {
  display: grid;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  place-items: center;
  overflow: hidden;
  border-radius: 6px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-muted-foreground);
}
.mar-dl-tile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mar-dl-tile .is-bad,
.mar-dl-sub.is-bad {
  color: var(--color-destructive-background, #ff6b6b);
}
.mar-dl-text {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
}
.mar-dl-name {
  overflow: hidden;
  color: var(--color-base-foreground);
  font-size: 13px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-dl-sub {
  overflow: hidden;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-dl-bar {
  height: 3px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mar-dl-bar > span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--color-base-foreground);
  transform-origin: left;
  transition: transform 480ms linear;
}
.mar-dl-tools {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
  transition: opacity 140ms ease;
}
.mar-dl-tools button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 6px;
  color: var(--color-muted-foreground);
}
.mar-dl-tools button:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
.mar-dl-tools.on-hover {
  opacity: 0;
}
.mar-dl-row:hover .mar-dl-tools.on-hover,
.mar-dl-tools.on-hover:focus-within {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .mar-dl-bar > span,
  .mar-dl-tools {
    transition: none;
  }
}
</style>
