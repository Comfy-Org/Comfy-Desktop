<script setup lang="ts">
import { ChevronsUpDown, CreditCard, LogOut, UserCog, Users } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Button from '../ui/Button.vue'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../ui/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../ui/DropdownMenuSeparator.vue'
import ContextSwitchSub from './ContextSwitchSub.vue'
import SignInCard from './SignInCard.vue'
import WorkspaceAvatar from './WorkspaceAvatar.vue'
import { Gauge, KeyRound, ShieldAlert } from 'lucide-vue-next'
import { go, proto, toast, type Page } from '../useProto'
import {
  realAccount,
  realSignOut,
  shownCredits,
  shownEmail,
  shownWorkspace as workspace
} from '../account'

const ADMIN: { page: Page; label: string; icon: unknown }[] = [
  { page: 'usage', label: 'Usage', icon: Gauge },
  { page: 'billing', label: 'Billing & credits', icon: CreditCard },
  { page: 'limits', label: 'Limits', icon: ShieldAlert },
  { page: 'people', label: 'People', icon: Users },
  { page: 'provider-keys', label: 'Provider keys', icon: KeyRound }
]

function signOut(): void {
  if (realAccount.value) return void realSignOut()
  proto.signedIn = false
  toast('Signed out')
}
</script>

<template>
  <SignInCard v-if="!proto.signedIn" />
  <div v-else class="flex flex-col gap-1">
    <Button
      v-if="shownCredits"
      variant="ghost"
      class="h-8 justify-start gap-2.5 px-3 text-base-foreground"
      @click="toast('Manage plan & credits')"
    >
      <span class="size-3.5 shrink-0 rounded-full border-[1.5px] border-[#cfc9b8]" />
      <span class="sidebar-label text-left">Credits</span>
      <span class="tabular-nums">{{ shownCredits }}</span>
    </Button>
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
      <DropdownMenuContent side="top" align="start" class="w-64">
        <div class="flex items-center gap-2.5 px-2 pt-1.5 pb-2.5">
          <WorkspaceAvatar :ws="workspace" size="lg" />
          <span class="flex flex-col">
            <span class="text-ui font-medium">{{ workspace.name }}</span>
            <span class="text-ui tracking-wide text-subtle-foreground uppercase">
              {{ workspace.plan.replace(' plan', '')
              }}{{ workspace.role ? ` · ${workspace.role}` : '' }}
            </span>
          </span>
        </div>
        <ContextSwitchSub />
        <!-- Admin lives here, the same in Create and Build. -->
        <DropdownMenuItem v-for="i in ADMIN" :key="i.page" @select="go(i.page)">
          <component :is="i.icon" :size="14" />{{ i.label }}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{{ shownEmail }}</DropdownMenuLabel>
        <DropdownMenuItem @select="toast('Account settings')"
          ><UserCog :size="14" />Account settings</DropdownMenuItem
        >
        <DropdownMenuItem @select="signOut"><LogOut :size="14" />Log out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuRoot>
  </div>
</template>
