<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { TooltipProvider } from 'reka-ui'
import { STAGES, type StageDef, type StageId } from '../stages'

/** One stage: its component, opened once it has rendered. */
const id = new URLSearchParams(location.search).get('stage') as StageId
const stage: StageDef | undefined = STAGES[id]
const root = ref<HTMLElement>()

onMounted(() => {
  // Let async parts and fonts settle before opening.
  setTimeout(() => root.value && stage?.open?.(root.value), 400)
})
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <div
      ref="root"
      :class="[
        'proto-ui ds-stage-root',
        stage?.on === 'sidebar' ? 'proto-sidebar' : stage?.on === 'bare' ? '' : 'proto-main',
        `is-${stage?.place ?? 'center'}`
      ]"
    >
      <component :is="stage.component" v-if="stage" />
    </div>
  </TooltipProvider>
</template>
