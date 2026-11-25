<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import { can } from '../../milestones'
import { instanceById, proto } from '../../useProto'
import { hideNudge, mcp } from './mcpSetup'
import './mcp.css'

/**
 * The card in the bottom right corner of a local build's canvas, from
 * Milestone 2 on (Comfy-Desktop#2032). Connect opens the setup; either
 * way it stays away on that build.
 */
const inst = computed(() => {
  const tab = proto.tabs.find((t) => t.id === proto.activeTab)
  return tab ? instanceById(tab.instanceId) : undefined
})
const shown = computed(
  () =>
    can.value.exploreApps &&
    inst.value?.kind === 'local' &&
    !mcp.open &&
    !mcp.hidden.includes(inst.value.id)
)
function connect(): void {
  if (!inst.value) return
  hideNudge(inst.value.id)
  mcp.open = { name: inst.value.name, port: 8188 }
}
</script>

<template>
  <Transition name="mcp-nudge">
    <div v-if="shown && inst" class="mcp-nudge" role="status">
      <span class="mcp-nudge-text">
        <span class="mcp-nudge-title">Run this build from your AI agent</span>
        <span class="mcp-nudge-lead">Connect Claude Code, Cursor or any MCP agent.</span>
      </span>
      <button type="button" class="mcp-nudge-go" @click="connect">Connect</button>
      <button type="button" class="mcp-nudge-x" aria-label="Dismiss" @click="hideNudge(inst.id)">
        <X :size="15" />
      </button>
    </div>
  </Transition>
</template>
