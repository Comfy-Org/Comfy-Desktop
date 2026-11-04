<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  FolderOpen,
  Plus,
  Settings2,
  Square,
  Terminal,
  Trash2
} from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Avatar from '../../ui/Avatar.vue'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import LocationIcon from '../../ui/LocationIcon.vue'
import WorkspaceAvatar from '../WorkspaceAvatar.vue'
import ComfyWordmark from '../../../../components/icons/ComfyWordmark.vue'
import MarBackdrop from '../../mar/shell/MarBackdrop.vue'
import MarItemMenu from '../../mar/pages/MarItemMenu.vue'
import MarSearchField from '../../mar/pages/MarSearchField.vue'
import MarStatus, { type ItemStatus } from '../../mar/pages/MarStatus.vue'
import type { MenuLine } from '../../mar/pages/menu'
import { hostActions, instances, proto, requireLogin, toast } from '../../useProto'
import { WORKSPACES, type ProtoInstance } from '../../mock'
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
 * instance after "New Instance". A tile launches its instance. The parts
 * are Home's: its spotlight, its row cards, the toolbars' search field.
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

const STATUS: Record<ProtoInstance['state'], ItemStatus | undefined> = {
  running: 'running',
  stopped: undefined,
  launching: 'launching',
  update: 'update',
  error: 'failed'
}
const locked = (i: ProtoInstance): boolean => i.kind === 'cloud' && !proto.signedIn
function sub(i: ProtoInstance): string {
  if (i.kind === 'cloud')
    return proto.signedIn ? `Cloud GPUs · ${i.lastUsed}` : 'Log in to run on cloud GPUs'
  return [i.channel, i.version, i.lastUsed].filter(Boolean).join(' · ')
}
function launch(i: ProtoInstance): void {
  if (locked(i)) requireLogin()
  else hostActions.launch(i)
}
function lines(i: ProtoInstance): MenuLine[] {
  const local = i.kind === 'local'
  return [
    { label: 'Settings', icon: Settings2, run: () => toast(`${i.name} settings`) },
    ...(local
      ? [
          { label: 'Show in Finder', icon: FolderOpen, run: () => toast('Opening folder…') },
          { label: 'Console', icon: Terminal, run: () => toast('Console') }
        ]
      : []),
    ...(local && i.state === 'update'
      ? [{ label: 'Update', icon: ArrowDownToLine, run: () => toast('Updating…') }]
      : []),
    ...(i.state === 'running'
      ? [{ label: 'Stop', icon: Square, run: () => toast(`Stopping ${i.name}…`) }]
      : []),
    ...(local
      ? [
          'sep' as const,
          { label: 'Delete', icon: Trash2, danger: true, run: () => toast(`Delete ${i.name}`) }
        ]
      : [])
  ]
}
</script>

<template>
  <div class="proto-shell relative flex size-full min-h-0 flex-1 overflow-hidden bg-app-background">
    <main
      class="proto-main relative min-w-0 flex-1 overflow-y-auto [scrollbar-color:rgb(255_255_255/0.12)_transparent] [scrollbar-width:thin]"
    >
      <MarBackdrop />
      <!-- Account, pinned top right, where Home keeps its Create menu -->
      <div class="mar-top-actions absolute top-3.5 right-4 z-10 flex items-center gap-2">
        <Button v-if="!proto.signedIn" variant="primary" @click="hostActions.signIn()"
          >Log in</Button
        >
        <span v-else class="flex items-center gap-2 text-ui text-muted-foreground">
          <Avatar size="sm">{{ shownEmail.charAt(0).toUpperCase() }}</Avatar
          >{{ shownEmail }}
        </span>
      </div>

      <div class="mx-auto flex w-full max-w-300 flex-col items-center px-10 pt-20 pb-16">
        <ComfyWordmark class="mar-dash-mark" aria-label="Comfy" />
        <MarSearchField v-model="query" placeholder="Search instances" class="mar-dash-find" />

        <!-- Workspace bar: which workspace, and how many instances in it -->
        <div class="mar-surface mt-5 flex items-center gap-3 rounded-card py-1 pr-3.5 pl-1">
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
          <span class="text-ui font-medium tracking-wider text-subtle-foreground uppercase"
            >Instances</span
          >
          <span class="text-ui font-medium tabular-nums">{{ instances.length }}</span>
        </div>

        <div class="mt-10 grid w-full grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3.5">
          <Card as="button" interactive class="mar-row-card" @click="hostActions.newInstance()">
            <span class="mar-row-icon"><Plus :size="18" /></span>
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="block truncate text-ui font-medium">New Instance</span>
              <span class="block truncate text-ui text-subtle-foreground"
                >Set up a fresh ComfyUI instance</span
              >
            </span>
          </Card>
          <Card
            v-for="i in shown"
            :key="i.id"
            interactive
            role="button"
            tabindex="0"
            class="mar-row-card"
            @click="launch(i)"
            @keydown.enter="launch(i)"
          >
            <span class="mar-row-icon">
              <LocationIcon :kind="i.kind === 'cloud' ? 'cloud' : 'local'" :size="18" />
            </span>
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="block truncate text-ui font-medium">{{ i.name }}</span>
              <span class="block truncate text-ui text-subtle-foreground">{{ sub(i) }}</span>
            </span>
            <MarStatus v-if="STATUS[i.state]" :status="STATUS[i.state]!" />
            <MarItemMenu :lines="lines(i)" :label="`${i.name} options`" />
          </Card>
        </div>
        <p v-if="!shown.length" class="mt-6 text-ui text-muted-foreground">No matches.</p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.mar-dash-mark {
  width: auto;
  height: 40px;
  color: var(--color-base-foreground);
}
.mar-dash-mark :deep(path) {
  fill: currentColor;
}
</style>

<style>
/* The toolbars' field, at the width this page gives it. */
:root .proto-ui.proto-ui.proto-ui .mar-pfind.mar-dash-find {
  width: 100%;
  max-width: 480px;
  /* Its flex-basis is for a toolbar row; in this column it would be height. */
  flex: none;
  margin-top: 32px;
}
</style>
