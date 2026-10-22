<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ChevronsUpDown,
  Eye,
  Gauge,
  Home,
  Images,
  LayoutGrid,
  LifeBuoy,
  LogOut,
  MessageSquarePlus,
  PanelLeft,
  UserCog,
  Users
} from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Button from '../ui/Button.vue'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../ui/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../ui/DropdownMenuSeparator.vue'
import { cn } from '../ui/cn'
import Tooltip from '../ui/Tooltip.vue'
import ContextSwitchSub from '../parts/ContextSwitchSub.vue'
import SpaceMark from '../parts/space/SpaceMark.vue'
import PortalHome from './PortalHome.vue'
import PortalInvite from './PortalInvite.vue'
import PortalSignIn from './PortalSignIn.vue'
import PortalLibrary from './PortalLibrary.vue'
import PortalRequests from './PortalRequests.vue'
import PortalRun from './PortalRun.vue'
import PortalTeam from './PortalTeam.vue'
import PortalTools from './PortalTools.vue'
import PortalUsage from './PortalUsage.vue'
import { themeVars } from '../spaces'
import { clientUser, currentSpace, MEMBER_CREDITS, ROLE_LABEL, STUDIO } from '../spaces'
import { proto, toast } from '../useProto'
import { fmt } from '../parts/env/env'

/**
 * What a client sees: one space, branded as theirs. No environments,
 * graphs, other spaces or Comfy chrome - just the tools the studio
 * published, their outputs, requests and (for space admins) their team.
 */
const space = computed(() => currentSpace.value)
const user = computed(() => clientUser.value)
const isAdmin = computed(() => user.value.role === 'admin')
const left = computed(() => Math.max(0, space.value.budget - space.value.used))
// Whose credits show in the header depends on who pays.
const pill = computed(() =>
  space.value.payer === 'owner'
    ? `${fmt(left.value)} credits left`
    : space.value.payer === 'split'
      ? `${fmt(Math.round(space.value.allowance * 0.62))} of ${fmt(space.value.allowance)} covered`
      : `${fmt(MEMBER_CREDITS)} your credits`
)
const toolId = computed(() =>
  proto.portalPage.startsWith('tool:') ? proto.portalPage.slice(5) : ''
)
const NAV = computed(() => [
  { page: 'home', label: 'Home', icon: Home },
  { page: 'tools', label: 'Tools', icon: LayoutGrid },
  { page: 'library', label: 'Library', icon: Images },
  { page: 'requests', label: 'Requests', icon: MessageSquarePlus },
  ...(isAdmin.value ? [{ page: 'team', label: 'Team', icon: Users }] : [])
])
// Collapsed by default: icons with their label underneath.
const expanded = ref(false)
const active = (p: string): boolean =>
  proto.portalPage === p || (p === 'tools' && proto.portalPage.startsWith('tool:'))
const open = (p: string): void => {
  proto.portalPage = p
}
</script>

