<script setup lang="ts">
import ShotsPage, { type Shot } from './ShotsPage.vue'

const FIRST = { 'comfy.design.mar.user': { user: 'first', local: 'none' } }
const START: Shot[] = [
  { label: 'Get started · a new builder', mode: 'build', page: 'build-overview', seed: FIRST },
  { label: 'Build overview · returning', mode: 'build', page: 'build-overview' }
]
const MODELS: Shot[] = [{ label: 'Models', mode: 'build', page: 'router' }]
const DEPLOY: Shot[] = [{ label: 'Deploy as API · configure', page: 'overview', run: 'deploy' }]
</script>

<template>
  <ShotsPage
    title="Build › Get started"
    note="From nothing to a first call: pick a model, try it, copy the code."
    :shots="START"
  />
  <ShotsPage
    title="Models"
    note="Build › Models, mocked end to end; Partner API links to Provider keys."
    :shots="MODELS"
  />
  <ShotsPage
    title="Deploy as API"
    note="On Comfy's real model: build, release, deployment. GPU, region and idle stop, with the cost."
    :shots="DEPLOY"
  />
</template>
