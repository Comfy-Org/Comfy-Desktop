<script setup lang="ts">
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import Stage from '../kit/Stage.vue'
</script>

<template>
  <Section title="Tooltip" note="`.mar-tip`: small glass, 8px corners, wraps at 256.">
    <Cells :min="300">
      <Stage id="tip-short" label="short" />
      <Stage id="tip-shortcut" label="with a shortcut" />
      <Stage id="tip-long" label="wraps at 256" />
    </Cells>
  </Section>
</template>
