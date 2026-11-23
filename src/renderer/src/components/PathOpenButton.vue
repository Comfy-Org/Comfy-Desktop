<script setup lang="ts">
import RevealFolderButton from './RevealFolderButton.vue'

defineProps<{ path: string }>()
defineEmits<{ open: [] }>()
</script>

<template>
  <span class="config-path-value flex min-w-0 items-center gap-1">
    <span
      class="config-path-open block min-w-0 truncate text-left text-[13px] font-normal text-neutral-100"
      :title="path"
      >{{ path }}</span
    >
    <RevealFolderButton class="config-path-reveal -my-1.5" :path="path" @click="$emit('open')" />
  </span>
</template>
