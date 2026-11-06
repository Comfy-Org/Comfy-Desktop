<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { proto } from '../../useProto'

/**
 * The Spaces page with none yet (a first-time user, Mar's proposal):
 * three gradient orbs for the spaces to come, what one is for and the way
 * to make it. Same orbs as the sidebar's invitation (MarSpacesInvite.vue).
 */
</script>

<template>
  <div class="flex min-h-[50vh] flex-col items-center justify-center text-center">
    <span class="mar-spaces-hero" aria-hidden="true"><i /><i /><i /></span>
    <h2 class="text-heading font-semibold">Share your work with clients</h2>
    <p class="mt-1.5 max-w-sm text-ui text-muted-foreground">
      Each client gets a space in their brand, with the apps you publish and a budget you set. They
      only see their own.
    </p>
    <Button variant="primary" class="mt-6" @click="proto.creatingSpace = true"
      ><Plus :size="14" />New space</Button
    >
  </div>
</template>

<style scoped>
.mar-spaces-hero {
  position: relative;
  width: 112px;
  height: 56px;
  margin-bottom: 28px;
}
.mar-spaces-hero i {
  position: absolute;
  top: 4px;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  box-shadow:
    0 0 0 3px var(--color-content-background, #000),
    0 14px 30px -12px rgb(0 0 0 / 0.6);
  transition: transform 400ms cubic-bezier(0.19, 1, 0.22, 1);
}
.mar-spaces-hero i:nth-child(1) {
  left: 0;
  background: radial-gradient(circle at 30% 30%, #ffd8a8, #f76707);
}
.mar-spaces-hero i:nth-child(2) {
  left: 32px;
  z-index: 1;
  background: radial-gradient(circle at 30% 30%, #d0bfff, #7048e8);
}
.mar-spaces-hero i:nth-child(3) {
  left: 64px;
  background: radial-gradient(circle at 30% 30%, #b2f2bb, #2f9e44);
}
/* Hover: the orbs spread a little, like Pablo's empty hands. Mouse only. */
@media (hover: hover) and (pointer: fine) {
  .mar-spaces-hero:hover i:nth-child(1) {
    transform: translateX(-8px);
  }
  .mar-spaces-hero:hover i:nth-child(3) {
    transform: translateX(8px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mar-spaces-hero i {
    transition: none;
  }
}
</style>
