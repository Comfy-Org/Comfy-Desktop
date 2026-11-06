<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

/** A window of `width` × `height`, scaled down to fit the pane. Its
 *  transform makes it the containing block for its fixed parts. */
const { width = 1280, height = 800 } = defineProps<{ width?: number; height?: number }>()
const box = ref<HTMLElement>()
const scale = ref(1)
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(([e]) => (scale.value = Math.min(1, e!.contentRect.width / width)))
  ro.observe(box.value!)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <div ref="box" class="ds-window" :style="{ height: `${height * scale}px` }">
    <div
      class="ds-window-inner"
      :style="{ width: `${width}px`, height: `${height}px`, transform: `scale(${scale})` }"
    >
      <slot />
    </div>
  </div>
</template>
