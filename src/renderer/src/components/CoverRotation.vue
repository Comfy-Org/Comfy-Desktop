<script setup lang="ts">
import { computed, onScopeDispose, ref, useTemplateRef, watch } from 'vue'
import {
  useDocumentVisibility,
  useElementVisibility,
  usePreferredReducedMotion
} from '@vueuse/core'
import { COVER_FADE_MS, useCoverRotation } from '../composables/useCoverRotation'
import type { AppCover } from '../types/ipc'

type Role = 'shown' | 'leaving' | 'upcoming' | 'poster'

interface Layer {
  index: number
  src: string
  role: Role
  kind: 'still' | 'cover'
}

const LAYER_CLASS: Record<Role, string> = {
  shown: 'z-2',
  leaving: 'z-1 opacity-100',
  upcoming: 'z-0 opacity-0',
  poster: 'z-0'
}

const { pictures, paused = false } = defineProps<{
  pictures: readonly AppCover[]
  paused?: boolean
}>()

const emit = defineEmits<{ broken: [] }>()

const root = useTemplateRef<HTMLElement>('root')
const onScreen = useElementVisibility(root)
const page = useDocumentVisibility()
const motion = usePreferredReducedMotion()
const still = computed(() => motion.value === 'reduce')

const listKey = () => pictures.map((picture) => picture.url).join('\n')
const playing = computed(() => !paused && !still.value && onScreen.value && page.value !== 'hidden')
const generation = ref(0)

const { shown, leaving, upcoming, loaded, allFailed, markLoaded, markFailed } = useCoverRotation({
  count: () => pictures.length,
  key: listKey,
  playing: () => playing.value
})

const loadedStills = ref<ReadonlySet<number>>(new Set())
const failedStills = ref<ReadonlySet<number>>(new Set())
// A moving cover is megabytes and a still is kilobytes: the first cover's still stands in until
// the moving one has loaded and faded in over it, then goes. Later covers load hidden first.
const posterDone = ref(false)
let posterTimer: ReturnType<typeof setTimeout> | undefined

watch(listKey, () => {
  generation.value++
  loadedStills.value = new Set()
  failedStills.value = new Set()
  clearTimeout(posterTimer)
  posterDone.value = false
})

const shownLoaded = computed(() => shown.value !== null && loaded.value.has(shown.value))

watch(shownLoaded, (now) => {
  if (!now || posterDone.value) return
  clearTimeout(posterTimer)
  posterTimer = setTimeout(() => {
    posterDone.value = true
  }, COVER_FADE_MS)
})

onScopeDispose(() => clearTimeout(posterTimer))

function hasStill(index: number): boolean {
  return Boolean(pictures[index]?.stillUrl) && !failedStills.value.has(index)
}

function posterIndex(): number | null {
  const index = shown.value
  if (still.value || posterDone.value || index === null || !hasStill(index)) return null
  return pictures[index]!.stillUrl === pictures[index]!.url ? null : index
}

function isLoaded(layer: Layer): boolean {
  return (layer.kind === 'still' ? loadedStills : loaded).value.has(layer.index)
}

function onLoad(layer: Layer): void {
  if (layer.kind === 'still') loadedStills.value = new Set(loadedStills.value).add(layer.index)
  else markLoaded(layer.index)
}

function stillIndex(): number | null {
  const first = shown.value
  if (first !== null && hasStill(first)) return first
  const other = pictures.findIndex((_picture, index) => hasStill(index))
  return other >= 0 ? other : null
}

const layers = computed<Layer[]>(() => {
  const picked: Array<[number | null, Role]> = still.value
    ? [[stillIndex(), 'shown']]
    : [
        [leaving.value, 'leaving'],
        [shown.value, 'shown'],
        [shownLoaded.value ? upcoming.value : null, 'upcoming']
      ]
  const seen = new Set<number>()
  const covers = picked
    .filter((entry): entry is [number, Role] => {
      const [index] = entry
      if (index === null || pictures[index] === undefined || seen.has(index)) return false
      seen.add(index)
      return true
    })
    .map(([index, role]): Layer => {
      const picture = pictures[index]!
      return still.value
        ? { index, src: picture.stillUrl!, role, kind: 'still' }
        : { index, src: picture.url, role, kind: 'cover' }
    })
  const poster = posterIndex()
  if (poster !== null) {
    covers.push({ index: poster, src: pictures[poster]!.stillUrl!, role: 'poster', kind: 'still' })
  }
  return covers.sort((a, b) => a.index - b.index)
})

function opacityOf(layer: Layer): string {
  if (layer.role !== 'shown' && layer.role !== 'poster') return ''
  return isLoaded(layer) ? 'opacity-100' : 'opacity-0'
}

function onError(layer: Layer): void {
  if (layer.kind === 'cover') {
    markFailed(layer.index)
    if (allFailed.value) emit('broken')
    return
  }
  failedStills.value = new Set(failedStills.value).add(layer.index)
  if (still.value && stillIndex() === null) emit('broken')
}
</script>

<template>
  <span
    ref="root"
    class="absolute inset-0 isolate block"
    data-testid="cover-rotation"
    :data-playing="playing"
  >
    <img
      v-for="layer in layers"
      :key="`${generation}:${layer.kind}:${layer.src}`"
      :src="layer.src"
      alt=""
      draggable="false"
      loading="lazy"
      class="absolute inset-0 block size-full object-cover transition-opacity duration-700 ease-out motion-reduce:transition-none"
      :class="[LAYER_CLASS[layer.role], opacityOf(layer)]"
      :aria-hidden="layer.role === 'shown' ? undefined : 'true'"
      :data-cover="layer.role"
      :data-loaded="isLoaded(layer)"
      @load="onLoad(layer)"
      @error="onError(layer)"
    />
  </span>
</template>
