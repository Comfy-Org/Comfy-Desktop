<script setup lang="ts">
import { ref } from 'vue'
import PromptBox from '../../../parts/PromptBox.vue'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import Stage from '../kit/Stage.vue'

const typed = ref("Put this product in a model's hand, soft daylight, shallow depth of field")
</script>

<template>
  <Section
    title="Prompt box"
    note="One line with the build picker, the mic and send. A very faint edge: a 9% outline, 14% while typing."
  >
    <Cells :min="520">
      <Cell label="idle" fill :height="120">
        <div class="mar-prompt-slot"><PromptBox target class="mar-prompt" /></div>
      </Cell>
      <Cell label="focused" fill :height="120" force="focus" target=".mar-prompt, textarea">
        <div class="mar-prompt-slot"><PromptBox target class="mar-prompt" /></div>
      </Cell>
      <Cell label="typed" fill :height="120">
        <div class="mar-prompt-slot"><PromptBox v-model="typed" target class="mar-prompt" /></div>
      </Cell>
      <Cell
        label="build picker hover"
        fill
        :height="120"
        force="hover"
        target="[aria-haspopup='menu']"
      >
        <div class="mar-prompt-slot"><PromptBox target class="mar-prompt" /></div>
      </Cell>
    </Cells>
  </Section>
  <Section title="Run on" note="The build picker, open.">
    <Cells :min="520"><Stage id="run-on-menu" label="open" /></Cells>
  </Section>
</template>
