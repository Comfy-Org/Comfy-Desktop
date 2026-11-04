<script setup lang="ts">
import { proto } from '../useProto'
import { shownName } from '../account'

const { text } = defineProps<{ text?: string }>()
</script>

<template>
  <h1
    class="mb-5.5 pt-14 text-center text-display font-semibold tracking-[-0.02em] text-base-foreground"
  >
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
