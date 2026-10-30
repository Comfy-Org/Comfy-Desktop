<script setup lang="ts">
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import Stage from '../kit/Stage.vue'
</script>

<template>
  <Section
    title="Summary first"
    note="Where you are, or what you have, on a raised panel; then the actions."
  >
    <Cells :min="300">
      <Stage id="workspace-menu" label="workspace" />
      <Stage id="credits-flyout" label="credits" />
    </Cells>
  </Section>
</template>
