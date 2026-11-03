<script setup lang="ts">
import MarStatus, { type ItemStatus } from '../../pages/MarStatus.vue'
import portraitSun from '../../assets/portrait-sun.jpg'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'

const RUNS: ItemStatus[] = ['executing', 'queued', 'completed', 'failed']
const OTHERS: ItemStatus[] = [
  'running',
  'launching',
  'live',
  'paused',
  'stopped',
  'draft',
  'shared',
  'update',
  'changes'
]
</script>

<template>
  <Section
    title="Runs"
    note="As in production: Running spins, Completed is a check, Failed an octagon. No percentage."
  >
    <Cells :min="140">
      <Cell v-for="s in RUNS" :key="s" :label="s"><MarStatus :status="s" /></Cell>
    </Cells>
  </Section>
  <Section
    title="On a picture"
    note="Dark glass instead of a tint, in both themes. On cards they sit bottom-left: top-left is the select check's. Shared is not a chip on a card but a people icon on the meta line."
  >
    <Cells :min="140">
      <Cell v-for="s in RUNS" :key="s" :label="s" on="bare">
        <div class="ds-photo" :style="{ backgroundImage: `url(${portraitSun})` }">
          <MarStatus :status="s" on-media />
        </div>
      </Cell>
    </Cells>
  </Section>
  <Section
    title="Builds, apps and items"
    note="Live and running are the only green; updates and changes the only amber."
  >
    <Cells :min="140">
      <Cell v-for="s in OTHERS" :key="s" :label="s"><MarStatus :status="s" /></Cell>
      <Cell label="custom label"><MarStatus status="queued" label="Queued · 2nd" /></Cell>
    </Cells>
  </Section>
</template>
