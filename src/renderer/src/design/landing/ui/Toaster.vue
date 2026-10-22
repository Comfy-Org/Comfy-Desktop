<script setup lang="ts">
import { ToastProvider, ToastRoot, ToastTitle, ToastViewport } from 'reka-ui'
import { computed } from 'vue'
import { proto } from '../useProto'

const open = computed({
  get: () => Boolean(proto.toast),
  set: (v) => {
    if (!v) proto.toast = ''
  }
})
</script>

<template>
  <ToastProvider :duration="2200">
    <ToastRoot
      v-model:open="open"
      class="rounded-control bg-inverted-background px-3.5 py-2 text-ui font-medium text-inverted-foreground shadow-popover data-[state=open]:animate-pop-in"
    >
      <ToastTitle>{{ proto.toast }}</ToastTitle>
    </ToastRoot>
    <ToastViewport class="fixed top-4 left-1/2 z-[70] -translate-x-1/2 outline-none" />
  </ToastProvider>
</template>
