<script setup lang="ts">
import { LOOKS } from '../../looks/looks'
import ShotsPage from './ShotsPage.vue'

const SHOTS = LOOKS.map((l) => ({ label: l.label, seed: { 'comfy.design.mar.look': l.value } }))
</script>

<template>
  <ShotsPage
    title="Looks"
    note="UI Playground › Look: Current (Void as it is, the default) or Grain. Type and colour stay Void’s; Grain changes only the pictures."
    :shots="SHOTS"
  />
</template>
