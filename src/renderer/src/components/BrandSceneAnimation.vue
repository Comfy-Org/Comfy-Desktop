<script setup lang="ts">
import { ref } from 'vue'
import { useBrandScene } from '../composables/useBrandScene'
import type { BrandScene } from '../lib/brandScene/types'
import sceneData from '../lib/brandScene/installShowcaseScene.json'

const props = withDefaults(
  defineProps<{
    fit?: 'contain' | 'cover'
    speed?: number
  }>(),
  { fit: 'contain', speed: 0.55 }
)

const data = sceneData as BrandScene

const stageRef = ref<HTMLElement | null>(null)
useBrandScene(stageRef, data, { fit: props.fit, speed: props.speed })
</script>

<template>
  <div
    class="brand-scene-wrap pointer-events-none absolute inset-0 overflow-hidden"
    aria-hidden="true"
  >
    <div
      ref="stageRef"
      class="brand-scene-stage absolute top-0 left-0 h-[784px] w-[1056px] origin-top-left"
    >
      <div
        v-for="(scene, si) in data.scenes"
        :key="scene.id"
        class="brand-scene absolute top-0 left-0 size-0 overflow-hidden bg-[var(--neutral-900,#19131d)] will-change-[transform,width,height]"
        :style="{ zIndex: data.scenes.length - si, borderRadius: `${scene.maskRadius}px` }"
      >
        <video
          v-for="(v, vi) in scene.videos"
          :key="vi"
          :src="v.src"
          class="absolute top-0 left-0 hidden max-h-none max-w-none object-fill will-change-[transform,width,height] [&.is-active]:block [&.is-active]:opacity-0 [&.is-active]:transition-opacity [&.is-active]:duration-280 [&.is-active]:ease-[ease] [&.is-active.is-painted]:opacity-100 motion-reduce:[&.is-active]:transition-none"
          muted
          playsinline
          preload="auto"
          loop
        />
      </div>
    </div>
  </div>
</template>
