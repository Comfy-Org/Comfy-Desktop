<script setup lang="ts">
import { Check } from 'lucide-vue-next'

/**
 * The takeover's step indicator, top centre on every screen of the first
 * launch: Run on, Set up, Install. `now` is the current one, from 1.
 */
const { now } = defineProps<{ now: number }>()
const STEPS = ['Run on', 'Set up', 'Install']
</script>

<template>
  <ol class="mss-steps" aria-label="Setup steps">
    <template v-for="(s, i) in STEPS" :key="s">
      <li v-if="i" class="mss-steps-sep" aria-hidden="true"></li>
      <li
        class="mss-steps-item"
        :class="i + 1 < now ? 'is-done' : i + 1 === now && 'is-now'"
        :aria-current="i + 1 === now ? 'step' : undefined"
      >
        <i
          ><Check v-if="i + 1 < now" :size="10" :stroke-width="3" /><template v-else>{{
            i + 1
          }}</template></i
        >{{ s }}
      </li>
    </template>
  </ol>
</template>
