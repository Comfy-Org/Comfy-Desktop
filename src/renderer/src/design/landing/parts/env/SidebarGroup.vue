<script setup lang="ts">
import { computed } from 'vue'
import { Folder, LayoutGrid, Plus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Tooltip from '../../ui/Tooltip.vue'
import { cn } from '../../ui/cn'
import InstanceGlyph from '../InstanceGlyph.vue'
import { envById } from './env'
import { allWorkflows } from '../../gallery'
import { go, hostActions, instances, proto, toast, type Page } from '../../useProto'
import { PROJECTS } from '../../mock'

/**
 * The organising list under Create.
 *  Projects on:  projects, each bound to one environment (shown on the right).
 *  Projects off: environments themselves - each opens a page with
 *                Workflows, Assets, Models & nodes, Versions… in tabs.
 */
interface Row {
  page: Page
  label: string
  /** Environment shown as the row's mark (off) or its runtime (on). */
  envId?: string
  count?: number
  live?: boolean
}

const rows = computed<Row[]>(() =>
  proto.projects
    ? PROJECTS.filter((p) => envById(p.envId)).map((p) => ({
        page: `project:${p.id}` as Page,
        label: p.name,
        envId: p.envId,
        count: allWorkflows.value.filter((w) => w.project === p.name).length
      }))
    : instances.value.map((i) => ({
        page: `environment:${i.id}` as Page,
        label: i.name,
        envId: i.id,
        count: allWorkflows.value.filter((w) => w.envId === i.id).length,
        live: i.state === 'running'
      }))
)
const show = computed(() => proto.signedIn || instances.value.some((i) => i.kind === 'local'))
const title = computed(() => (proto.projects ? 'Projects' : 'Builds'))
const overviewPage = computed<Page>(() => (proto.projects ? 'projects' : 'environments'))
const overviewActive = computed(() => proto.page === overviewPage.value)
const itemClass = (page: Page): string =>
  cn(
    'h-8 w-full justify-start gap-2.5 px-3 text-ui font-normal',
    proto.page === page && 'bg-secondary-background-hover text-base-foreground'
  )
</script>

<template>
  <div v-if="show" class="mt-5.5 flex shrink-0 flex-col">
    <div class="flex h-6.5 items-center justify-between pr-1 pl-3">
      <span class="text-ui font-medium tracking-wider text-subtle-foreground uppercase">{{
        title
      }}</span>
      <Tooltip :content="proto.projects ? 'New project' : 'New build'">
        <Button
          variant="ghost"
          size="icon-xs"
          :aria-label="proto.projects ? 'New project' : 'New build'"
          @click="
            proto.projects ? toast('New project - pick its build') : hostActions.newInstance()
          "
        >
          <Plus :size="13" />
        </Button>
      </Tooltip>
    </div>
    <!-- Overview of the whole group -->
    <Button
      variant="ghost"
      :aria-current="overviewActive ? 'page' : undefined"
      :class="
        cn(itemClass(overviewPage), !overviewActive && 'bg-transparent text-muted-foreground')
      "
      @click="go(overviewPage)"
    >
      <LayoutGrid :size="15" />
      <span class="sidebar-label text-left">{{
        proto.projects ? 'All projects' : 'All builds'
      }}</span>
      <span class="text-ui text-subtle-foreground tabular-nums">{{ rows.length }}</span>
    </Button>

    <Button
      v-for="r in rows"
      :key="r.page"
      variant="ghost"
      :aria-current="proto.page === r.page ? 'page' : undefined"
      :class="itemClass(r.page)"
      @click="go(r.page)"
    >
      <Folder v-if="proto.projects" :size="15" />
      <InstanceGlyph v-else-if="envById(r.envId!)" :inst="envById(r.envId!)!" size="xs" />
      <span class="sidebar-label text-left">{{ r.label }}</span>
      <span v-if="r.live" class="size-1.5 rounded-full bg-status-running" />
      <!-- Projects: the environment the project runs on -->
      <Tooltip
        v-if="proto.projects && envById(r.envId!)"
        :content="`Runs on ${envById(r.envId!)!.name}`"
      >
        <span class="inline-flex opacity-60"
          ><InstanceGlyph :inst="envById(r.envId!)!" size="xs"
        /></span>
      </Tooltip>
      <span v-else-if="r.count" class="text-ui text-subtle-foreground tabular-nums">{{
        r.count
      }}</span>
    </Button>
  </div>
</template>
