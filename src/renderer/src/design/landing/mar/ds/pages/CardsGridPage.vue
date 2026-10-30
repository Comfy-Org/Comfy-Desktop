<script setup lang="ts">
import ShotsPage, { type Shot } from './ShotsPage.vue'

const GRID: [number, number, number, number] = [250, 110, 1030, 560]
const SHOTS: Shot[] = [
  { label: 'Workflows', page: 'workflows', crop: GRID },
  { label: 'Assets', page: 'assets', crop: GRID },
  { label: 'Apps', page: 'apps', crop: GRID }
]
</script>

<template>
  <ShotsPage
    title="Grids"
    note="Equal cards on one rhythm; the toolbar above; hover never moves the grid."
    :shots="SHOTS"
  />
</template>
