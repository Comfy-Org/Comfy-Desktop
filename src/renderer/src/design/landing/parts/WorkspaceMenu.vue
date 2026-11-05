<script setup lang="ts">
import { ChevronsUpDown, Coins } from 'lucide-vue-next'
import Button from '../ui/Button.vue'
import WorkspaceAvatar from './WorkspaceAvatar.vue'
import MarWorkspaceMenu from '../mar/MarWorkspaceMenu.vue'
import MarCredits from '../mar/MarCredits.vue'
import MarSignIn from '../mar/shell/MarSignIn.vue'
import { marNav, marPanelsOn } from '../mar/shell/marShell'
import MarCreditsFlyout from '../mar/MarCreditsFlyout.vue'
import { creditsStyle, creditsTotal } from '../mar/credits'
import { proto } from '../useProto'
import { can } from '../milestones'
import { shownCredits, shownEmail, shownWorkspace as workspace } from '../account'
</script>

<template>
  <MarSignIn v-if="!proto.signedIn" :open="!(marPanelsOn && marNav.collapsed)" />
  <div v-else class="flex flex-col gap-1">
    <!-- Credits as a chip or meter instead (mar/). -->
    <!-- Before Home there are no credits in the sidebar (mar/). -->
    <MarCredits v-if="can.home && creditsStyle.id !== 'row'" />
    <!-- The row opens Alex's credits flyout (mar/). -->
    <MarCreditsFlyout v-if="can.home && shownCredits && creditsStyle.id === 'row'">
      <Button
        variant="ghost"
        class="mar-credits-row h-8 justify-start gap-2.5 px-3 text-base-foreground data-[state=open]:bg-secondary-background"
      >
        <Coins :size="15" class="shrink-0 text-[#ddbd31]" />
        <span class="sidebar-label text-left">Credits</span>
        <span class="tabular-nums">{{ creditsTotal }}</span>
      </Button>
    </MarCreditsFlyout>
    <MarWorkspaceMenu>
      <Button
        variant="ghost"
        class="h-auto justify-start gap-2.5 p-1.5 text-left text-base-foreground data-[state=open]:bg-secondary-background"
      >
        <WorkspaceAvatar :ws="workspace" />
        <span class="sidebar-label flex flex-col">
          <span class="truncate text-ui font-medium">{{ workspace.name }}</span>
          <span class="truncate text-ui font-normal text-subtle-foreground">{{
            can.home ? workspace.plan : shownEmail
          }}</span>
        </span>
        <ChevronsUpDown :size="14" class="text-subtle-foreground" />
      </Button>
    </MarWorkspaceMenu>
  </div>
</template>
