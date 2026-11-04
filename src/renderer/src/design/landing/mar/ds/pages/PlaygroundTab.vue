<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Value } from '../play'

/**
 * A component page's Playground tab: the playground itself is a frame of
 * Mar's components (kit/PlayFrame.vue), in its own theme. This keeps the
 * state in the address (#/buttons?tab=playground&p=…), so a link shares it.
 * Theme and corners rebuild the frame; props and background don't.
 */
const { page, spec } = defineProps<{ page: string; spec: string }>()

interface State {
  p: Record<string, Value>
  bg: string
  theme: string
  corners: string
}
function read(): State {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const p = ((): Record<string, Value> => {
    try {
      return JSON.parse(q.get('p') ?? '{}')
    } catch {
      return {}
    }
  })()
  return {
    p,
    bg: q.get('bg') === 'image' ? 'image' : 'page',
    theme: q.get('theme') === 'light' ? 'light' : 'dark',
    corners: q.get('corners') === 'default' ? 'default' : 'soft'
  }
}
const state = ref<State>(read())
// What the frame starts from; props then travel as messages.
const start = ref<State>(state.value)

function write(s: State): void {
  const q = new URLSearchParams({
    tab: 'playground',
    theme: s.theme,
    corners: s.corners,
    bg: s.bg
  })
  if (Object.keys(s.p).length) q.set('p', JSON.stringify(s.p))
  history.replaceState(null, '', `#/${page}?${q}`)
}

const height = ref(560)
const frame = ref<HTMLIFrameElement>()
function onMessage(e: MessageEvent): void {
  if (e.source !== frame.value?.contentWindow) return
  if (e.data?.type === 'mar-ds:height') height.value = e.data.h
  if (e.data?.type !== 'mar-ds:play-state') return
  const next: State = {
    p: e.data.p,
    bg: e.data.bg,
    theme: e.data.theme,
    corners: e.data.corners
  }
  const rebuild = ['theme', 'corners'].some(
    (k) => next[k as keyof State] !== state.value[k as keyof State]
  )
  state.value = next
  if (rebuild) start.value = next
  write(next)
}
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))

const src = computed(() => {
  const s = start.value
  const seed = {
    'comfy.design.uiTuning.v5': { radius: s.corners }
  }
  return `?${new URLSearchParams({
    frame: 'play',
    theme: s.theme,
    seed: JSON.stringify(seed),
    c: spec,
    p: JSON.stringify(s.p),
    bg: s.bg,
    corners: s.corners
  })}`
})
</script>

<template>
  <iframe
    ref="frame"
    :key="src"
    :src
    :title="`${page}, playground`"
    class="ds-play-frame-el"
    :style="{ height: `${height}px` }"
  />
</template>

<style>
.ds-play-frame-el {
  display: block;
  width: 100%;
  border: 0;
  border-radius: 16px;
  background: transparent;
}
</style>
