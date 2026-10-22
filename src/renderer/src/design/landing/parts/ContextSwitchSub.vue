<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeftRight, Check, Plus } from 'lucide-vue-next'
import { DropdownMenuSub } from 'reka-ui'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../ui/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../ui/DropdownMenuSeparator.vue'
import DropdownMenuSubContent from '../ui/DropdownMenuSubContent.vue'
import DropdownMenuSubTrigger from '../ui/DropdownMenuSubTrigger.vue'
import WorkspaceAvatar from './WorkspaceAvatar.vue'
import SpaceMark from './space/SpaceMark.vue'
import { SPACES } from '../spaces'
import { proto, toast } from '../useProto'
import { WORKSPACES } from '../mock'
import { realAccount, realSwitchWorkspace, realWorkspace, realWorkspaces } from '../account'

/**
 * One switcher for everything an account can be in: workspaces (the full
 * Comfy app) and spaces (the branded member view). Shared by the admin
 * workspace menu and the member space menu.
 */
const inSpace = computed(() => proto.spaces && proto.viewAs === 'client')
const mySpaces = computed(() => SPACES.filter((s) => s.status === 'live'))
const workspaces = computed(() => (realAccount.value ? realWorkspaces.value : WORKSPACES))
const currentId = computed(() => (realAccount.value ? realWorkspace.value?.id : proto.workspaceId))
function openWorkspace(id: string): void {
  if (realAccount.value) void realSwitchWorkspace(id)
  else proto.workspaceId = id as 'personal' | 'design-team'
  proto.viewAs = 'studio'
  proto.previewing = false
}
function openSpace(id: string): void {
  proto.spaceId = id
  proto.portalPage = 'home'
  proto.memberStage = 'space'
  proto.previewing = false
  proto.viewAs = 'client'
}
</script>

<template>
  <DropdownMenuSub>
    <DropdownMenuSubTrigger
      ><ArrowLeftRight :size="14" />{{
        proto.spaces ? 'Switch workspace or space' : 'Switch workspace'
      }}</DropdownMenuSubTrigger
    >
    <DropdownMenuSubContent class="w-60">
      <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
      <DropdownMenuItem v-for="w in workspaces" :key="w.id" @select="openWorkspace(w.id)">
        <WorkspaceAvatar :ws="w" size="sm" /><span class="flex-1 truncate">{{ w.name }}</span>
        <Check v-if="!inSpace && w.id === currentId" :size="14" />
      </DropdownMenuItem>
      <template v-if="proto.spaces">
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Spaces you're in</DropdownMenuLabel>
        <DropdownMenuItem v-for="s in mySpaces" :key="s.id" @select="openSpace(s.id)">
          <SpaceMark :brand="s.brand" size="xs" /><span class="flex-1 truncate">{{ s.name }}</span>
          <Check v-if="inSpace && s.id === proto.spaceId" :size="14" />
        </DropdownMenuItem>
      </template>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="toast('Create workspace')"
        ><Plus :size="14" />Create workspace</DropdownMenuItem
      >
    </DropdownMenuSubContent>
  </DropdownMenuSub>
</template>
