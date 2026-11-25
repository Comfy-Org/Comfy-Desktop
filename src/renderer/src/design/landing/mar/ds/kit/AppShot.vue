<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { AppAction } from '../appActions'
import { frameUrl } from './frameUrl'

/**
 * The whole prototype in a frame of its own, on `page` (in `mode`), with
 * the Page state and knob values (`seed`) given, after `run` (opens a
 * modal…). 1280 × 800 scaled to the cell; live. `crop` ([x, y, w, h] in
 * app pixels) shows only that part, larger.
 */
const {
  label,
  page,
  mode,
  pageState,
  run,
  seed,
  width = 1280,
  height = 800,
  crop
} = defineProps<{
  label?: string
  page?: string
  mode?: 'create' | 'build' | 'agent'
  pageState?: 'live' | 'loading' | 'empty' | 'error'
  run?: AppAction
  seed?: Record<string, unknown>
  width?: number
  height?: number
  crop?: [x: number, y: number, w: number, h: number]
}>()
const src = frameUrl('app', { page, mode, pageState, run }, seed)

const [cx, cy, cw, ch] = crop ?? [0, 0, width, height]
const box = ref<HTMLElement>()
const scale = ref(0.5)
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(([e]) => (scale.value = e!.contentRect.width / cw))
  ro.observe(box.value!)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <figure class="ds-cell">
    <div ref="box" class="ds-window" :style="{ height: `${ch * scale}px` }">
      <iframe
        :src
        :title="label ?? page ?? 'app'"
        class="ds-app-shot"
        loading="lazy"
        :style="{
          width: `${width}px`,
          height: `${height}px`,
          transform: `scale(${scale}) translate(${-cx}px, ${-cy}px)`
        }"
      />
    </div>
    <figcaption v-if="label" class="ds-cell-label">{{ label }}</figcaption>
  </figure>
</template>
