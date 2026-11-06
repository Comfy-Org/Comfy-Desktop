<script setup lang="ts">
import { LayoutGrid, List } from 'lucide-vue-next'

/** Grid or list (Mar's pages), two icons in one segmented pill. */
const model = defineModel<'grid' | 'list'>({ required: true })
const VIEWS = [
  { value: 'grid', label: 'Grid', icon: LayoutGrid },
  { value: 'list', label: 'List', icon: List }
] as const
</script>

<template>
  <div class="mar-pseg" role="radiogroup" aria-label="View">
    <button
      v-for="v in VIEWS"
      :key="v.value"
      type="button"
      role="radio"
      :aria-checked="model === v.value"
      :aria-selected="model === v.value"
      :aria-label="v.label"
      :title="v.label"
      class="mar-pseg-btn is-icon"
      @click="model = v.value"
    >
      <component :is="v.icon" :size="14" />
    </button>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mar-pseg-btn.is-icon {
  display: inline-flex;
  width: 30px;
  align-items: center;
  justify-content: center;
  padding: 0;
}
</style>
