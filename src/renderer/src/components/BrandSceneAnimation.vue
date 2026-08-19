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
  <div class="brand-scene-wrap" aria-hidden="true">
    <div ref="stageRef" class="brand-scene-stage">
      <div
        v-for="(scene, si) in data.scenes"
        :key="scene.id"
        class="brand-scene"
        :style="{ zIndex: data.scenes.length - si, borderRadius: `${scene.maskRadius}px` }"
      >
        <video
          v-for="(v, vi) in scene.videos"
          :key="vi"
          :src="v.src"
          muted
          playsinline
          preload="auto"
          loop
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.brand-scene-wrap {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.brand-scene-stage {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  width: 1056px;
  height: 784px;
}
.brand-scene {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  overflow: hidden;
  background: #000;
  will-change: transform, width, height;
}
.brand-scene video {
  position: absolute;
  left: 0;
  top: 0;
  display: none;
  object-fit: fill;
  will-change: transform, width, height;
  max-width: none;
  max-height: none;
}
.brand-scene video.is-active {
  display: block;
}
</style>
