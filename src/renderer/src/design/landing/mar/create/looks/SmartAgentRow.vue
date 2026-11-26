<script setup lang="ts">
import { AgentChat } from '../../icons/agentChat'

const {
  query,
  at = false,
  lead = false
} = defineProps<{
  query: string
  at?: boolean
  lead?: boolean
}>()
</script>

<template>
  <div class="v15-agent cursor-pointer" :class="[at && 'is-at', lead && 'is-lead']">
    <span class="v15-agent-badge" aria-hidden="true"><AgentChat :size="16" /></span>
    <span class="v15-agent-text">
      <span class="v15-agent-name">{{
        lead ? 'Ask the agent' : 'Not quite it? Ask the agent'
      }}</span>
      <span class="v15-agent-does" :title="query">Builds a workflow for “{{ query }}”</span>
    </span>
    <kbd class="v15-agent-key" aria-hidden="true">↵</kbd>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v15-agent {
  display: grid;
  width: 100%;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 14px 18px 14px 14px;
  border-radius: 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, var(--color-content-background));
  text-align: left;
  transition: background-color 140ms ease;
  animation: v15-fade 200ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .v15-agent.is-at {
  background: color-mix(
    in oklch,
    var(--color-base-foreground) 10%,
    var(--color-content-background)
  );
}
:root .proto-ui.proto-ui.proto-ui .v15-agent-badge {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  color: var(--color-muted-foreground);
  transition: color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-agent.is-at .v15-agent-badge {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v15-agent-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
:root .proto-ui.proto-ui.proto-ui .v15-agent-name {
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v15-agent-does {
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-muted-foreground);
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
:root .proto-ui.proto-ui.proto-ui .v15-agent-key {
  display: grid;
  min-width: 22px;
  height: 22px;
  place-items: center;
  padding: 0 6px;
  border-radius: 6px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-subtle-foreground);
  font-family: inherit;
  font-size: 12px;
  opacity: 0;
  transition: opacity 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-agent.is-at .v15-agent-key {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v15-agent,
  :root .proto-ui.proto-ui.proto-ui .v15-agent-badge,
  :root .proto-ui.proto-ui.proto-ui .v15-agent-key {
    animation: none;
    transition: none;
  }
}
</style>
