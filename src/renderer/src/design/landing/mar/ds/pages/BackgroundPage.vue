<script setup lang="ts">
import MarBackdrop from '../../shell/MarBackdrop.vue'
import Section from '../kit/Section.vue'
import Window from '../kit/Window.vue'
</script>

<template>
  <Section
    title="Home spotlight"
    note="One soft light from the top, kept to the middle of the page and fading as it goes down; a faint lavender in light mode. Painted on the page, so it has no edges; the content panel has no hairline."
  >
    <Window :height="640">
      <div class="proto-main relative m-0! size-full overflow-hidden">
        <MarBackdrop />
        <div class="h-[900px]" />
      </div>
    </Window>
  </Section>
</template>
