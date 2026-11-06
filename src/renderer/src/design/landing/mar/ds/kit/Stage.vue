<script setup lang="ts">
import { STAGES, type StageId } from '../stages'
import { frameUrl } from './frameUrl'

/**
 * A component opened (a menu, a tooltip), in its own frame: an open menu
 * closes the others in its document, so each one gets a document of its
 * own. Same theme as the page it is on; `seed` starts it on knob values.
 */
const { id, label, seed } = defineProps<{
  id: StageId
  label?: string
  seed?: Record<string, unknown>
}>()
const src = frameUrl('stage', { stage: id }, seed)
</script>

<template>
  <figure class="ds-cell">
    <iframe
      :src
      :title="label ?? id"
      class="ds-stage"
      :style="{ height: `${STAGES[id].height}px` }"
      loading="lazy"
    />
    <figcaption v-if="label" class="ds-cell-label">{{ label }}</figcaption>
  </figure>
</template>
