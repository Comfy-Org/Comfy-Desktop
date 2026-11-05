<script setup lang="ts">
import { proto, hostActions } from '../../useProto'
import { shownWorkspace as workspace } from '../../account'
import WorkspaceAvatar from '../../parts/WorkspaceAvatar.vue'
import MarWorkspaceMenu from '../MarWorkspaceMenu.vue'

/** The account at the end of the Tabs bar (Nav options › Account): the
 *  workspace avatar opens Mar's workspace menu (switch, credits, admin,
 *  settings), as Pablo's sidebar foot does; signed out, a Log in button. */
</script>

<template>
  <MarWorkspaceMenu v-if="proto.signedIn" side="bottom">
    <button
      type="button"
      class="tabs-ws"
      :aria-label="`${workspace.name} workspace`"
      :title="workspace.name"
    >
      <WorkspaceAvatar :ws="workspace" />
    </button>
  </MarWorkspaceMenu>
  <button v-else type="button" class="tabs-login" @click="hostActions.signIn()">Log in</button>
</template>

<style scoped>
:root .proto-ui.proto-ui.proto-ui .tabs-ws {
  display: flex;
  align-items: center;
  align-self: center;
  padding: 3px;
  border-radius: 10px;
  transition: background-color 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui .tabs-ws:hover,
:root .proto-ui.proto-ui.proto-ui .tabs-ws[data-state='open'] {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .tabs-login {
  height: 30px;
  align-self: center;
  padding: 0 12px;
  border-radius: 9px;
  background: var(--color-base-foreground);
  color: var(--color-content-background);
  font-size: var(--text-ui);
  font-weight: 500;
}
</style>
