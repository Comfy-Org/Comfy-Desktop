<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { computed } from 'vue'
import Button from '../../ui/Button.vue'
import Tooltip from '../../ui/Tooltip.vue'
import { marNav, marPanelsOn } from '../shell/marShell'
import { createScreen, openCreate } from './createScreen'

const rail = computed(() => marPanelsOn.value && marNav.collapsed)
</script>

<template>
  <div class="mcq" :class="rail && 'is-rail'">
    <Tooltip v-if="rail" content="Create" side="right">
      <Button
        variant="primary"
        size="icon"
        aria-label="Create"
        :aria-pressed="createScreen.open"
        @click="openCreate"
      >
        <Plus :size="16" :stroke-width="2.25" />
      </Button>
    </Tooltip>
    <Button
      v-else
      variant="primary"
      size="md"
      block
      :aria-pressed="createScreen.open"
      @click="openCreate"
    >
      <Plus :size="16" :stroke-width="2.25" />Create
    </Button>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mcq {
  display: flex;
  flex-shrink: 0;
  margin: -4px 0 16px;
}
:root .proto-ui.proto-ui.proto-ui .mcq.is-rail {
  justify-content: center;
}
</style>
