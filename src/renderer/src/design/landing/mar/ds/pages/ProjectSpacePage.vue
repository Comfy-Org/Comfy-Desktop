<script setup lang="ts">
import ShotsPage, { type Shot } from './ShotsPage.vue'

const HEADER: [number, number, number, number] = [250, 40, 1030, 180]
const PAGES: Shot[] = [
  { label: 'Project', page: 'project:first' },
  { label: 'Space', page: 'space:northwind' }
]
const SETUP: Shot[] = [{ label: 'Space · nothing run, nobody in it', page: 'space:kite' }]
const HEADERS: Shot[] = PAGES.map((s) => ({ ...s, label: `${s.label} · header`, crop: HEADER }))
</script>

<template>
  <ShotsPage
    title="Project and space pages"
    note="One header for both: cover, title and state, then one quiet meta line (address with copy and open, members, last activity); one action group on the right. A project reads as a product page: latest output and recent activity, then one tab row with the filters docked right."
    :shots="PAGES"
  />
  <ShotsPage title="The shared header" :shots="HEADERS" />
  <ShotsPage
    title="An empty Space"
    note="With no runs and no members, a Space's Overview is the steps that get it ready instead of a dashboard of zeros."
    :shots="SETUP"
  />
</template>
