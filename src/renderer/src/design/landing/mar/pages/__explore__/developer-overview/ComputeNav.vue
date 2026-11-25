<script setup lang="ts">
import { ref, watch, type Component } from 'vue'
import {
  ArrowLeft,
  ChartColumn,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Cpu,
  KeyRound,
  Rocket,
  Server,
  Settings2,
  ShieldAlert,
  Users
} from 'lucide-vue-next'
import Button from '../../../../ui/Button.vue'
import { cn } from '../../../../ui/cn'
import ModeNav from '../../../../parts/env/ModeNav.vue'
import OptionBar from './OptionBar.vue'
import { go, proto, type Mode, type Page } from '../../../../useProto'
import {
  computeTab,
  devVariant,
  leaveSettings,
  openCompute,
  settingsMode,
  type ComputeTab
} from './variant'

const { mode } = defineProps<{ mode: Mode }>()

const ITEMS: { tab: ComputeTab; label: string; icon: Component; prefix?: string }[] = [
  { tab: 'builds', label: 'Builds', icon: Server, prefix: 'environment:' },
  { tab: 'deployments', label: 'Deployments', icon: Rocket, prefix: 'deployment:' },
  { tab: 'usage', label: 'Usage', icon: ChartColumn },
  { tab: 'keys', label: 'API keys', icon: KeyRound }
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
  <OptionBar />
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
  <template v-else>
    <ModeNav :mode :omit="['Builds']" />
    <nav
      v-if="mode === 'create' && proto.signedIn"
      class="flex flex-col gap-px"
      aria-label="Compute"
    >
      <template v-if="devVariant === 'e'">
        <div :class="head"><span>Compute</span></div>
        <Button
          v-for="i in ITEMS"
          :key="i.tab"
          variant="ghost"
          :aria-current="active(i) ? 'page' : undefined"
          :class="cn(row, active(i) && on)"
          @click="openCompute(i.tab)"
        >
          <component :is="i.icon" :size="15" />
          <span class="sidebar-label text-left">{{ i.label }}</span>
        </Button>
      </template>
      <template v-else>
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
</template>
