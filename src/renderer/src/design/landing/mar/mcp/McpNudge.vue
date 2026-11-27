<script setup lang="ts">
import { computed } from 'vue'
import { Info, X } from 'lucide-vue-next'
import { can } from '../../milestones'
import { instanceById, proto } from '../../useProto'
import { hideNudge, mcp } from './mcpSetup'
import './mcp.css'
import '../pages/MarUndoToast.vue'

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
  <Transition name="mar-undo">
    <div v-if="shown && inst" class="proto-ui mcp-nudge-host">
      <div class="mar-undo is-info" role="status" data-testid="mcp-nudge">
        <Info :size="16" class="mar-undo-icon" />
        <span class="mar-undo-text">Run this build from your AI agent</span>
        <button type="button" class="mar-undo-btn" @click="connect">Connect</button>
        <button
          type="button"
          class="mar-undo-x"
          aria-label="Dismiss"
          @click="hideNudge(inst.id)"
        >
          <X :size="13" />
        </button>
      </div>
    </div>
  </Transition>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mcp-nudge-host .mar-undo {
  top: 116px;
}
</style>
