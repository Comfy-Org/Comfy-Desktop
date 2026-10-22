<script setup lang="ts">
import { proto } from '../useProto'
import { shownName } from '../account'

const { text } = defineProps<{ text?: string }>()
</script>

<template>
  <h1 class="heading-gradient mb-5.5 pt-14 text-center text-display font-bold tracking-[-0.02em]">
    {{
      text ??
      (proto.signedIn && shownName
        ? `Hi ${shownName}. Let's create`
        : proto.signedIn
          ? "Let's create"
          : "Welcome to Comfy. Let's create")
    }}
  </h1>
</template>
