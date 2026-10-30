<script setup lang="ts">
import { CREDITS_STATES } from '../../credits'
import AppShot from '../kit/AppShot.vue'
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
    note="The prompt's build picker, grouped by where it runs (this computer, Cloud), each build with its state, GPU and what picking it costs; the current one raised. Then the title bar's switcher."
  >
    <Cells :min="520">
      <Stage id="run-on-menu" label="Run on" />
      <Stage id="build-switch" label="build switch" />
    </Cells>
  </Section>
  <Section
    title="A menu with one option is a button"
    note="With nothing to choose, there is no menu: Create becomes the one thing it would do (here, on Comfy Cloud: Open ComfyUI). The workspace menu offers Create workspace instead of a switcher when there is only one; a picker with one build reads as plain text."
  >
    <Cells :min="420">
      <AppShot
        label="Create · several options (menu)"
        page="overview"
        :crop="[880, 30, 400, 120]"
      />
      <AppShot
        label="Create · one option (button)"
        page="overview"
        :seed="{ 'comfy.design.mar.surface': 'cloud' }"
        :crop="[880, 30, 400, 120]"
      />
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
