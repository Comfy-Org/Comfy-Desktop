<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  AppWindow,
  BookOpen,
  Boxes,
  Compass,
  GraduationCap,
  Home,
  Images,
  KeyRound,
  LayoutDashboard,
  Rocket,
  ScrollText,
  Server,
  SquareArrowOutUpRight,
  Workflow
} from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { cn } from '../../ui/cn'
import { go, proto, toast, type Mode, type Page } from '../../useProto'
import { can } from '../../milestones'

/**
 * Navigation for one lens. Create: make things. Build: ship them as an API.
 * Environments appear in both, framed by the job (where my work runs vs
 * what I release). Admin is not here - it lives in the workspace menu.
 */
const { mode, label, omit = [] } = defineProps<{ mode: Mode; label?: string; omit?: string[] }>()

interface Item {
  page?: Page
  label: string
  icon: Component
  /** Detail pages that keep this item highlighted. */
  prefix?: string
  href?: string
  /** Group heading shown above the first item of a group. */
  section?: string
}
const NAV = computed<Record<Mode, Item[]>>(() => ({
  agent: [],
  // Home from Milestone 4, Explore and Learn from 5; the builds follow in
  // the sidebar group. Projects (Milestone 8) add the libraries, and the
  // builds move here (the sidebar group lists projects instead).
  create: [
    { page: 'overview', label: 'Home', icon: Home },
    ...(can.value.explore
      ? [
          { page: 'explore' as Page, label: 'Explore', icon: Compass },
          { page: 'tutorials' as Page, label: 'Learn', icon: GraduationCap }
        ]
      : []),
    ...(can.value.projects
      ? [
          {
            page: 'workflows' as Page,
            label: 'Workflows',
            icon: Workflow,
            section: 'Libraries'
          },
          { page: 'apps' as Page, label: 'Apps', icon: AppWindow },
          { page: 'assets' as Page, label: 'Assets', icon: Images },
          ...(proto.fresh
            ? []
            : [
                {
                  page: 'environments' as Page,
                  label: 'Builds',
                  icon: Server,
                  prefix: 'environment:'
                }
              ])
        ]
      : [])
  ],
  // New users: only what helps make a first call.
  build: [
    {
      page: 'build-overview',
      label: proto.fresh ? 'Get started' : 'Overview',
      icon: LayoutDashboard
    },
    ...(proto.fresh
      ? []
      : [
          {
            page: 'deployments' as Page,
            label: 'Deployments',
            icon: Rocket,
            prefix: 'deployment:'
          },
          {
            page: 'environments' as Page,
            label: 'Builds',
            icon: Server,
            prefix: 'environment:'
          }
        ]),
    { page: 'router', label: 'Models', icon: Boxes },
    ...(proto.fresh ? [] : [{ page: 'logs' as Page, label: 'Logs', icon: ScrollText }]),
    { page: 'keys', label: 'API keys', icon: KeyRound },
    { label: 'Docs', icon: BookOpen, href: 'docs' }
  ]
}))

// In a workflow (Sidebar navigation) no launcher page is current.
const active = (i: Item): boolean =>
  proto.activeTab === 'home' &&
  Boolean(i.page && (proto.page === i.page || (i.prefix && proto.page.startsWith(i.prefix))))
function open(i: Item): void {
  if (i.href) toast('Opening docs.comfy.org ↗')
  else if (i.page) {
    proto.mode = mode
    go(i.page)
  }
}
</script>

<template>
  <div
    v-if="label"
    class="mt-5 mb-1 px-3 text-ui font-medium tracking-wider text-subtle-foreground uppercase"
  >
    <span>{{ label }}</span>
  </div>
  <nav class="flex flex-col gap-px" :aria-label="mode === 'create' ? 'Create' : 'Build'">
    <template v-for="i in NAV[mode].filter((n) => !omit.includes(n.label))" :key="i.label">
      <div
        v-if="i.section"
        class="mt-5.5 flex h-6.5 items-center px-3 text-ui font-medium tracking-wider text-subtle-foreground uppercase"
      >
        <span>{{ i.section }}</span>
      </div>
      <Button
        variant="ghost"
        :aria-current="active(i) ? 'page' : undefined"
        :class="
          cn(
            'h-8 w-full justify-start gap-2.5 px-3 text-ui font-normal',
            active(i) && 'bg-secondary-background-hover text-base-foreground'
          )
        "
        @click="open(i)"
      >
        <component :is="i.icon" :size="15" />
        <span class="sidebar-label text-left">{{ i.label }}</span>
        <SquareArrowOutUpRight v-if="i.href" :size="12" class="text-subtle-foreground" />
      </Button>
    </template>
  </nav>
</template>
