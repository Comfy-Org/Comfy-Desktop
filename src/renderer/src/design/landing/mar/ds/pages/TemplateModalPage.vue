<script setup lang="ts">
import ShotsPage, { type Shot } from './ShotsPage.vue'

const SHOTS: Shot[] = [{ label: 'open · result view', page: 'overview', run: 'template' }]
</script>

<template>
  <ShotsPage
    title="Template modal"
    note="The hero output, a graph view, what it needs, and a smart Open in picker."
    :shots="SHOTS"
  />
</template>
