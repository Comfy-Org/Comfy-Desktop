<script setup lang="ts">
import { computed } from 'vue'
import {
  Check,
  CreditCard,
  Gauge,
  KeyRound,
  LogOut,
  Plus,
  Settings2,
  ShieldAlert,
  Users
} from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import DropdownMenuSeparator from '../ui/DropdownMenuSeparator.vue'
import ContextSwitchSub from '../parts/ContextSwitchSub.vue'
import WorkspaceAvatar from '../parts/WorkspaceAvatar.vue'
import { go, proto, toast, type Page } from '../useProto'
import { WORKSPACES } from '../mock'
import { can } from '../milestones'
import {
  realAccount,
  realSignOut,
  realSwitchWorkspace,
  realWorkspace,
  realWorkspaces,
  shownCredits,
  shownEmail,
  shownWorkspace as workspace
} from '../account'

/**
 * The workspace menu in Mar's proposal: who and where on top with the
 * credits left, then the workspace's admin, then your account. Opens from
 * whatever trigger it wraps (the sidebar's workspace row).
 */
const { side = 'top' } = defineProps<{ side?: 'top' | 'right' | 'bottom' }>()

const ADMIN: { page: Page; label: string; icon: unknown }[] = [
  { page: 'usage', label: 'Usage', icon: Gauge },
  { page: 'billing', label: 'Billing & credits', icon: CreditCard },
  { page: 'limits', label: 'Limits', icon: ShieldAlert },
  { page: 'people', label: 'People', icon: Users },
  { page: 'provider-keys', label: 'Provider keys', icon: KeyRound }
]

// One workspace and no spaces: nothing to switch to; the card above says
// where you are, and the row only offers a new one.
const canSwitch = computed(
  () => proto.spaces || (realAccount.value ? realWorkspaces.value : WORKSPACES).length > 1
)

const role = (r: string): string => r.charAt(0).toUpperCase() + r.slice(1).toLowerCase()

// Before Home, the menu is today's Desktop: the workspaces, then Sign out
// (no credits, admin or settings in it yet).
const today = computed(() => !can.value.home)
const workspaces = computed(() => (realAccount.value ? realWorkspaces.value : WORKSPACES))
const currentId = computed(() => (realAccount.value ? realWorkspace.value?.id : proto.workspaceId))
function pick(id: string): void {
  if (realAccount.value) void realSwitchWorkspace(id)
  else proto.workspaceId = id as 'personal' | 'design-team'
}

function signOut(): void {
  if (realAccount.value) return void realSignOut()
  proto.signedIn = false
  toast('Signed out')
}
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger as-child><slot /></DropdownMenuTrigger>
    <DropdownMenuContent v-if="today" :side align="start" :side-offset="8" class="mar-ws-menu w-64">
      <DropdownMenuItem v-for="w in workspaces" :key="w.id" @select="pick(w.id)">
        <WorkspaceAvatar :ws="w" size="sm" /><span class="flex-1 truncate">{{ w.name }}</span>
        <Check v-if="w.id === currentId" :size="14" />
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="signOut"
        ><LogOut :size="15" class="text-subtle-foreground" />Sign out</DropdownMenuItem
      >
    </DropdownMenuContent>
    <DropdownMenuContent v-else :side align="start" :side-offset="8" class="mar-ws-menu w-68">
      <!-- Who and where, and what's left to spend. -->
      <div class="mar-ws-card mar-menu-panel">
        <div class="flex items-center gap-3">
          <WorkspaceAvatar :ws="workspace" size="lg" />
          <span class="flex min-w-0 flex-col">
            <span class="truncate text-ui font-medium text-base-foreground">{{
              workspace.name
            }}</span>
            <span class="truncate text-ui text-subtle-foreground"
              >{{ workspace.plan.replace(' plan', '')
              }}{{ workspace.role ? ` · ${role(workspace.role)}` : '' }}</span
            >
          </span>
        </div>
        <button v-if="shownCredits" type="button" class="mar-ws-credits" @click="go('billing')">
          <span class="flex items-baseline justify-between">
            <span
              ><span class="font-medium text-base-foreground tabular-nums">{{ shownCredits }}</span>
              credits left</span
            ><span class="text-base-foreground">Top up</span>
          </span>
          <span class="mar-ws-bar"><span /></span>
        </button>
      </div>

      <ContextSwitchSub v-if="canSwitch" />
      <DropdownMenuItem v-else @select="toast('Create workspace')">
        <Plus :size="15" class="text-subtle-foreground" />Create workspace
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem v-for="i in ADMIN" :key="i.page" @select="go(i.page)">
        <component :is="i.icon" :size="15" class="text-subtle-foreground" />{{ i.label }}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem @select="go('settings' as Page)">
        <Settings2 :size="15" class="text-subtle-foreground" />
        <span class="flex min-w-0 flex-col">
          <span>Settings</span>
          <span class="truncate text-[12px] text-subtle-foreground">{{ shownEmail }}</span>
        </span>
      </DropdownMenuItem>
      <DropdownMenuItem @select="signOut"
        ><LogOut :size="15" class="text-subtle-foreground" />Log out</DropdownMenuItem
      >
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>

<style>
/* Global: the menu is portalled to <body>. The card is the menu's raised
   panel (mar/menus/layers.css). */
.mar-ws-menu .mar-ws-card {
  gap: 12px;
  padding: 10px;
}
:root .proto-ui.proto-ui.proto-ui .mar-ws-credits,
.mar-ws-menu .mar-ws-credits {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 8px;
  padding: 0;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-align: left;
}
.mar-ws-menu .mar-ws-bar {
  display: block;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mar-ws-menu .mar-ws-bar > span {
  display: block;
  width: 62%;
  height: 100%;
  border-radius: inherit;
  background: var(--color-base-foreground);
}
.mar-ws-menu [role='menuitem'] {
  min-height: 32px;
  gap: 10px;
}
</style>
