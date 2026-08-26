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
  background: var(--neutral-900, #19131d);
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
  opacity: 0;
  /* Declared on the start state so the flip to `.is-painted` actually animates
     (a transition set only on the end class applies simultaneously and hard-
     cuts). Fades the video up from the neutral mask ground over the ~300ms
     first-frame decode, so there's no flicker. */
  transition: opacity 280ms ease;
}
.brand-scene video.is-active.is-painted {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .brand-scene video.is-active {
    transition: none;
  }
}
</style>
