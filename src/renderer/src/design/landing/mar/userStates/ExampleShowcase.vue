<script setup lang="ts">
import { computed } from 'vue'
import { exampleLook } from './exampleLook'
import ExampleArc from './ExampleArc.vue'
import ExampleBento from './ExampleBento.vue'
import ExampleCoverflow from './ExampleCoverflow.vue'
import ExampleDeck from './ExampleDeck.vue'
import ExampleFan from './ExampleFan.vue'
import ExampleFanFlow from './ExampleFanFlow.vue'
import ExampleRow from './ExampleRow.vue'

/** The examples on a first-time Home, in the look picked in UI Playground ›
 *  First-time examples (Pablo's fan unless changed). */
const VIEWS = {
  fan: ExampleFan,
  fanflow: ExampleFanFlow,
  row: ExampleRow,
  coverflow: ExampleCoverflow,
  arc: ExampleArc,
  bento: ExampleBento,
  deck: ExampleDeck
}
const view = computed(() => VIEWS[exampleLook.id])
</script>

<template>
  <component :is="view" />
</template>
