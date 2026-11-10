<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'

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
  <Button
    :id="id"
    variant="textonly"
    size="unset"
    class="collapsible-section-toggle flex self-start items-center gap-1.5 rounded-lg border-0 bg-transparent p-0 text-[13px] leading-[1.4] font-normal text-neutral-200 [appearance:button] hover:bg-transparent focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto]"
    type="button"
    :aria-expanded="expanded"
    @click="emit('toggle')"
  >
    <ChevronRight
      :size="16"
      class="collapsible-section-toggle__chevron transition-transform duration-[120ms] ease-[ease]"
      :class="{ 'collapsible-section-toggle__chevron--open rotate-90': expanded }"
      aria-hidden="true"
    />
    {{ label }}
  </Button>
</template>
