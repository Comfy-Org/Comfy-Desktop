<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import MarSeg from '../../MarSeg.vue'
import OptionA from './OptionA.vue'
import OptionB from './OptionB.vue'
import OptionC from './OptionC.vue'
import OptionD from './OptionD.vue'
import { VARIANTS, devVariant, pick, type Variant } from './variant'

const options = VARIANTS.map((o) => ({ value: o.value, label: o.label }))
const step = (e: KeyboardEvent): void => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  if (e.target instanceof HTMLInputElement) return
  const i = VARIANTS.findIndex((o) => o.value === (devVariant.value || 'd'))
  const n = (i + (e.key === 'ArrowRight' ? 1 : VARIANTS.length - 1)) % VARIANTS.length
  pick(VARIANTS[n]!.value)
}
onMounted(() => window.addEventListener('keydown', step))
onBeforeUnmount(() => window.removeEventListener('keydown', step))
</script>

<template>
  <OptionA v-if="devVariant === 'a'" />
  <OptionB v-else-if="devVariant === 'b'" />
  <OptionC v-else-if="devVariant === 'c'" />
  <OptionD v-else />
  <div
    class="fixed bottom-5 left-1/2 z-[90] -translate-x-1/2 rounded-panel bg-card-background p-1 shadow-popover"
  >
    <MarSeg
      :model-value="devVariant || 'd'"
      :options
      label="Options"
      @update:model-value="(v: Variant) => pick(v)"
    />
  </div>
</template>
