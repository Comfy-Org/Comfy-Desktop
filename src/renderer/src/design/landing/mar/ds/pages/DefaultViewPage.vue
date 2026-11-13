<script setup lang="ts">
import LandingPrototypes from '../../../LandingPrototypes.vue'
import Section from '../kit/Section.vue'
import Window from '../kit/Window.vue'
</script>

<template>
  <Section
    title="Home"
    note="The whole prototype at 1280 × 800, as it opens: every UI Playground knob at its default. Live."
  >
    <Window><LandingPrototypes standalone /></Window>
  </Section>
</template>
