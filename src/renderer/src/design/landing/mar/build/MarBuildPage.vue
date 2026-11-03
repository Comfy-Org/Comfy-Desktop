<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Cloud,
  CloudUpload,
  Folder,
  Laptop,
  Rocket,
  Save,
  Settings2,
  Square,
  Workflow
} from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import Sparkline from '../../ui/Sparkline.vue'
import StatusDot from '../../ui/StatusDot.vue'
import AssetsPage from '../../pages/AssetsPage.vue'
import ProjectWorkflows from '../../pages/project/ProjectWorkflows.vue'
import InstanceGlyph from '../../parts/InstanceGlyph.vue'
import WorkflowCard from '../../parts/WorkflowCard.vue'
import EnvLaunchButton from '../../parts/env/EnvLaunchButton.vue'
import StatTile from '../../parts/env/StatTile.vue'
import {
  deploymentsOf,
  envKind,
  envStatus,
  fmt,
  fmtCompact,
  fmtGpu,
  isPublished,
  runsOn,
  statsOf,
  versionsOf
} from '../../parts/env/env'
import { allWorkflows } from '../../gallery'
import { deployEnv, go, goIn, proto, toast, type Page } from '../../useProto'
import { can } from '../../milestones'
import { PROJECTS, type ProtoInstance } from '../../mock'
import MarEntityHeader from '../pages/MarEntityHeader.vue'
import MarEmpty from '../pages/MarEmpty.vue'
import MarItemMenu from '../pages/MarItemMenu.vue'
import MarSeg from '../pages/MarSeg.vue'
import MarStatus, { type ItemStatus } from '../pages/MarStatus.vue'
import type { MenuLine } from '../pages/menu'
import { marTabsOn } from '../shell/titleTabs'
import EnvModels from './EnvModelsEntry.vue'
import '../table/table.css'

/**
 * A build's page, Proposed navigation (mar/build/buildNav.ts). One place
 * says where you are: the title bar's breadcrumb (Home › Builds › this
 * build), so there is no back link here - only when Mar's tabs title bar
 * has no breadcrumb. The header is one row: the build's mark, name and
 * state, then one quiet meta line (what it is, where it runs, who uses
 * it); its deployments link to their tab. Below it, one tab group, each
 * tab with content or an empty state, and the tab's own action on the
 * same row. Versions and deployments are tables in the one table
 * pattern (mar/table/table.css).
 */
const { env } = defineProps<{ env: ProtoInstance }>()

type Tab = 'overview' | 'versions' | 'deployments' | 'workflows' | 'assets' | 'contents'

const k = computed(() => envKind(env))
const st = computed(() => envStatus(env))
const s = computed(() => statsOf(env))
const versions = computed(() => versionsOf(env))
const deps = computed(() => deploymentsOf(env.id))
const wfs = computed(() => allWorkflows.value.filter((w) => w.envId === env.id))
const recent = computed(() => [...wfs.value].sort((a, b) => a.age - b.age).slice(0, 4))
const usedBy = computed(() => (proto.projects ? PROJECTS.filter((p) => p.envId === env.id) : []))

// Versions and deployments are a build's own (not a managed one's);
// a build that already serves deployments always lists them.
const hasVersions = computed(() => k.value !== 'managed')
const hasDeployments = computed(
  () => deps.value.length > 0 || (can.value.builder && proto.signedIn && k.value !== 'managed')
)
const TABS = computed(() => [
  { value: 'overview' as Tab, label: 'Overview' },
  ...(hasVersions.value
    ? [{ value: 'versions' as Tab, label: 'Versions', count: versions.value.length }]
    : []),
  ...(hasDeployments.value
    ? [{ value: 'deployments' as Tab, label: 'Deployments', count: deps.value.length }]
    : []),
  { value: 'workflows' as Tab, label: 'Workflows', count: wfs.value.length },
  { value: 'assets' as Tab, label: 'Assets' },
  { value: 'contents' as Tab, label: 'Models & nodes' }
])
// Build opens on Versions where there are any; everything else on Overview.
const tab = ref<Tab>(proto.mode === 'build' && hasVersions.value ? 'versions' : 'overview')

const status = computed<{ id: ItemStatus; label: string }>(() => {
  if (k.value === 'managed')
    return st.value.live
      ? { id: 'live', label: st.value.label }
      : { id: 'stopped', label: st.value.label }
  if (env.state === 'running') return { id: 'running', label: 'Running' }
  if (env.state === 'update') return { id: 'update', label: 'Update available' }
  return { id: 'stopped', label: st.value.label }
})

