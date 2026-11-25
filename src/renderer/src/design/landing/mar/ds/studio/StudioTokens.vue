<script setup lang="ts">
import Input from '../../../ui/Input.vue'
import NumberField from '../../../ui/NumberField.vue'
import Select from '../../../ui/Select.vue'
import { cssOf } from '../theme/color'
import { describe, MAIN, MODES, TOKENS } from '../theme/model'
import {
  code,
  compare,
  editing,
  mainResolved,
  pctOf,
  resolved,
  setCode,
  setHex,
  setPct,
  state,
  swatch,
  valueOptions
} from '../theme/usePlayground'

/** One row per semantic token, a line per mode: a primitive, or another
 *  token at an opacity. The mode on screen comes first. */
const GROUPS = ['Core', 'States', 'Comfy'] as const
const modes = (): typeof MODES => (editing.value === 'light' ? ['light', 'dark'] : MODES)
const hexOf = (m: 'dark' | 'light', id: string): string => {
  const v = state.value.map[m][id]
  return v && 'hex' in v ? v.hex : ''
}
</script>

<template>
  <div class="st-sec">
    <p class="st-note">
      Pick a primitive, or another token at an opacity. Hover and selected are accent at 40% and 60%
      (#22752). Credit, bypass and success are one value for both modes.
    </p>
    <section v-for="g in GROUPS" :key="g">
      <h3 class="st-group">{{ g }}</h3>
      <div v-for="t in TOKENS.filter((x) => x.group === g)" :key="t.id" class="stt-row">
        <div class="stt-name">
          <code>{{ t.rule ?? t.id }}</code>
          <small>{{ t.use }}</small>
        </div>
        <template v-for="m in modes()" :key="m">
          <div v-if="!(t.shared && m === 'light')" :class="['stt-line', m === editing && 'is-on']">
            <span class="stt-m">{{ m === 'dark' ? 'Dark' : 'Light' }}</span>
            <i class="pg-sw" :style="{ background: swatch(m, t.id) }" />
            <Select
              :model-value="code(state.map[m][t.id])"
              :options="valueOptions"
              size="sm"
              class="pg-pick"
              @update:model-value="setCode(m, t.id, $event)"
            />
            <Input
              v-if="hexOf(m, t.id)"
              :model-value="hexOf(m, t.id)"
              size="sm"
              mono
              class="pg-hex"
              @update:model-value="setHex(m, t.id, $event)"
            />
            <NumberField
              v-else
              :model-value="pctOf(m, t.id)"
              :min="0"
              :max="100"
              :step="5"
              unit="%"
              :aria-label="`${t.id} opacity, ${m}`"
              class="pg-pct"
              @update:model-value="setPct(m, t.id, $event)"
            />
          </div>
          <p v-if="!(t.shared && m === 'light')" class="stt-out">
            <code>{{ cssOf(resolved[m][t.id]!) }}</code>
            <span v-if="compare" class="pg-main"
              ><i class="pg-sw is-sm" :style="{ background: swatch(m, t.id, mainResolved) }" />main
              {{ describe(MAIN.map[m][t.id]) }}</span
            >
          </p>
        </template>
      </div>
    </section>
  </div>
</template>
