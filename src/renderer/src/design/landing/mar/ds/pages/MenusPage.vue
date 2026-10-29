<script setup lang="ts">
import { CREDITS_STATES } from '../../credits'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import Stage from '../kit/Stage.vue'
</script>

<template>
  <Section
    title="Create"
    note="Top right of Home. Layered: more blur, the current pick raised. Idle, then with a row highlighted."
  >
    <Cells :min="300">
      <Stage id="create-menu" label="open" />
      <Stage id="create-menu-hover" label="row highlighted" />
    </Cells>
  </Section>
  <Section
    title="Workspace"
    note="From the sidebar's foot, upwards. The summary (workspace, credits, Top up) is a raised panel at the top."
  >
    <Cells :min="300">
      <Stage id="workspace-menu" label="open" />
      <Stage id="workspace-menu-hover" label="row highlighted" />
    </Cells>
  </Section>
  <Section
    title="Run on and build switch"
    note="The prompt's build picker (the current build raised) and the title bar's switcher."
  >
    <Cells :min="520">
      <Stage id="run-on-menu" label="Run on" />
      <Stage id="build-switch" label="build switch" />
    </Cells>
  </Section>
  <Section
    title="Credits flyout"
    note="Opens from Credits in the sidebar. Every one of Alex's states (UI Playground › Credits state)."
  >
    <Cells :min="560">
      <Stage
        v-for="s in CREDITS_STATES"
        id="credits-flyout"
        :key="s.value"
        :label="s.label"
        :seed="{ 'comfy.design.mar.creditsState': s.value }"
      />
    </Cells>
  </Section>
</template>
