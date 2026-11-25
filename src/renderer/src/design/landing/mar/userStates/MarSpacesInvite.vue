<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { proto } from '../../useProto'

/**
 * Spaces with none yet (a first-time user, Mar's proposal): in place of
 * the list, what a space is for and how to make one. Three soft orbs
 * stand for the spaces to come, like the gradient marks real spaces get.
 */
</script>

<template>
  <button type="button" class="mar-spaces-invite" @click="proto.creatingSpace = true">
    <span class="mar-spaces-orbs" aria-hidden="true"><i /><i /><i /></span>
    <span class="block text-ui font-medium text-base-foreground">Share with clients</span>
    <span class="block text-ui text-subtle-foreground"
      >Each gets a branded space with your apps.</span
    >
    <span class="mt-1 inline-flex items-center gap-1 text-ui font-medium text-base-foreground"
      ><Plus :size="13" />New space</span
    >
  </button>
</template>

<style scoped>
:root .proto-ui.proto-ui.proto-ui .mar-spaces-invite,
.mar-spaces-invite {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: calc(100% - 8px);
  margin: 4px 4px 0;
  padding: 12px;
  border-radius: 10px;
  border: 1px dashed color-mix(in oklab, var(--color-base-foreground) 16%, transparent);
  background: color-mix(in oklab, var(--color-secondary-background) 50%, transparent);
  text-align: left;
  outline: none;
  transition:
    background-color 150ms ease,
    border-color 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-spaces-invite:hover,
.mar-spaces-invite:hover {
  background: var(--color-secondary-background);
  border-color: transparent;
}
.mar-spaces-invite:focus-visible {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
.mar-spaces-orbs {
  position: relative;
  width: 30px;
  height: 20px;
  margin-bottom: 6px;
}
.mar-spaces-orbs i {
  position: absolute;
  top: 2px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  /* The cut-out ring takes the card's own colour (its tint over the
     sidebar), so it never reads as an outline, in light or dark. */
  box-shadow: 0 0 0 1.5px
    color-mix(in oklab, var(--color-secondary-background) 50%, var(--color-app-background));
}
.mar-spaces-orbs i:nth-child(1) {
  left: 0;
  background: radial-gradient(circle at 30% 30%, #ffd8a8, #f76707);
}
.mar-spaces-orbs i:nth-child(2) {
  left: 7px;
  background: radial-gradient(circle at 30% 30%, #d0bfff, #7048e8);
}
.mar-spaces-orbs i:nth-child(3) {
  left: 14px;
  background: radial-gradient(circle at 30% 30%, #b2f2bb, #2f9e44);
}
@media (prefers-reduced-motion: reduce) {
  .mar-spaces-invite {
    transition: none;
  }
}
</style>
