<script setup lang="ts">
import SectionHeader from '../../../ui/SectionHeader.vue'
import SpaceCard from '../../../parts/space/SpaceCard.vue'
import DeployedTo from '../../../parts/space/DeployedTo.vue'
import WorkflowCard from '../../WorkflowCard.vue'
import { SPACES } from '../../../spaces'
import portraitSun from '../../assets/portrait-sun.jpg'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import Stage from '../kit/Stage.vue'

const live = SPACES.filter((s) => s.status !== 'draft')
const STATES = [
  { label: 'idle', force: '' },
  { label: 'hover', force: 'hover' },
  { label: 'focus', force: 'focus' }
]
</script>

<template>
  <Section title="Section header" note="The title, a count, and the link at the end.">
    <Cells :min="300">
      <Cell
        v-for="s in STATES"
        :key="s.label"
        :label="`link ${s.label}`"
        fill
        :force="s.force"
        target="button"
      >
        <SectionHeader title="Recently used" link="See all">
          <template #controls>
            <span
              class="inline-flex h-5 items-center rounded-full bg-secondary-background px-2 text-ui text-muted-foreground"
              >8</span
            >
          </template>
        </SectionHeader>
      </Cell>
    </Cells>
  </Section>

  <Section
    title="Recently used"
    note="The picture, the name, where it ran and when. Hover only lightens the surface: the card and its picture never grow."
  >
    <Cells :min="220">
      <Cell
        v-for="s in STATES"
        :key="s.label"
        :label="s.label"
        fill
        :force="s.force"
        target="[role='button'], button, article"
      >
        <WorkflowCard
          :src="portraitSun"
          title="hero-shot-v4"
          meta="My Local 1"
          right="12 min ago"
        />
      </Cell>
    </Cells>
  </Section>

  <Section title="Spaces" note="Who is in, how busy, the budget.">
    <Cells :min="300">
      <Cell
        v-for="s in STATES"
        :key="s.label"
        :label="s.label"
        fill
        :force="s.force"
        target="[role='button'], button, article"
      >
        <SpaceCard :space="live[0]!" />
      </Cell>
      <Cell v-for="sp in live.slice(1, 3)" :key="sp.id" :label="sp.name" fill
        ><SpaceCard :space="sp"
      /></Cell>
    </Cells>
  </Section>

  <Section title="Draft chip" note="On a workflow that is in no space yet. Its tooltip says so.">
    <Cells :min="160">
      <Cell
        v-for="s in STATES"
        :key="s.label"
        :label="s.label"
        :force="s.force"
        target=".mar-draft-chip"
      >
        <DeployedTo kind="workflow" name="mar-ds-sample" />
      </Cell>
      <Stage id="tip-draft" label="with its tooltip" />
    </Cells>
  </Section>
</template>
