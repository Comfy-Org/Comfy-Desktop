<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUpRight, Globe, Link2, Lock, Plus, Sparkles, Users, Waypoints } from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Badge from '../ui/Badge.vue'
import Button from '../ui/Button.vue'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../ui/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../ui/DropdownMenuSeparator.vue'
import PageHeader from '../ui/PageHeader.vue'
import SearchInput from '../ui/SearchInput.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import { cn } from '../ui/cn'
import { thumb } from '../mock'
import { goIn } from '../useProto'
import {
  accessKey,
  accessLabel,
  LIB,
  openApp,
  openAppUrl,
  payerLabel,
  resetFlow,
  SOURCES,
  startFrom,
  type AccessKey
} from '../appFlow'

/**
 * Concept A: Apps is a library, like Workflows and Assets. It lists every
 * app you can use, not only your own files: Yours, your team's, and apps
 * other people shared with you. Each row says who can use it and who pays.
 */
// Two groups only: apps you made, and apps other people shared with you
// (teammates or other companies).
const tab = ref<'mine' | 'shared'>('mine')
const inTab = (a: { group: string }, t: string): boolean =>
  t === 'mine' ? a.group === 'yours' : a.group !== 'yours'
const q = ref('')
const list = computed(() =>
  LIB.filter((a) => inTab(a, tab.value)).filter((a) =>
    a.name.toLowerCase().includes(q.value.toLowerCase())
  )
)
const count = (t: string): number => LIB.filter((a) => inTab(a, t)).length
const ICON: Record<AccessKey, unknown> = {
  'only-you': Lock,
  team: Users,
  people: Users,
  link: Link2
}
function describe(): void {
  resetFlow()
  goIn('agent', 'agent')
}
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader title="Apps" description="Tools anyone can run from a link. No graph to learn.">
      <template #actions>
        <SearchInput v-model="q" placeholder="Search apps" class="w-56" />
        <DropdownMenuRoot :modal="false">
          <DropdownMenuTrigger as-child>
            <Button variant="primary" size="lg"><Plus :size="15" />New app</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-64">
            <DropdownMenuItem @select="describe"
              ><Sparkles :size="14" />Describe it to Comfy Agent</DropdownMenuItem
            >
            <DropdownMenuSeparator />
            <DropdownMenuLabel>From a workflow</DropdownMenuLabel>
            <DropdownMenuItem v-for="s in SOURCES" :key="s.name" @select="startFrom(s)"
              ><Waypoints :size="14" />{{ s.name }}</DropdownMenuItem
            >
          </DropdownMenuContent>
        </DropdownMenuRoot>
      </template>
    </PageHeader>

    <SegmentedControl
      v-model="tab"
      variant="contained"
      class="mb-6"
      :options="[
        { value: 'mine', label: 'My apps', count: count('mine') },
        { value: 'shared', label: 'Shared with me', count: count('shared') }
      ]"
    />

    <div class="border-t border-border-default">
      <div
        class="grid h-10 grid-cols-[minmax(0,1fr)_180px_140px_70px_112px] items-center gap-6 px-2 text-ui text-subtle-foreground"
      >
        <span>App</span><span>Who can use it</span><span>Who pays</span
        ><span class="text-right">Runs</span><span />
      </div>
      <div
        v-for="(a, i) in list"
        :key="a.id"
        role="button"
        tabindex="0"
        class="row grid w-full grid-cols-[minmax(0,1fr)_180px_140px_70px_112px] items-center gap-6 border-t border-border-default px-2 py-3 text-left outline-none hover:bg-secondary-background/50 focus-visible:bg-secondary-background"
        :style="{ animationDelay: `${i * 40}ms` }"
        @click="openApp(a.id)"
        @keydown.enter="openApp(a.id)"
      >
        <span class="flex min-w-0 items-center gap-4">
          <img
            :src="thumb(a.thumbId)"
            alt=""
            class="aspect-[4/3] w-16 shrink-0 rounded-control border border-border-default object-cover"
          />
          <span class="min-w-0">
            <span class="flex items-center gap-2">
              <span class="truncate text-ui font-medium">{{ a.name }}</span>
              <Badge v-if="a.state === 'draft'">Draft</Badge>
              <Badge v-else-if="a.unpublished" variant="outline">Unpublished changes</Badge>
            </span>
            <span class="block truncate text-ui text-subtle-foreground">{{
              a.group === 'yours' ? a.blurb : `By ${a.owner}`
            }}</span>
          </span>
        </span>
        <span
          :class="
            cn(
              'flex items-center gap-2 text-ui',
              a.state === 'draft' ? 'text-subtle-foreground' : 'text-muted-foreground'
            )
          "
        >
          <component :is="a.state === 'draft' ? Lock : ICON[accessKey(a)]" :size="13" />
          {{ a.state === 'draft' ? 'Not published' : accessLabel(a) }}
        </span>
        <span class="text-ui text-muted-foreground">{{
          a.group === 'yours' ? payerLabel(a) : a.team && !a.link ? 'Team credits' : 'You'
        }}</span>
        <span class="text-right text-ui text-subtle-foreground tabular-nums">{{
          a.runs ? a.runs.toLocaleString('en-US') : '—'
        }}</span>
        <span class="flex justify-end">
          <Button
            v-if="a.state === 'live'"
            variant="primary"
            size="sm"
            @click.stop="openAppUrl(a.id)"
            >Open app<ArrowUpRight :size="12"
          /></Button>
        </span>
      </div>
      <p
        v-if="!list.length"
        class="border-t border-border-default py-16 text-center text-ui text-subtle-foreground"
      >
        <Globe :size="16" class="mx-auto mb-2" />No apps here yet.
      </p>
    </div>
  </div>
</template>

<style scoped>
.row {
  animation: rise 500ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .row {
    animation: none;
  }
}
</style>
