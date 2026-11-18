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
type Kind = 'still' | 'cover'

interface Layer {
  index: number
  src: string
  role: Role
  kind: Kind
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
const failedPosters = ref<ReadonlySet<number>>(new Set())
const posterDone = ref(false)
let posterTimer: ReturnType<typeof setTimeout> | undefined

watch(listKey, () => {
  generation.value++
  loadedStills.value = new Set()
  failedStills.value = new Set()
  failedPosters.value = new Set()
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
  if (failedPosters.value.has(index)) return null
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

function pick(): Array<[number | null, Role, Kind]> {
  if (still.value || allFailed.value) return [[stillIndex(), 'shown', 'still']]
  if (paused)
    return [
      [stillIndex(), 'shown', 'still'],
      [shown.value, 'upcoming', 'cover']
    ]
  const picked: Array<[number | null, Role, Kind]> = [
    [leaving.value, 'leaving', 'cover'],
    [shown.value, 'shown', 'cover'],
    [shownLoaded.value ? upcoming.value : null, 'upcoming', 'cover']
  ]
  const poster = posterIndex()
  if (poster !== null) picked.push([poster, 'poster', 'still'])
  return picked
}

const layers = computed<Layer[]>(() => {
  const seen = new Set<string>()
  return pick()
    .flatMap(([index, role, kind]): Layer[] => {
      const picture = index === null ? undefined : pictures[index]
      if (index === null || picture === undefined) return []
      const src = kind === 'still' ? picture.stillUrl! : picture.url
      if (seen.has(src)) return []
      seen.add(src)
      return [{ index, src, role, kind }]
    })
    .sort((a, b) => a.index - b.index)
})

function opacityOf(layer: Layer): string {
  if (layer.role !== 'shown' && layer.role !== 'poster') return ''
  return isLoaded(layer) ? 'opacity-100' : 'opacity-0'
}

function onError(layer: Layer): void {
  if (layer.kind === 'cover') {
    markFailed(layer.index)
    if (pictures[layer.index]?.stillUrl === layer.src)
      failedStills.value = new Set(failedStills.value).add(layer.index)
    if (allFailed.value && stillIndex() === null) emit('broken')
    return
  }
  if (layer.role === 'poster') {
    failedPosters.value = new Set(failedPosters.value).add(layer.index)
    return
  }
  failedStills.value = new Set(failedStills.value).add(layer.index)
  if ((still.value || allFailed.value) && stillIndex() === null) emit('broken')
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
      :data-kind="layer.kind"
      :data-loaded="isLoaded(layer)"
      @load="onLoad(layer)"
      @error="onError(layer)"
    />
  </span>
</template>
