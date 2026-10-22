<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import Button from './Button.vue'

/** Section title row. `#controls` sits next to the title (e.g. a segmented
 *  control); `link` renders the trailing "See all" style action. */
const { title, link } = defineProps<{ title: string; link?: string }>()
const emit = defineEmits<{ link: [] }>()
</script>

<template>
  <div class="mb-3.5 flex items-center gap-3">
    <h2 class="text-ui font-semibold">{{ title }}</h2>
    <slot name="controls" />
    <Button v-if="link" variant="link" size="sm" class="ml-auto" @click="emit('link')">
      {{ link }}<slot name="link-icon"><ChevronRight :size="13" /></slot>
    </Button>
  </div>
</template>
