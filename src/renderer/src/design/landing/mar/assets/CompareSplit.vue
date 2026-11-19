<script setup lang="ts">
import { ref } from 'vue'
import { ChevronsLeftRight } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'

/**
 * Compare: the before over the result, split where you drag, with Before
 * and After in the corners. Laid over a picture that fills its frame; the
 * app editor's stage and the asset modal share it.
 */
const { before } = defineProps<{ before: string }>()
const split = ref(50)
</script>

<template>
  <div class="cmp">
    <img
      :src="before"
      alt=""
      class="cmp-before"
      :style="{ clipPath: `inset(0 ${100 - split}% 0 0)` }"
    />
    <span class="cmp-handle" :style="{ left: `${split}%` }">
      <span><ChevronsLeftRight :size="14" /></span>
    </span>
    <input
      v-model.number="split"
      type="range"
      min="0"
      max="100"
      aria-label="Before and after"
      class="cmp-split"
    />
    <Badge variant="overlay" size="md" class="absolute bottom-3 left-3">Before</Badge>
    <Badge variant="overlay" size="md" class="absolute right-3 bottom-3">After</Badge>
  </div>
</template>

<style>
.cmp {
  position: absolute;
  inset: 0;
}
.cmp-before {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cmp-handle {
  pointer-events: none;
  position: absolute;
  inset-block: 0;
  width: 2px;
  translate: -50% 0;
  background: white;
}
.cmp-handle > span {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  width: 28px;
  height: 28px;
  translate: -50% -50%;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: white;
  color: black;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
}
:root .proto-ui.proto-ui.proto-ui .cmp-split {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: ew-resize;
  opacity: 0;
}
</style>
