<script setup lang="ts">
import { ArrowRight, Cloud, Laptop } from 'lucide-vue-next'
import { hostActions, proto } from '../useProto'
import { INSTANCES } from '../mock'
import { onCloud } from './shell/surface'

/**
 * First run · where Comfy runs: Comfy Cloud (recommended, ready now) or
 * this computer (an install). Two calm cards side by side, each saying
 * what you get and what it takes, with one clear action. The local card
 * depends on where you are: on Cloud it installs the Desktop app; on
 * Desktop (the app is already here) it sets up ComfyUI on this computer.
 */
function openCloud(): void {
  if (proto.signedIn) hostActions.launch(INSTANCES[0]!)
  else hostActions.signIn()
}
</script>

<template>
  <div class="mar-where">
    <button type="button" class="mar-where-card mar-row-card is-cloud" @click="openCloud">
      <span class="mar-where-icon mar-row-icon"><Cloud :size="18" /></span>
      <span class="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span class="flex items-center gap-2">
          <span class="text-ui font-medium text-base-foreground">Comfy Cloud</span>
          <span class="mar-where-tag">Recommended</span>
        </span>
        <span class="text-ui text-subtle-foreground"
          >Ready in seconds. Fast GPUs, every model.</span
        >
      </span>
      <span class="mar-where-cta is-primary">
        {{ proto.signedIn ? 'Open' : 'Sign in' }}<ArrowRight :size="14" />
      </span>
    </button>
    <button type="button" class="mar-where-card mar-row-card" @click="hostActions.newInstance()">
      <span class="mar-where-icon mar-row-icon"><Laptop :size="18" /></span>
      <span class="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span class="text-ui font-medium text-base-foreground">This computer</span>
        <span class="text-ui text-subtle-foreground">{{
          onCloud
            ? 'Get the Desktop app. Your own GPU, works offline.'
            : 'Your own GPU, works offline.'
        }}</span>
      </span>
      <span class="mar-where-cta"
        >{{ onCloud ? 'Install' : 'Set up' }}<ArrowRight :size="14"
      /></span>
    </button>
  </div>
</template>

<style scoped>
.mar-where {
  display: grid;
  width: 100%;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.is-cloud .mar-where-icon {
  background: linear-gradient(135deg, #f9d7e6, #d9d4fb 50%, #c9f0e1);
  color: #3b2f55;
}
.mar-where-tag {
  border-radius: 999px;
  padding: 1px 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-muted-foreground);
  font-size: 11px;
  line-height: 18px;
}
.mar-where-cta {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  height: 32px;
  border-radius: var(--radius-control);
  padding: 0 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
  transition:
    background-color 160ms ease,
    gap 300ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-where-cta.is-primary {
  background: var(--color-base-foreground);
  color: var(--color-content-background);
}
.mar-where-card:hover .mar-where-cta {
  gap: 9px;
}
@media (max-width: 900px) {
  .mar-where {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mar-where-cta {
    transition: none;
  }
}
</style>

<style>
/* Global: buttons, past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mar-where-card {
  background: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  backdrop-filter: blur(20px);
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-where-card:hover {
  background: color-mix(in oklch, var(--color-card-background-hover) 80%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
:root[data-ds-theme='light'] .proto-ui.proto-ui.proto-ui .mar-where-card {
  background: var(--color-card-background, #fff);
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 8%, transparent),
    0 1px 2px rgb(0 0 0 / 0.04);
}
</style>
