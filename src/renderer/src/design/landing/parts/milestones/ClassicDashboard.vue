<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Avatar from '../../ui/Avatar.vue'
import Button from '../../ui/Button.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import SearchInput from '../../ui/SearchInput.vue'
import InstanceCard from '../InstanceCard.vue'
import NewInstanceCard from '../NewInstanceCard.vue'
import WorkspaceAvatar from '../WorkspaceAvatar.vue'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import { hostActions, instances, proto } from '../../useProto'
import { WORKSPACES } from '../../mock'
import {
  realAccount,
  realSwitchWorkspace,
  realWorkspaces,
  shownEmail,
  shownWorkspace
} from '../../account'

/**
 * Milestone 1: today's dashboard (ChooserView on main) in the new design
 * system - same layout and words: account at the top right, the wordmark,
 * search, the workspace bar with its instance count, then a tile per
 * instance after "New Instance". A tile launches its instance.
 */
const query = ref('')
const shown = computed(() =>
  instances.value.filter((i) => i.name.toLowerCase().includes(query.value.trim().toLowerCase()))
)
const workspaces = computed(() => (realAccount.value ? realWorkspaces.value : WORKSPACES))
function switchWorkspace(id: string): void {
  if (realAccount.value) void realSwitchWorkspace(id)
  else proto.workspaceId = id as typeof proto.workspaceId
}
</script>

<template>
  <div class="proto-shell relative flex size-full min-h-0 flex-1 overflow-hidden bg-app-background">
    <main
      class="proto-main relative min-w-0 flex-1 overflow-y-auto [scrollbar-color:rgb(255_255_255/0.12)_transparent] [scrollbar-width:thin]"
    >
      <!-- Account, pinned top right -->
      <div class="absolute top-4 right-5">
        <Button v-if="!proto.signedIn" variant="primary" size="sm" @click="hostActions.signIn()"
          >Log in</Button
        >
        <span v-else class="flex items-center gap-2 text-ui text-muted-foreground">
          <Avatar size="sm">{{ shownEmail.charAt(0).toUpperCase() }}</Avatar
          >{{ shownEmail }}
        </span>
      </div>

      <div class="mx-auto flex w-full max-w-240 flex-col items-center px-10 pt-20 pb-16">
        <div class="flex items-center gap-2.5 text-display font-semibold heading-gradient">
          <ComfyCLogo :size="34" />Comfy
        </div>
        <SearchInput v-model="query" placeholder="Search instances" class="mt-8 w-full max-w-120" />

        <!-- Workspace bar: which workspace, and how many instances in it -->
        <div
          class="mt-5 flex items-center gap-3 rounded-control border border-border-default bg-secondary-background py-1 pr-3.5 pl-1"
        >
          <DropdownMenuRoot :modal="false">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="sm" class="gap-2 px-2">
                <WorkspaceAvatar :ws="shownWorkspace" size="sm" />
                {{ shownWorkspace.name }}
                <ChevronDown :size="13" class="text-subtle-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="w-56">
              <DropdownMenuItem v-for="w in workspaces" :key="w.id" @select="switchWorkspace(w.id)">
                <WorkspaceAvatar :ws="w" size="sm" />
                <span class="flex-1 truncate">{{ w.name }}</span>
                <Check v-if="w.id === shownWorkspace.id" :size="14" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuRoot>
          <span class="h-4 w-px bg-border-default" aria-hidden="true" />
          <span class="text-ui tracking-wider text-subtle-foreground uppercase">Instances</span>
          <span class="text-ui font-semibold tabular-nums">{{ instances.length }}</span>
        </div>

        <div class="mt-10 grid w-full grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          <NewInstanceCard label="New Instance" />
          <InstanceCard v-for="i in shown" :key="i.id" :inst="i" launch-on-click />
        </div>
        <p v-if="!shown.length" class="mt-6 text-ui text-muted-foreground">No matches.</p>
      </div>
    </main>
  </div>
</template>
