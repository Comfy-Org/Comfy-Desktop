<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Check, ChevronDown, Copy, LoaderCircle, TriangleAlert } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { toast } from '../../useProto'

/**
 * A build's progress with its logs (Desktop's BuildProgressDialog): the
 * steps in words on the left, one showcase clip on the right, and the log
 * under both across the whole width. The log opens on its newest line and
 * follows it until you scroll up. Install (MarSetupFlow.vue) and start
 * (build/BuildLogs.vue) draw it the same.
 */
export interface ProgressStep {
  label: string
  /** By its name, for the one step that knows its size. */
  pct?: number
  detail?: string
}
const {
  steps,
  now,
  failed = false,
  log
} = defineProps<{
  steps: ProgressStep[]
  now: number
  failed?: boolean
  log: { text: string; error?: boolean }[]
}>()
const logsOpen = defineModel<boolean>('logs', { default: false })

function rowState(i: number): string {
  if (i < now) return 'is-done'
  if (i > now) return 'is-next'
  return failed ? 'is-fail' : 'is-now'
}

const imgUrl = (f: string): string => new URL(`../assets/${f}`, import.meta.url).href
// The wait's outputs: today's showcase clips, one at a time in one square.
const CLIPS = [
  { id: 'eye', src: './install-showcase-scene/Assets/eye.webm', poster: 'mock/clip-eye.jpg' },
  {
    id: 'clouds',
    src: './install-showcase-scene/Assets/clouds.webm',
    poster: 'mock/clip-clouds.jpg'
  },
  {
    id: 'mountains',
    src: './install-showcase-scene/Assets/dusk_mountains.webm',
    poster: 'mock/clip-dusk-mountains.jpg'
  },
  {
    id: 'flower',
    src: './install-showcase-scene/Assets/flower.webm',
    poster: 'mock/clip-flower.jpg'
  }
]

// Follow the newest line, unless the reader scrolled up.
const box = ref<HTMLElement | null>(null)
const atBottom = ref(true)
function onScroll(): void {
  const el = box.value
  if (el) atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 4
}
function toBottom(): void {
  const el = box.value
  if (el) el.scrollTop = el.scrollHeight
}
watch(box, (el) => el && atBottom.value && toBottom(), { flush: 'post' })
watch(
  () => log.length,
  async () => {
    if (!atBottom.value) return
    await nextTick()
    toBottom()
  }
)
</script>

<template>
  <section class="mss-inst mss-inst-square" :class="failed && 'is-err'">
    <div class="mss-inst-main">
      <ol class="mss-inst-steps" aria-live="polite">
        <li
          v-for="(p, i) in steps"
          :key="p.label"
          class="mss-inst-step"
          :class="rowState(i)"
          :aria-current="i === now ? 'step' : undefined"
        >
          <span class="mss-inst-icon" aria-hidden="true">
            <Check v-if="i < now" :size="12" stroke-width="3" />
            <TriangleAlert v-else-if="i === now && failed" :size="13" />
            <LoaderCircle v-else-if="i === now" :size="14" class="mss-spin" />
          </span>
          <span class="mss-inst-text">
            <span class="mss-inst-label"
              >{{ p.label
              }}<span v-if="i === now && p.pct !== undefined" class="mss-inst-pct tabular-nums"
                >{{ Math.round(p.pct) }}%</span
              ></span
            >
            <span v-if="i === now && p.detail" class="mss-inst-detail tabular-nums">{{
              p.detail
            }}</span>
          </span>
        </li>
      </ol>
    </div>
    <div v-if="!failed" class="mss-inst-media" aria-hidden="true">
      <video
        v-for="(c, i) in CLIPS"
        :key="c.id"
        :style="{ animationDelay: `${i * 6}s` }"
        :src="c.src"
        :poster="imgUrl(c.poster)"
        autoplay
        muted
        loop
        playsinline
      ></video>
    </div>
  </section>
  <div class="mss-inst-log">
    <button
      type="button"
      class="mss-logs-toggle justify-self-start"
      :aria-expanded="logsOpen"
      @click="logsOpen = !logsOpen"
    >
      <ChevronDown :size="14" :class="logsOpen && 'rotate-180'" />View logs
    </button>
    <pre
      v-if="logsOpen || failed"
      ref="box"
      class="mss-logs"
      @scroll="onScroll"
    ><template v-for="(l, i) in log" :key="i"><span :class="l.error && 'e'">{{ l.text }}</span>{{ i < log.length - 1 ? '\n' : '' }}</template></pre>
    <Button v-if="failed" size="sm" class="justify-self-start" @click="toast('Copied')"
      ><Copy :size="14" />Copy</Button
    >
  </div>
</template>
