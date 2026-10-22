<script setup lang="ts">
import { inject } from 'vue'
import Card from '../../landing/ui/Card.vue'
import type { PlaygroundKey } from '../playground'

/** The live specimen driven by the inspector's Props, on a quiet surface.
 *  Tagged with its playground key so the inspector can show its props. */
const key = inject<PlaygroundKey | undefined>('gallery-playground', undefined)
</script>

<template>
  <Card
    variant="inset"
    padding="lg"
    class="flex min-h-32 items-center justify-center"
    :data-playground="key"
  >
    <!-- Driven by Props in the inspector (Tweak); never by the design system. -->
    <span class="absolute top-2.5 left-3 text-ui text-subtle-foreground">Playground</span>
    <slot />
  </Card>
</template>
