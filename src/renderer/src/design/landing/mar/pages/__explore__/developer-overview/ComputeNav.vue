<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import {
  AppWindow,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Compass,
  CreditCard,
  Cpu,
  GraduationCap,
  Home,
  KeyRound,
  Search,
  Settings2,
  ShieldAlert,
  Users,
  Workflow
} from 'lucide-vue-next'
import Button from '../../../../ui/Button.vue'
import { cn } from '../../../../ui/cn'
import ModeNav from '../../../../parts/env/ModeNav.vue'
import { go, goIn, proto, type Mode, type Page } from '../../../../useProto'
import { can } from '../../../../milestones'
import { ComfyAssets } from '../../../icons/comfyIcons'
import { AgentChat } from '../../../icons/agentChat'
import { search } from '../../../search/search'
import { computeTab, leaveSettings, openCompute, settingsMode, type ComputeTab } from './variant'

const { mode } = defineProps<{ mode: Mode }>()

interface Place {
  label: string
  icon: Component
  page?: Page
  run?: () => void
  section?: string
}
const PLACES = computed<Place[]>(() => [
  { label: 'Home', icon: Home, page: 'overview' },
  ...(can.value.agent
    ? [{ label: 'Agent', icon: AgentChat, run: () => goIn('agent', 'agent') }]
    : []),
  ...(can.value.search ? [{ label: 'Search', icon: Search, run: () => (search.open = true) }] : []),
  { label: 'Explore', icon: Compass, page: 'explore' },
  ...(can.value.learn ? [{ label: 'Learn', icon: GraduationCap, page: 'tutorials' as Page }] : []),
  { label: 'Workflows', icon: Workflow, page: 'workflows', section: 'Libraries' },
  ...(proto.signedIn ? [{ label: 'Apps', icon: AppWindow, page: 'apps' as Page }] : []),
  { label: 'Assets', icon: ComfyAssets, page: 'assets' }
])
const placeOn = (p: Place): boolean =>
  proto.activeTab === 'home' && Boolean(p.page && proto.page === p.page)
function openPlace(p: Place): void {
  if (p.run) return p.run()
  proto.mode = 'create'
  if (p.page) go(p.page)
}

const ITEMS: { tab: ComputeTab; label: string; prefix?: string }[] = [
  { tab: 'builds', label: 'Builds', prefix: 'environment:' },
  { tab: 'deployments', label: 'Deployments', prefix: 'deployment:' },
  { tab: 'usage', label: 'Usage' },
  { tab: 'keys', label: 'API keys' }
]
const SETTINGS: { section?: string; page: Page; label: string; icon: Component }[] = [
  { section: 'Workspace', page: 'people', label: 'People', icon: Users },
  { page: 'billing', label: 'Billing & credits', icon: CreditCard },
  { page: 'limits', label: 'Limits', icon: ShieldAlert },
  { page: 'provider-keys', label: 'Provider keys', icon: KeyRound },
  { section: 'You', page: 'settings' as Page, label: 'Preferences', icon: Settings2 }
]
const active = (i: (typeof ITEMS)[number]): boolean =>
  proto.activeTab === 'home' &&
  ((proto.page === 'environments' && computeTab.value === i.tab) ||
    Boolean(i.prefix && proto.page.startsWith(i.prefix)))
const inCompute = (): boolean => ITEMS.some(active)
const open = ref(inCompute())
watch(
  () => proto.page,
  () => {
    if (inCompute()) open.value = true
  }
)
const row = 'h-8 w-full justify-start gap-2.5 px-3 text-ui font-normal'
const on = 'bg-secondary-background-hover text-base-foreground'
const head =
  'mt-5.5 flex h-6.5 items-center px-3 text-ui font-medium tracking-wider text-subtle-foreground uppercase'
</script>

<template>
  <nav v-if="settingsMode" class="flex flex-col gap-px" aria-label="Settings">
    <Button variant="ghost" :class="row" @click="leaveSettings">
      <ArrowLeft :size="15" />
      <span class="sidebar-label text-left">Back</span>
    </Button>
    <template v-for="s in SETTINGS" :key="s.page">
      <div v-if="s.section" :class="head">
        <span>{{ s.section }}</span>
      </div>
      <Button
        variant="ghost"
        :aria-current="proto.page === s.page ? 'page' : undefined"
        :class="cn(row, proto.page === s.page && on)"
        @click="go(s.page)"
      >
        <component :is="s.icon" :size="15" />
        <span class="sidebar-label text-left">{{ s.label }}</span>
      </Button>
    </template>
  </nav>
  <ModeNav v-else-if="mode !== 'create'" :mode />
  <nav v-else class="flex flex-col gap-px" aria-label="Create">
    <template v-for="p in PLACES" :key="p.label">
      <div v-if="p.section" :class="head">
        <span>{{ p.section }}</span>
      </div>
      <Button
        variant="ghost"
        :aria-current="placeOn(p) ? 'page' : undefined"
        :class="cn(row, placeOn(p) && on)"
        @click="openPlace(p)"
      >
        <component :is="p.icon" :size="15" />
        <span class="sidebar-label text-left">{{ p.label }}</span>
      </Button>
    </template>
    <template v-if="proto.signedIn">
      <Button
        variant="ghost"
        :aria-expanded="open"
        :class="cn(row, 'mt-3', !open && inCompute() && on)"
        @click="open = !open"
      >
        <Cpu :size="15" />
        <span class="sidebar-label flex-1 text-left">Compute</span>
        <component
          :is="open ? ChevronDown : ChevronRight"
          :size="13"
          class="text-subtle-foreground"
        />
      </Button>
      <template v-if="open">
        <Button
          v-for="i in ITEMS"
          :key="i.tab"
          variant="ghost"
          :aria-current="active(i) ? 'page' : undefined"
          :class="cn(row, 'pl-9.5', active(i) && on)"
          @click="openCompute(i.tab)"
        >
          <span class="sidebar-label text-left">{{ i.label }}</span>
        </Button>
      </template>
    </template>
  </nav>
</template>
