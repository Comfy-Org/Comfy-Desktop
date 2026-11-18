<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import {
  useDocumentVisibility,
  useElementVisibility,
  usePreferredReducedMotion
} from '@vueuse/core'
import { useCoverRotation } from '../composables/useCoverRotation'
import type { AppCover } from '../types/ipc'

type Role = 'shown' | 'leaving' | 'upcoming'

interface Layer {
  index: number
  src: string
  role: Role
}

const LAYER_CLASS: Record<Role, string> = {
  shown: 'z-2',
  leaving: 'z-1 opacity-100',
  upcoming: 'z-0 opacity-0'
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

const { shown, leaving, upcoming, loaded, allFailed, markLoaded, markFailed } = useCoverRotation({
  count: () => pictures.length,
  key: () => pictures.map((picture) => picture.url).join('\n'),
  playing: () => !paused && !still.value && onScreen.value && page.value !== 'hidden'
})

const layers = computed<Layer[]>(() => {
  const picked: Array<[number | null, Role]> = still.value
    ? [[shown.value, 'shown']]
    : [
        [leaving.value, 'leaving'],
        [shown.value, 'shown'],
        [upcoming.value, 'upcoming']
      ]
  return picked
    .filter(
      (entry): entry is [number, Role] => entry[0] !== null && pictures[entry[0]] !== undefined
    )
    .map(([index, role]) => {
      const picture = pictures[index]!
      const src = still.value ? (picture.stillUrl ?? picture.url) : picture.url
      return { index, src, role }
    })
    .sort((a, b) => a.index - b.index)
})

function opacityOf(layer: Layer): string {
  if (layer.role !== 'shown') return ''
  return loaded.value.has(layer.index) ? 'opacity-100' : 'opacity-0'
}

function onError(index: number): void {
  markFailed(index)
  if (allFailed.value) emit('broken')
}
</script>

<template>
  <span ref="root" class="absolute inset-0 isolate block" data-testid="cover-rotation">
    <img
      v-for="layer in layers"
      :key="`${still ? 'still' : 'cover'}:${layer.src}`"
      :src="layer.src"
      alt=""
      draggable="false"
      loading="lazy"
      class="absolute inset-0 block size-full object-cover transition-opacity duration-700 ease-out motion-reduce:transition-none"
      :class="[LAYER_CLASS[layer.role], opacityOf(layer)]"
      :aria-hidden="layer.role === 'shown' ? undefined : 'true'"
      :data-cover="layer.role"
      :data-loaded="loaded.has(layer.index)"
      @load="markLoaded(layer.index)"
      @error="onError(layer.index)"
    />
  </span>
</template>
