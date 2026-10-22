<script setup lang="ts">
import Button from '../ui/Button.vue'
import Card from '../ui/Card.vue'
import { hostActions } from '../useProto'
</script>

<template>
  <!-- Sidebar 16 /p8 -> card 8; card /p4 -> button 4. -->
  <Card variant="inset" class="px-1 pt-3 pb-1">
    <p class="px-2 text-ui font-semibold">Log in to Comfy</p>
    <p class="mt-0.5 mb-3 px-2 text-ui text-subtle-foreground">Sync your work, use Cloud.</p>
    <Button variant="primary" block class="rounded-min" @click="hostActions.signIn()"
      >Log in</Button
    >
  </Card>
</template>
