<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'

/**
 * A setup screen at the real window size (1440×900) for the canvas
 * (SetupCanvas.vue). `layout` places the content: `today` where the flow
 * puts it now (566px, above centre), `center` a 640px column in the
 * middle, `wide` a 1040px one. `step` adds the proposed fixed frame: the
 * step indicator on top and the action bar (`#bar`) along the bottom.
 */
const {
  step,
  layout = 'center',
  steps: STEPS = ['Run on', 'Set up', 'Workflow', 'Install']
} = defineProps<{
  step?: number
  layout?: 'today' | 'center' | 'wide'
  /** The indicator's steps, where a take changes how many there are. */
  steps?: string[]
}>()
const state = (i: number): string =>
  !step ? '' : i + 1 < step ? 'is-done' : i + 1 === step ? 'is-now' : ''
</script>

<template>
  <div class="proto-ui fo cv" :class="[`is-${layout}`, step && 'has-frame']">
    <div class="fo-amb" aria-hidden="true"></div>
    <ComfyCLogo class="fo-mark" />
    <ol v-if="step" class="cv-steps" aria-label="Setup steps">
      <template v-for="(s, i) in STEPS" :key="s">
        <li v-if="i" class="cv-step-sep" aria-hidden="true"></li>
        <li class="cv-step" :class="state(i)">
          <i
            ><Check v-if="state(i) === 'is-done'" :size="11" :stroke-width="3" /><template v-else>{{
              i + 1
            }}</template></i
          >{{ s }}
        </li>
      </template>
    </ol>
    <div class="cv-body">
      <div class="cv-col"><slot /></div>
    </div>
    <div v-if="$slots.bar" class="cv-bar">
      <div class="cv-bar-in"><slot name="bar" /></div>
    </div>
  </div>
</template>
