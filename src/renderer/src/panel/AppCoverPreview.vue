<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { usePreferredReducedMotion } from '@vueuse/core'
import { isMovingCoverReady, loadMovingCover } from './movingCovers'

const { title, still, moving } = defineProps<{
  title: string
  still?: string
  moving?: string
}>()

const motion = usePreferredReducedMotion()
const moves = computed(() => Boolean(moving) && motion.value !== 'reduce')
const movingReady = ref(moving ? isMovingCoverReady(moving) : false)

onMounted(async () => {
  if (!moving || !moves.value || movingReady.value) return
  movingReady.value = await loadMovingCover(moving)
})

const shown = computed(() => (moves.value && movingReady.value ? moving : still))
</script>

<template>
  <span class="flex w-[200px] flex-col gap-1.5 py-1">
    <img
      v-if="shown"
      :src="shown"
      alt=""
      class="aspect-[4/3] w-full rounded-[5px] object-cover"
      :data-moving="shown === moving"
      data-testid="app-sidebar-app-preview"
    />
    <span>{{ title }}</span>
  </span>
</template>
