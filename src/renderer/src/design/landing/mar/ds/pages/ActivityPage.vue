<script setup lang="ts">
import MarActivityTimeline from '../../activity/MarActivityTimeline.vue'
import { SPACES } from '../../../spaces'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'

const busy = SPACES.reduce((a, b) => (b.activity.length > a.activity.length ? b : a))
</script>

<template>
  <Section
    title="Recent activity"
    note="Milestones on a vertical line: when, who, what. Newest first."
  >
    <Cells :min="420">
      <Cell :label="`${busy.name} · five latest`" fill>
        <MarActivityTimeline :items="busy.activity.slice(0, 5)" />
      </Cell>
      <Cell label="one event" fill>
        <MarActivityTimeline
          :items="[{ who: 'Pablo', what: 'created the space', when: 'Today' }]"
        />
      </Cell>
    </Cells>
  </Section>
</template>
