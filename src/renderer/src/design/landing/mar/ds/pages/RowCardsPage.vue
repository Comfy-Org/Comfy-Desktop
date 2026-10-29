<script setup lang="ts">
import MarStartWhere from '../../MarStartWhere.vue'
import MarBuildsRow from '../../MarBuildsRow.vue'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'

const STATES = [
  { label: 'idle', force: '' },
  { label: 'first card hover', force: 'hover' },
  { label: 'first card focus', force: 'focus' }
]
</script>

<template>
  <Section
    title="Where should Comfy run?"
    note="One row card per place: icon, name, one line, and the action at the end. Cloud is recommended."
  >
    <Cells :min="520">
      <Cell
        v-for="s in STATES"
        :key="s.label"
        :label="s.label"
        fill
        :force="s.force"
        target=".mar-row-card:first-child"
      >
        <MarStartWhere />
      </Cell>
    </Cells>
  </Section>
  <Section title="Builds" note="Home's builds: the same row card, with the build's state.">
    <Cells :min="520">
      <Cell
        v-for="s in STATES"
        :key="s.label"
        :label="s.label.replace('first card', 'every card')"
        fill
        :force="s.force"
        target=".mar-row-card"
      >
        <MarBuildsRow />
      </Cell>
    </Cells>
  </Section>
</template>
