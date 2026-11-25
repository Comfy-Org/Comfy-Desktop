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
    note="On the shared page frame, no subtitle: the first call as steps beside their code; Comfy Router, Comfy API and Comfy Cloud on the shared tabs; usage and resources below."
    :shots="START"
  />
  <ShotsPage
    title="Models"
    note="Provider marks on neutral tiles (community files keep the type glyph). In Select mode the check replaces the tile. A steady filter rail that scrolls on its own."
    :shots="MODELS"
  />
  <ShotsPage
    title="Deploy as API"
    note="On Comfy's real model: build, release, deployment. GPU, region and idle stop, with the cost."
    :shots="DEPLOY"
  />
</template>
