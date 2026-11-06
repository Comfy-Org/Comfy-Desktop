<script setup lang="ts">
import { computed } from 'vue'
import { Folder, Plus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Tooltip from '../../ui/Tooltip.vue'
import { cn } from '../../ui/cn'
import InstanceGlyph from '../InstanceGlyph.vue'
import { envById } from './env'
import { allWorkflows } from '../../gallery'
import { go, hostActions, instances, proto, toast, type Page } from '../../useProto'
import { PROJECTS } from '../../mock'
import { can } from '../../milestones'
import { errorOf } from '../../mar/build/buildErrors'
import MarGroupTitle from '../../mar/shell/MarGroupTitle.vue'

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
        // Nothing links a workflow to its build before the breadcrumb milestone.
        count: can.value.breadcrumb
          ? allWorkflows.value.filter((w) => w.envId === i.id).length
          : undefined,
        live: i.state === 'running',
        failed: errorOf(i.id)
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
      <MarGroupTitle :title="title" :active="overviewActive" @click="go(overviewPage)" />
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
    <!-- None yet (a first-time user): say what goes here. -->
    <p
      v-if="!rows.length"
      class="flex h-8 items-center gap-2.5 px-3 text-ui text-subtle-foreground"
    >
      <Folder :size="15" />{{ proto.projects ? 'Group work by client' : 'No builds yet' }}
    </p>
    <Button
      v-for="r in rows"
      :key="r.page"
      variant="ghost"
      :aria-current="proto.page === r.page ? 'page' : undefined"
      :class="itemClass(r.page)"
      @click="go(r.page)"
    >
      <Folder v-if="proto.projects" :size="15" />
      <!-- Running or didn't start: a dot on the build's mark; the reason on hover. -->
      <Tooltip
        v-else-if="envById(r.envId!) && 'failed' in r && r.failed"
        :content="`Failed to start · ${r.failed}`"
      >
        <span class="inline-flex" aria-label="Failed to start"
          ><InstanceGlyph :inst="envById(r.envId!)!" size="xs" dot failed
        /></span>
      </Tooltip>
      <InstanceGlyph v-else-if="envById(r.envId!)" :inst="envById(r.envId!)!" size="xs" dot />
      <span class="sidebar-label text-left">{{ r.label }}</span>
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
