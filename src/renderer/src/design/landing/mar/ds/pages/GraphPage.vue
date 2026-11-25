<script setup lang="ts">
import ShotsPage, { type Shot } from './ShotsPage.vue'

const SHOTS: Shot[] = [
  { label: 'Graph editor', page: 'overview', run: 'graph' },
  {
    label: 'Nodes · ComfyUI’s Vue node anatomy',
    page: 'overview',
    run: 'graph',
    crop: [260, 120, 640, 440]
  },
  {
    label: 'The way home · Comfy logo heads the rail',
    page: 'overview',
    run: 'graph',
    crop: [0, 0, 420, 260]
  }
]
</script>

<template>
  <ShotsPage
    title="Graph editor"
    note="A build's tab in the New UI. Nodes follow ComfyUI's Vue node anatomy; the Comfy logo goes back Home; rail tooltips carry their shortcuts."
    :shots="SHOTS"
  />
</template>
