<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowUpRight,
  EllipsisVertical,
  Globe,
  LayoutGrid,
  List,
  Lock,
  Plus,
  Rocket,
  Users
} from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Button from '../ui/Button.vue'
import Card from '../ui/Card.vue'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import PageHeader from '../ui/PageHeader.vue'
import SearchInput from '../ui/SearchInput.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import AppCard from '../parts/AppCard.vue'
import MemberAvatar from '../parts/MemberAvatar.vue'
import DeployedTo from '../parts/space/DeployedTo.vue'
import { proto, toast } from '../useProto'
import { openDeploy } from '../spaces'
import { APPS, thumb } from '../mock'

/** Apps people built from workflows - simple inputs, one button - and who
 *  they're shared with. Inspired by Codex "Sites". */
const tab = ref<'all' | 'yours' | 'shared'>('all')
const view = ref<'list' | 'grid'>('list')
const q = ref('')
const list = computed(() =>
  APPS.filter((a) => tab.value === 'all' || (tab.value === 'yours' ? a.you : !a.you)).filter((a) =>
    a.name.toLowerCase().includes(q.value.toLowerCase())
  )
)
const cols = computed(() =>
  proto.spaces
    ? 'grid-cols-[minmax(0,1fr)_150px_130px_190px_70px_72px]'
    : 'grid-cols-[minmax(0,1fr)_170px_150px_80px_72px]'
)
const SHARED = {
  everyone: { icon: Globe, label: 'Everyone' },
  team: { icon: Users, label: 'Workspace' },
  private: { icon: Lock, label: 'Only you' }
}
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader
      title="Apps"
      description="Workflows turned into simple tools anyone can run - a few inputs and a button."
    >
      <template #actions>
        <SegmentedControl
          v-model="view"
          :options="[
            { value: 'grid', icon: LayoutGrid, ariaLabel: 'Grid view' },
            { value: 'list', icon: List, ariaLabel: 'List view' }
          ]"
        />
        <SearchInput v-model="q" placeholder="Search apps" class="w-56" />
        <Button variant="primary" size="lg" @click="toast('New app from a workflow')"
          ><Plus :size="15" />New</Button
        >
      </template>
    </PageHeader>

    <SegmentedControl
      v-model="tab"
      variant="contained"
      class="mb-4"
      :options="[
        { value: 'all', label: 'All', count: APPS.length },
        { value: 'yours', label: 'Yours', count: APPS.filter((a) => a.you).length },
        { value: 'shared', label: 'Shared with you', count: APPS.filter((a) => !a.you).length }
      ]"
    />

    <div
      v-if="view === 'grid'"
      class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5"
    >
      <AppCard v-for="a in list" :key="a.id" :app="a" />
    </div>

    <Card v-else class="overflow-hidden">
      <div
        :class="[
          'grid h-10  items-center gap-4 border-b border-border-default bg-secondary-background/40 px-4 text-ui text-subtle-foreground',
          cols
        ]"
      >
        <span>App</span><span>Owner</span><span>Shared with</span
        ><span v-if="proto.spaces">Deployed</span><span class="text-right">Runs</span><span />
      </div>
      <div
        v-for="a in list"
        :key="a.id"
        role="button"
        tabindex="0"
        :class="[
          'group grid min-h-19 cursor-pointer  items-center gap-4 border-b border-border-default px-4 outline-none last:border-b-0 hover:bg-secondary-background/50 focus-visible:bg-secondary-background',
          cols
        ]"
        @click="toast(`Open ${a.name}`)"
        @keydown.enter="toast(`Open ${a.name}`)"
      >
        <span class="flex min-w-0 items-center gap-3.5">
          <img
            :src="thumb(a.thumbId)"
            alt=""
            class="h-12 w-19 shrink-0 rounded-control border border-border-default object-cover"
          />
          <span class="min-w-0">
            <span class="block truncate text-ui font-medium">{{ a.name }}</span>
            <span class="text-ui text-subtle-foreground">{{ a.updated }}</span>
          </span>
        </span>
        <span class="flex min-w-0 items-center gap-2 text-ui">
          <MemberAvatar :name="a.you ? 'Pablo' : a.owner" size="sm" />
          <span class="truncate">{{ a.owner }}</span>
        </span>
        <span class="flex items-center gap-1.5 text-ui text-muted-foreground">
          <component :is="SHARED[a.shared].icon" :size="13" />{{ SHARED[a.shared].label }}
        </span>
        <button
          v-if="proto.spaces"
          type="button"
          class="min-w-0 rounded-control px-1.5 py-1 text-left outline-none hover:bg-secondary-background focus-visible:ring-2 focus-visible:ring-border-focus"
          @click.stop="openDeploy({ kind: 'app', name: a.name, thumbId: a.thumbId })"
        >
          <DeployedTo kind="app" :name="a.name" />
        </button>
        <span class="text-right text-ui text-subtle-foreground tabular-nums">{{
          a.runs.toLocaleString('en-US')
        }}</span>
        <span class="flex justify-end gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open in new window"
            @click.stop="toast(`Open ${a.name} ↗`)"
            ><ArrowUpRight :size="14"
          /></Button>
          <DropdownMenuRoot :modal="false">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon-sm" :aria-label="`${a.name} options`" @click.stop
                ><EllipsisVertical :size="14"
              /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="min-w-44">
              <DropdownMenuItem @select="toast('Share…')">Share…</DropdownMenuItem>
              <DropdownMenuItem @select="toast('Open the workflow')"
                >Edit workflow</DropdownMenuItem
              >
              <DropdownMenuItem
                v-if="proto.spaces"
                @select="openDeploy({ kind: 'app', name: a.name, thumbId: a.thumbId })"
                ><Rocket :size="14" />Deploy…</DropdownMenuItem
              >
            </DropdownMenuContent>
          </DropdownMenuRoot>
        </span>
      </div>
    </Card>
  </div>
</template>
