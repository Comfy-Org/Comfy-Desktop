<script setup lang="ts">
import ShotsPage, { type Shot } from './ShotsPage.vue'

/** The workflow modal (templateModal/MarTemplateModal.vue), opened the way
 *  Explore opens it, in the asset view's format. */
const SHOTS: Shot[] = [
  { label: 'Result', page: 'overview', run: 'template' },
  { label: 'Graph', page: 'overview', run: 'template-graph' },
  { label: 'What it needs, unfolded', page: 'overview', run: 'template-needs' }
]
</script>

<template>
  <ShotsPage
    title="Template modal"
    note="The asset view's format: the stage runs to the frame's edges (Result or Graph, zoom bottom right, both in the menu glass), the panel beside it a step lighter. At the top right by the name, a couple of quick actions as icons (Favorite, Copy link) instead of a menu. Open in comes first, What it needs straight under it (it changes with the build) and unfolds downward. The foot keeps only the main action."
    :shots="SHOTS"
  />
</template>
