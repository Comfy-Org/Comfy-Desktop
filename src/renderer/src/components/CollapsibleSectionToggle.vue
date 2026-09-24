<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'

defineProps<{
  expanded: boolean
  label: string
  id?: string
}>()

const emit = defineEmits<{
  toggle: []
}>()
</script>

<template>
  <button
    :id="id"
    class="collapsible-section-toggle"
    type="button"
    :aria-expanded="expanded"
    @click="emit('toggle')"
  >
    <ChevronRight
      :size="16"
      class="collapsible-section-toggle__chevron"
      :class="{ 'collapsible-section-toggle__chevron--open': expanded }"
      aria-hidden="true"
    />
    {{ label }}
  </button>
</template>

<style scoped>
.collapsible-section-toggle {
  display: flex;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--neutral-200);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.4;
}

.collapsible-section-toggle:hover {
  background: transparent;
}

.collapsible-section-toggle__chevron {
  transition: transform 120ms ease;
}

.collapsible-section-toggle__chevron--open {
  transform: rotate(90deg);
}
</style>
