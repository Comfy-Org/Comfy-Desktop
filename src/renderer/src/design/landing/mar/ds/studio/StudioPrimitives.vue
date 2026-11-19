<script setup lang="ts">
import { computed } from 'vue'
import { RotateCcw } from 'lucide-vue-next'
import Button from '../../../ui/Button.vue'
import Input from '../../../ui/Input.vue'
import { charcoalHex, STEPS } from '../theme/model'
import { hue, hueList, setHue, state, zinc } from '../theme/usePlayground'

/** Charcoal's lightness curve, its hue and chroma, and the brand and
 *  status hues. */
const hexes = computed(() => charcoalHex(state.value.charcoal))
const textOn = (hex: string): string =>
  parseInt(hex.slice(1, 3), 16) > 140 ? '#09090a' : '#fafafa'
const curve = computed(() =>
  state.value.charcoal.l
    .map((l, i) => `${(i / (STEPS.length - 1)) * 100},${(1 - l) * 100}`)
    .join(' ')
)
</script>

<template>
  <div class="st-sec">
    <p class="st-note">
      Charcoal is one OKLCH lightness curve, 50 to 950, shared by light and dark (#22439 starts from
      Tailwind zinc). Drag a step; hue and chroma apply to every step.
    </p>
    <div class="stp-scale">
      <div v-for="(st, i) in STEPS" :key="st" class="stp-step">
        <div
          class="stp-chip"
          :title="hexes[i]"
          :style="{ background: hexes[i], color: textOn(hexes[i]!) }"
        >
          {{ st }}
        </div>
        <input
          v-model.number="state.charcoal.l[i]"
          class="stp-l"
          type="range"
          min="0"
          max="1"
          step="0.001"
          :aria-label="`charcoal-${st} lightness`"
        />
        <output>{{ state.charcoal.l[i]!.toFixed(2) }}</output>
      </div>
    </div>
    <svg class="stp-curve" viewBox="-2 -2 104 104" preserveAspectRatio="none" aria-hidden="true">
      <polyline :points="curve" />
    </svg>
    <div class="stp-knobs">
      <label class="stp-knob">
        <span>Hue</span>
        <input v-model.number="hue" type="range" min="0" max="360" step="1" />
        <output>{{ state.charcoal.hues ? 'per step' : `${hue}°` }}</output>
      </label>
      <label class="stp-knob">
        <span>Chroma</span>
        <input v-model.number="state.charcoal.chroma" type="range" min="0" max="4" step="0.05" />
        <output>×{{ state.charcoal.chroma.toFixed(2) }}</output>
      </label>
      <Button variant="ghost" size="sm" @click="zinc"><RotateCcw :size="13" />Zinc curve</Button>
    </div>

    <h3 class="st-group">Brand and status</h3>
    <div class="stp-hues">
      <label v-for="h in hueList" :key="h.id" class="stp-hue">
        <input
          type="color"
          :value="state.hues[h.id]"
          :aria-label="h.id"
          @input="setHue(h.id, ($event.target as HTMLInputElement).value)"
        />
        <span class="stp-hue-name"
          ><code>{{ h.id }}</code
          ><small>{{ h.use }}</small></span
        >
        <Input
          :model-value="state.hues[h.id]"
          size="sm"
          mono
          class="pg-hex"
          @update:model-value="setHue(h.id, $event)"
        />
      </label>
    </div>
  </div>
</template>