<template>
  <div
    class="relative flex size-full min-h-0 flex-1 flex-col overflow-hidden bg-(--brand-surface)"
    :style="themeVars(space.brand)"
  >
    <!-- Studio preview: you're seeing exactly what members see. -->
    <div
      v-if="proto.previewing"
      class="flex h-11 shrink-0 items-center gap-2 border-b border-border-default bg-secondary-background px-5 text-ui text-muted-foreground"
    >
      <Eye :size="13" />Previewing <span class="text-base-foreground">{{ space.name }}</span> as
      {{ user.name }} · {{ ROLE_LABEL[user.role] }}
    </div>

    <!-- Member journey: invite email and sign-in come before the space. -->
    <div
      v-if="proto.memberStage !== 'space' && !proto.previewing"
      class="min-h-0 flex-1 overflow-y-auto"
    >
      <PortalInvite v-if="proto.memberStage === 'email'" />
      <PortalSignIn v-else />
    </div>

    <!-- The sidebar floats over the page, so the brand colour runs under it. -->
    <div v-else class="relative flex min-h-0 flex-1">
      <!-- Same glass sidebar as the admin app; collapsed by default. -->
      <aside
        :class="
          cn(
            'absolute top-0 bottom-0 left-0 z-20 m-2 flex flex-col overflow-y-auto rounded-panel border border-border-default bg-media-overlay p-2 shadow-popover backdrop-blur-glass backdrop-saturate-[1.6] transition-[width] duration-200 [scrollbar-width:none]',
            expanded ? 'w-59' : 'w-19'
          )
        "
      >
        <div
          :class="
            cn('mb-3 flex items-center', expanded ? 'h-8 gap-2 pr-1 pl-2' : 'flex-col gap-2 pt-1')
          "
        >
          <SpaceMark
            v-if="expanded"
            :brand="space.brand"
            size="sm"
            :named="expanded"
            :class="expanded ? 'min-w-0 flex-1' : undefined"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="expanded ? 'Collapse sidebar' : 'Expand sidebar'"
            @click="expanded = !expanded"
            ><PanelLeft :size="15"
          /></Button>
        </div>

        <nav class="flex flex-col gap-px" aria-label="Space">
          <Button
            v-for="n in NAV"
            :key="n.page"
            variant="ghost"
            :aria-current="active(n.page) ? 'page' : undefined"
            :class="
              cn(
                'font-normal',
                expanded
                  ? 'h-8 w-full justify-start gap-2.5 px-2.5 text-ui'
                  : 'h-auto w-full flex-col gap-1 px-0 py-2 text-[10.5px] leading-none',
                active(n.page) && 'bg-secondary-background-hover text-base-foreground'
              )
            "
            @click="open(n.page)"
          >
            <component :is="n.icon" :size="expanded ? 15 : 17" />
            <span :class="expanded && 'flex-1 text-left'">{{ n.label }}</span>
          </Button>
        </nav>

        <div class="mt-auto flex flex-col gap-1 pt-3">
          <Tooltip :content="pill" side="right">
            <Button
              variant="ghost"
              :class="
                cn(
                  'font-normal text-muted-foreground',
                  expanded
                    ? 'h-8 w-full justify-start gap-2.5 px-2.5 text-ui'
                    : 'h-auto w-full flex-col gap-1 px-0 py-2 text-[10.5px] leading-none'
                )
              "
              @click="open('usage')"
            >
              <Gauge :size="expanded ? 15 : 17" />
              <span class="truncate tabular-nums">{{ expanded ? pill : 'Usage' }}</span>
            </Button>
          </Tooltip>

          <!-- Space picker: other spaces, and workspaces this account owns or joined. -->
          <DropdownMenuRoot :modal="false">
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                :class="
                  cn(
                    'w-full font-normal',
                    expanded
                      ? 'h-12 justify-start gap-2.5 px-2'
                      : 'h-auto flex-col gap-1 px-0 py-2 text-[10.5px] leading-none'
                  )
                "
                aria-label="Switch space"
              >
                <SpaceMark :brand="space.brand" :size="expanded ? 'md' : 'sm'" />
                <template v-if="expanded">
                  <span class="min-w-0 flex-1 text-left">
                    <span class="block truncate text-ui">{{ space.name }}</span>
                    <span class="block truncate text-ui text-subtle-foreground"
                      >{{ user.name }} · {{ ROLE_LABEL[user.role] }}</span
                    >
                  </span>
                  <ChevronsUpDown :size="14" class="text-subtle-foreground" />
                </template>
                <span v-else class="max-w-15 truncate">{{
                  space.brand.logo.name.split(' ')[0]
                }}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" class="w-64">
              <div class="flex items-center gap-2.5 px-2 pt-1.5 pb-2.5">
                <SpaceMark :brand="space.brand" size="md" />
                <span class="flex min-w-0 flex-col">
                  <span class="truncate text-ui font-medium">{{ space.name }}</span>
                  <span class="text-ui tracking-wide text-subtle-foreground uppercase">
                    Space · {{ ROLE_LABEL[user.role] }}
                  </span>
                </span>
              </div>
              <ContextSwitchSub />
              <DropdownMenuItem v-if="isAdmin" @select="open('team')"
                ><Users :size="14" />Team</DropdownMenuItem
              >
              <DropdownMenuItem @select="open('usage')"><Gauge :size="14" />Usage</DropdownMenuItem>
              <DropdownMenuItem @select="toast(`Message sent to ${STUDIO.name}`)"
                ><LifeBuoy :size="14" />Contact {{ STUDIO.name }}</DropdownMenuItem
              >
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{{ user.email }}</DropdownMenuLabel>
              <DropdownMenuItem @select="toast('Account settings')"
                ><UserCog :size="14" />Account settings</DropdownMenuItem
              >
              <DropdownMenuItem @select="toast('Logged out')"
                ><LogOut :size="14" />Log out</DropdownMenuItem
              >
            </DropdownMenuContent>
          </DropdownMenuRoot>
        </div>
      </aside>

      <main
        class="relative min-h-0 flex-1 overflow-y-auto transition-[padding] duration-200 [scrollbar-color:rgb(255_255_255/0.12)_transparent] [scrollbar-width:thin]"
        :style="{ '--rail': expanded ? '244px' : '84px', paddingLeft: 'var(--rail)' }"
      >
        <PortalRun v-if="toolId" :key="toolId" :tool-id="toolId" />
        <PortalTools v-else-if="proto.portalPage === 'tools'" />
        <PortalLibrary v-else-if="proto.portalPage === 'library'" />
        <PortalRequests v-else-if="proto.portalPage === 'requests'" />
        <PortalTeam v-else-if="proto.portalPage === 'team'" />
        <PortalUsage v-else-if="proto.portalPage === 'usage'" />
        <PortalHome v-else :space />
        <p class="pb-6 text-center text-ui text-subtle-foreground">
          {{ STUDIO.name }} for {{ space.name }} · Powered by Comfy
        </p>
      </main>
    </div>
  </div>
</template>
