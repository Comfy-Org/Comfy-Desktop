<script setup lang="ts">
import MarItemMenu from '../pages/MarItemMenu.vue'
import { pointMenu } from './buildMenu'

/** The build menu at the pointer: a right-click on a build's sidebar row
 *  (buildMenu.ts › openMenuAt). The same lines as its tile's ⋯. */
</script>

<template>
  <MarItemMenu v-model:open="pointMenu.open" :lines="pointMenu.lines" align="start">
    <template #trigger>
      <span
        class="pointer-events-none fixed size-0"
        :style="{ left: `${pointMenu.x}px`, top: `${pointMenu.y}px` }"
        aria-hidden="true"
      ></span>
    </template>
  </MarItemMenu>
</template>