// Where it runs, inline in the meta line; deployments open their tab.
const where = computed(() =>
  runsOn(env).filter((r) => r.where !== 'deployments' || can.value.builder)
)
const ICON = { computer: Laptop, cloud: Cloud, deployments: Rocket }

const lines = computed<MenuLine[]>(() => [
  ...(can.value.builder && k.value === 'local'
    ? [
        isPublished(env)
          ? {
              label: 'Update cloud from this computer',
              icon: Cloud,
              run: () => toast('Updating the cloud from this computer…')
            }
          : {
              label: 'Publish to the cloud',
              icon: CloudUpload,
              run: () => toast('Publishing to the cloud…')
            },
        'sep' as const
      ]
    : []),
  { label: 'Settings', icon: Settings2, run: () => toast('Build settings') }
])

const saveVersion = (): void => toast(`Saved ${env.name} v${versions.value.length + 1}`)
</script>

<template>
  <div class="mar-bp mx-auto w-full max-w-300 px-10 pb-24" :class="!marTabsOn && 'is-trail'">
    <MarEntityHeader
      :back="marTabsOn ? 'Builds' : undefined"
      :title="env.name"
      :status="status.id"
      :status-label="status.label"
      @back="go('environments' as Page)"
    >
      <template #cover>
        <span class="mar-bp-glyph"><InstanceGlyph :inst="env" size="lg" /></span>
      </template>
      <template #meta>
        <template v-if="k === 'managed'">
          <span>Managed by Comfy</span>
        </template>
        <Badge v-else-if="versions[0]" size="sm">{{ versions[0].label }}</Badge>
        <template v-for="r in where" :key="r.where">
          <span class="mar-eh-dot" />
          <button
            v-if="r.where === 'deployments'"
            type="button"
            class="mar-eh-link"
            @click="tab = 'deployments'"
          >
            <Rocket :size="13" />{{ r.label }}<StatusDot v-if="r.live" status="running" />
          </button>
          <span v-else class="inline-flex items-center gap-1.5">
            <component :is="ICON[r.where]" :size="13" />{{ r.label
            }}<StatusDot v-if="r.live" status="running" />
          </span>
        </template>
        <template v-for="p in usedBy" :key="p.id">
          <span class="mar-eh-dot" />
          <button type="button" class="mar-eh-link" @click="go(`project:${p.id}` as Page)">
            <Folder :size="13" />Used by {{ p.name }}
          </button>
        </template>
      </template>
      <template #actions>
        <Button
          v-if="k === 'local' && env.state === 'running'"
          @click="toast(`Stopping ${env.name}…`)"
          ><Square :size="12" />Stop</Button
        >
        <Button v-if="can.builder && k !== 'managed' && proto.signedIn" @click="deployEnv(env.id)"
          ><Rocket :size="14" />Deploy as API</Button
        >
        <EnvLaunchButton :env />
        <MarItemMenu v-if="k !== 'managed'" :lines label="Build actions" />
      </template>
    </MarEntityHeader>

    <!-- One row: the sections left, the open section's action right. -->
    <div class="mar-bp-row">
      <MarSeg v-model="tab" :options="TABS" label="In this build" />
      <Button v-if="tab === 'versions' && versions.length" class="ml-auto" @click="saveVersion"
        ><Save :size="13" />Save a version</Button
      >
    </div>

    <template v-if="tab === 'overview'">
      <Card class="grid grid-cols-4 divide-x divide-border-default">
        <StatTile label="Runs · 7 days" :value="fmt(s.runs7d)"
          ><Sparkline :values="s.trend"
        /></StatTile>
        <StatTile label="GPU time · 7 days" :value="fmtGpu(s.gpuMin7d)" :hint="env.gpu" />
        <StatTile
          v-if="k === 'local'"
          label="On disk"
          :value="`${s.storageGb} GB`"
          hint="412 GB free"
        />
        <StatTile
          v-else
          label="Credits · 7 days"
          :value="fmt(s.spend7d)"
          hint="Sessions on Comfy Cloud"
        />
        <StatTile
          label="API requests · 7 days"
          :value="deps.length ? fmtCompact(deps.reduce((n, d) => n + d.requests7d, 0)) : '—'"
          :hint="
            deps.length ? `${deps.length} deployment${deps.length > 1 ? 's' : ''}` : 'Not deployed'
          "
        />
      </Card>
      <SectionHeader
        title="Recent workflows"
        class="mt-7"
        :link="wfs.length > recent.length ? 'See all' : undefined"
        @link="tab = 'workflows'"
      />
      <div
        v-if="recent.length"
        class="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5"
      >
        <WorkflowCard v-for="w in recent" :key="w.id" :wf="w" />
      </div>
      <MarEmpty
        v-else
        compact
        :icon="Workflow"
        title="No workflows here yet"
        text="Workflows you save while this build runs show up here."
      />
    </template>

    <!-- Versions: frozen snapshots; published ones can be deployed -->
    <template v-else-if="tab === 'versions'">
      <div
        v-if="versions.length"
        class="mar-table"
        role="table"
        aria-label="Versions"
        style="--mar-grid: 48px minmax(0, 1fr) 140px 96px"
      >
        <div class="mar-table-head" role="row">
          <span role="columnheader" style="grid-column: span 2">Version</span>
          <span role="columnheader">Where</span>
          <span role="columnheader" class="is-end" />
        </div>
        <div v-for="(v, i) in versions" :key="v.id" role="row" class="mar-table-row cursor-default">
          <span class="mar-table-cell" role="cell"
            ><span class="mar-tag">{{ v.label }}</span></span
          >
          <span class="mar-table-name" role="cell">
            <span class="mar-table-title">{{ v.note }}</span>
            <span class="mar-table-sub"
              >{{ v.when }}<template v-if="i === 0"> · current</template
              ><template v-if="deps.some((d) => d.version === v.id)">
                · deployed to
                {{
                  deps
                    .filter((d) => d.version === v.id)
                    .map((d) => d.name)
                    .join(', ')
                }}</template
              ></span
            >
          </span>
          <span class="mar-table-cell" :class="!v.published && 'is-quiet'" role="cell">{{
            v.published ? 'In the cloud' : 'This computer only'
          }}</span>
          <span class="mar-table-cell is-end is-center" role="cell">
            <Button v-if="proto.signedIn" variant="ghost" size="sm" @click="deployEnv(env.id)"
              ><Rocket :size="13" />Deploy</Button
            >
          </span>
        </div>
      </div>
      <MarEmpty
        v-else
        compact
        :icon="Save"
        title="No versions yet"
        :text="
          k === 'local'
            ? 'A version is a snapshot of this computer’s setup. Publish one to run it in the cloud.'
            : 'Each version is a frozen copy you can deploy.'
        "
        action="Save a version"
        @action="saveVersion"
      />
    </template>

    <!-- Deployments of this build -->
    <template v-else-if="tab === 'deployments'">
      <div
        v-if="deps.length"
        class="mar-table"
        role="table"
        aria-label="Deployments"
        style="--mar-grid: minmax(0, 1fr) 72px 140px 132px 96px"
      >
        <div class="mar-table-head" role="row">
          <span role="columnheader">Deployment</span>
          <span role="columnheader">Version</span>
          <span role="columnheader">GPU</span>
          <span role="columnheader">Status</span>
          <span role="columnheader" class="is-num">Requests · 7d</span>
        </div>
        <div
          v-for="d in deps"
          :key="d.id"
          role="row"
          tabindex="0"
          class="mar-table-row"
          @click="goIn('build', `deployment:${d.id}`)"
          @keydown.enter="goIn('build', `deployment:${d.id}`)"
        >
          <span class="mar-table-name" role="cell">
            <span class="mar-table-title font-mono">{{ d.name }}</span>
            <span class="mar-table-sub">{{ d.stage }}</span>
          </span>
          <span class="mar-table-cell" role="cell">{{ d.version }}</span>
          <span class="mar-table-cell" role="cell">{{ d.gpu }}</span>
          <span class="mar-table-cell" role="cell">
            <MarStatus
              :status="d.status === 'running' ? 'running' : 'stopped'"
              :label="d.status === 'running' ? 'Running' : 'Scaled to zero'"
            />
          </span>
          <span class="mar-table-cell is-num" role="cell">{{ fmtCompact(d.requests7d) }}</span>
        </div>
      </div>
      <MarEmpty
        v-else
        compact
        :icon="Rocket"
        title="Not deployed"
        text="Run a version behind an API endpoint that scales with traffic."
        action="Deploy as API"
        @action="deployEnv(env.id)"
      />
    </template>

    <ProjectWorkflows v-else-if="tab === 'workflows'" :scope="env" />
    <AssetsPage v-else-if="tab === 'assets'" :scope="env" embedded />
    <EnvModels v-else :env />
  </div>
</template>

<style>
/* The title bar says where the page sits: the header starts the page. */
.mar-bp.is-trail {
  padding-top: 24px;
}
.mar-bp-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
.mar-bp-glyph > * {
  width: auto !important;
  height: auto !important;
}
.mar-bp-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
</style>
