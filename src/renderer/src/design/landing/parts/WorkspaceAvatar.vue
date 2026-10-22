<script setup lang="ts">
import Avatar from '../ui/Avatar.vue'
import type { Workspace } from '../mock'

const { ws, size = 'md' } = defineProps<{ ws: Workspace; size?: 'sm' | 'md' | 'lg' }>()
</script>

<template>
  <Avatar
    :size
    tone="solid"
    class="rounded-control font-medium"
    :style="{ background: ws.color }"
    >{{ ws.initial }}</Avatar
  >
</template>
