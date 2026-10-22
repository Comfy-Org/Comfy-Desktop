<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import Avatar from '../ui/Avatar.vue'
import Card from '../ui/Card.vue'
import { hostActions } from '../useProto'

const { compact = false, label = 'New build' } = defineProps<{
  compact?: boolean
  /** Before Milestone 2 there are instances, not builds. */
  label?: string
}>()
</script>

<template>
  <Card
    as="button"
    variant="dashed"
    padding="md"
    interactive
    class="flex min-h-full flex-col items-start justify-between gap-4 text-left"
    @click="hostActions.newInstance()"
  >
    <Avatar><Plus :size="15" /></Avatar>
    <span>
      <span class="block text-heading font-semibold text-base-foreground">{{ label }}</span>
      <span v-if="!compact" class="text-ui"
        >Set up a fresh ComfyUI {{ label.slice(4).toLowerCase() }}</span
      >
    </span>
  </Card>
</template>
