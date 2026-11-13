<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * One live surface (the whole prototype, `?frame=app`), filling its box.
 * Narrower than the app's own minimum, it renders at that width and
 * scales down, so a split view still shows the real layout.
 */
const { src, title } = defineProps<{ src: string; title: string }>()
const MIN = 1180
const box = ref<HTMLElement>()
const size = ref({ w: MIN, h: 800, scale: 1 })
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(([e]) => {
    const { width, height } = e!.contentRect
    const w = Math.max(width, MIN)
    const scale = width / w
    size.value = { w, h: height / scale, scale }
  })
  ro.observe(box.value!)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <div ref="box" class="st-surface">
    <iframe
      :key="src"
      :src
      :title
      :style="{
        width: `${size.w}px`,
        height: `${size.h}px`,
        transform: size.scale < 1 ? `scale(${size.scale})` : undefined
      }"
    />
  </div>
</template>

<style>
.st-surface {
  position: relative;
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
.st-surface iframe {
  position: absolute;
  top: 0;
  left: 0;
  border: 0;
  transform-origin: 0 0;
}
</style>
