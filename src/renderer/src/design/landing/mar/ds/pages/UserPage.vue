<script setup lang="ts">
import ShotsPage from './ShotsPage.vue'

const KEY = 'comfy.design.mar.user'
const SHOTS = [
  { label: 'First-time · no local install', seed: { [KEY]: { user: 'first', local: 'none' } } },
  { label: 'First-time · just set up one', seed: { [KEY]: { user: 'first', local: 'one' } } },
  {
    label: 'Returning · several builds (default)',
    seed: { [KEY]: { user: 'returning', local: 'several' } }
  }
]
</script>

<template>
  <ShotsPage
    title="User"
    note="UI Playground › User and Local install: a first-time user has made, run and starred nothing yet; Home and every library follow. First-time examples use the Arc look with a full-width Run."
    :shots="SHOTS"
  />
</template>
