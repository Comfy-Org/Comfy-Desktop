<script setup lang="ts">
import { ChevronsUpDown, Coins, LogOut, Plus, Settings2 } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Button from '../../../../ui/Button.vue'
import DropdownMenuContent from '../../../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../../../ui/DropdownMenuItem.vue'
import DropdownMenuSeparator from '../../../../ui/DropdownMenuSeparator.vue'
import WorkspaceAvatar from '../../../../parts/WorkspaceAvatar.vue'
import ContextSwitchSub from '../../../../parts/ContextSwitchSub.vue'
import MarSignIn from '../../../shell/MarSignIn.vue'
import MarCreditsFlyout from '../../../MarCreditsFlyout.vue'
import { creditsTotal } from '../../../credits'
import { go, proto, toast } from '../../../../useProto'
import { shownCredits, shownWorkspace as workspace } from '../../../../account'

function signOut(): void {
  proto.signedIn = false
  toast('Signed out')
}
</script>

<template>
  <MarSignIn v-if="!proto.signedIn" :open="true" />
  <div v-else class="flex flex-col gap-1">
    <MarCreditsFlyout v-if="shownCredits">
      <Button
        variant="ghost"
        class="mar-credits-row h-8 justify-start gap-2.5 px-3 text-base-foreground data-[state=open]:bg-secondary-background"
      >
        <Coins :size="15" class="shrink-0 text-[#ddbd31]" />
        <span class="sidebar-label text-left">Credits</span>
        <span class="tabular-nums">{{ creditsTotal }}</span>
      </Button>
    </MarCreditsFlyout>
    <DropdownMenuRoot :modal="false">
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          class="h-auto justify-start gap-2.5 p-1.5 text-left text-base-foreground data-[state=open]:bg-secondary-background"
        >
          <WorkspaceAvatar :ws="workspace" />
          <span class="sidebar-label flex flex-col">
            <span class="truncate text-ui font-medium">{{ workspace.name }}</span>
            <span class="truncate text-ui font-normal text-subtle-foreground">{{
              workspace.plan
            }}</span>
          </span>
          <ChevronsUpDown :size="14" class="text-subtle-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" :side-offset="8" class="mar-ws-menu w-68">
        <ContextSwitchSub v-if="proto.spaces" />
        <DropdownMenuItem v-else @select="toast('Create workspace')">
          <Plus :size="15" class="text-subtle-foreground" />Create workspace
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem @select="go('people')">
          <Settings2 :size="15" class="text-subtle-foreground" />Settings
        </DropdownMenuItem>
        <DropdownMenuItem @select="signOut"
          ><LogOut :size="15" class="text-subtle-foreground" />Log out</DropdownMenuItem
        >
      </DropdownMenuContent>
    </DropdownMenuRoot>
  </div>
</template>
