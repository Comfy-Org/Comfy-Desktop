<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowUpCircle,
  Camera,
  CircleCheck,
  Cloud,
  CloudUpload,
  Download,
  Folder,
  FolderOpen,
  Laptop,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Settings2,
  Square,
  Trash2,
  Upload,
  Workflow,
  X
} from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import Input from '../../ui/Input.vue'
import SectionHeader from '../../ui/SectionHeader.vue'
import Select from '../../ui/Select.vue'
import SettingsRow from '../../ui/SettingsRow.vue'
import SettingsSection from '../../ui/SettingsSection.vue'
import Sparkline from '../../ui/Sparkline.vue'
import StatusDot from '../../ui/StatusDot.vue'
import Switch from '../../ui/Switch.vue'
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
import { notify } from '../pages/undo'
import { marTabsOn } from '../shell/titleTabs'
import {
  CHANNELS,
  LAUNCH_MODES,
  LISTEN,
  NETWORK,
  SECURITY,
  factsOf,
  settingsOf
} from './buildFacts'
import { nextBuildTab, type BuildTab } from './buildTab'
import '../table/table.css'

/**
 * A build's page (mar/build/buildNav.ts). One place
 * says where you are: the title bar's breadcrumb (Home › Builds › this
 * build), so there is no back link here - only when Mar's tabs title bar
 * has no breadcrumb. The header is one row: the build's mark, name and
 * state, then one quiet meta line (what it is, where it runs, who uses
 * it); its deployments link to their tab. Below it, one tab group, each
 * tab with content or an empty state, and the tab's own action on the
 * same row:
 *   Overview   whether it's up to date (first), its channel, then the
 *              facts (hardware, Python, PyTorch, where, disk) and use.
 *   Snapshots  ComfyUI-Manager snapshots, a table; Create, Import and
 *              Export all on the tab row. Published ones can be deployed.
 *   Deployments  (Builder) this build behind an API.
 *   Settings   on this computer only: one scrolling page, Startup (args,
 *              launch mode, port, environment variables, Manager), then
 *              Storage (model folders, input and output).
 * Tables use the one table pattern (mar/table/table.css).
 */
const { env } = defineProps<{ env: ProtoInstance }>()

const k = computed(() => envKind(env))
const st = computed(() => envStatus(env))
const s = computed(() => statsOf(env))
// Deployments come with the Builder (Milestone 6).
const deps = computed(() => (can.value.builder ? deploymentsOf(env.id) : []))
const wfs = computed(() => allWorkflows.value.filter((w) => w.envId === env.id))
const recent = computed(() => [...wfs.value].sort((a, b) => a.age - b.age).slice(0, 4))
const usedBy = computed(() => (proto.projects ? PROJECTS.filter((p) => p.envId === env.id) : []))

/* ---- Version and updates ---- */
const facts = factsOf(env)
const current = ref(env.version ?? 'Latest')
const channel = ref(env.deployment ? '' : env.channel)
const updating = ref(false)
// What the build's own snapshot says it runs: shown as the version.
const pending = computed(() =>
  env.state === 'update' && current.value !== facts.latest ? facts.latest : undefined
)
function update(): void {
  updating.value = true
  setTimeout(() => {
    const was = current.value
    current.value = facts.latest
    updating.value = false
    notify(`${env.name} is on ComfyUI ${facts.latest}`, () => (current.value = was))
  }, 1600)
}

/* ---- Snapshots ---- */
// Local snapshots are ComfyUI-Manager's; cloud ones are its releases.
const snaps = ref(versionsOf(env).map((v) => ({ ...v })))
function createSnapshot(): void {
  const n = snaps.value.length + 1
  snaps.value.unshift({
    id: `v${n}`,
    label: `v${n}`,
    note: `ComfyUI ${current.value}, ${env.nodes ?? 0} node packs`,
    when: 'Just now',
    published: false
  })
  toast(`Snapshot v${n} created`)
}
function restore(id: string): void {
  const i = snaps.value.findIndex((v) => v.id === id)
  const v = snaps.value.splice(i, 1)[0]!
  snaps.value.unshift(v)
  notify(`${env.name} restored to ${v.label}`, () => {
    snaps.value.splice(0, 1)
    snaps.value.splice(i, 0, v)
  })
}
function removeSnapshot(id: string): void {
  const i = snaps.value.findIndex((v) => v.id === id)
  const v = snaps.value.splice(i, 1)[0]!
  notify(`Deleted snapshot ${v.label}`, () => snaps.value.splice(i, 0, v))
}
const snapLines = (id: string, current: boolean): MenuLine[] => [
  { label: 'Export', icon: Download, run: () => toast(`Exported ${id}.json`) },
  ...(can.value.builder && proto.signedIn
    ? [{ label: 'Deploy', icon: Rocket, run: () => deployEnv(env.id) }]
    : []),
  'sep',
  {
    label: 'Delete snapshot',
    icon: Trash2,
    danger: true,
    disabled: current,
    run: () => removeSnapshot(id)
  }
]

/* ---- Settings (this computer only) ---- */
const set = settingsOf(env)
// Manager v4: with a non-loopback listen, installing node packs needs
// network mode Personal cloud, at every security level.
const installsBlocked = computed(
  () => set.manager && set.listen === 'network' && set.network !== 'personal_cloud'
)
function addVar(): void {
  set.env.push({ key: '', value: '' })
}
function removeVar(i: number): void {
  const v = set.env.splice(i, 1)[0]!
  if (v.key) notify(`Removed ${v.key}`, () => set.env.splice(i, 0, v))
}
function addFolder(): void {
  set.modelFolders.push({ path: '~/Downloads/models' })
  toast('Added ~/Downloads/models')
}
function removeFolder(i: number): void {
  const f = set.modelFolders.splice(i, 1)[0]!
  notify(`Removed ${f.path}`, () => set.modelFolders.splice(i, 0, f))
}

/* ---- Tabs ---- */
// Snapshots are a build's own (not a managed one's); a build that already
// serves deployments always lists them. Settings live on this computer.
const hasSnapshots = computed(() => k.value !== 'managed')
const hasDeployments = computed(
  () => deps.value.length > 0 || (can.value.builder && proto.signedIn && k.value !== 'managed')
)
const hasSettings = computed(() => k.value === 'local')
const TABS = computed(() => [
  { value: 'overview' as BuildTab, label: 'Overview' },
  ...(hasSnapshots.value
    ? [{ value: 'snapshots' as BuildTab, label: 'Snapshots', count: snaps.value.length }]
    : []),
  ...(hasDeployments.value
    ? [{ value: 'deployments' as BuildTab, label: 'Deployments', count: deps.value.length }]
    : []),
  ...(hasSettings.value ? [{ value: 'settings' as BuildTab, label: 'Settings' }] : [])
])
// A tab asked for (Builds' ⋯ menu), else Build opens on Snapshots where
// there are any, everything else on Overview.
const asked = nextBuildTab.value
nextBuildTab.value = ''
const tab = ref<BuildTab>(
  asked && TABS.value.some((t) => t.value === asked)
    ? asked
    : proto.mode === 'build' && hasSnapshots.value
      ? 'snapshots'
      : 'overview'
)

const status = computed<{ id: ItemStatus; label: string }>(() => {
  if (k.value === 'managed')
    return st.value.live
      ? { id: 'live', label: st.value.label }
      : { id: 'stopped', label: st.value.label }
  if (env.state === 'running') return { id: 'running', label: 'Running' }
  if (pending.value) return { id: 'update', label: 'Update available' }
  return { id: 'stopped', label: env.state === 'update' ? 'Stopped' : st.value.label }
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
  { label: 'Create snapshot', icon: Camera, run: createSnapshot },
  ...(hasSettings.value
    ? [{ label: 'Settings', icon: Settings2, run: () => (tab.value = 'settings') }]
    : [])
])

// The facts, in the order people look for them.
const FACTS = computed(() => [
  { label: 'Hardware', value: env.gpu ?? 'Cloud GPU' },
  { label: 'Python', value: facts.python },
  { label: 'PyTorch', value: facts.torch },
  ...(k.value === 'local'
    ? [
        { label: 'Installed in', value: facts.path, reveal: true },
        { label: 'On disk', value: `${facts.disk} · 412 GB free` }
      ]
    : [{ label: 'Runs on', value: 'Comfy Cloud' }]),
  {
    label: 'Installed',
    value: `${env.nodes ?? 'Core'} node packs · ${env.models ?? 'All'} models`
  }
])

// Cloud builds are the managed one too: Comfy keeps it current.
const managed = computed(() => k.value === 'managed')
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
        <Badge v-else size="sm">{{ current }}</Badge>
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

    <!-- One row: the sections left, the open section's actions right. -->
    <div class="mar-bp-row">
      <MarSeg v-if="TABS.length > 1" v-model="tab" :options="TABS" label="In this build" />
      <div v-if="tab === 'snapshots'" class="ml-auto flex items-center gap-2">
        <Button variant="ghost" @click="toast('Choose a snapshot file to import')"
          ><Upload :size="13" />Import</Button
        >
        <Button
          v-if="snaps.length"
          variant="ghost"
          @click="toast(`Exported ${snaps.length} snapshots`)"
          ><Download :size="13" />Export all</Button
        >
        <Button @click="createSnapshot"><Camera :size="13" />Create snapshot</Button>
      </div>
    </div>

    <!-- Overview: up to date first, then what the build is. -->
    <template v-if="tab === 'overview'">
      <Card class="mar-bp-update" :class="pending && 'is-pending'">
        <span class="mar-bp-update-icon">
          <Loader2 v-if="updating" :size="18" class="animate-spin" />
          <ArrowUpCircle v-else-if="pending" :size="18" />
          <CircleCheck v-else :size="18" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="mar-bp-update-title">
            <template v-if="managed">Always up to date</template>
            <template v-else-if="updating">Updating to {{ facts.latest }}…</template>
            <template v-else-if="pending">ComfyUI {{ pending }} is available</template>
            <template v-else>Up to date</template>
          </p>
          <p class="mar-bp-update-sub">
            <template v-if="managed">Comfy keeps this build on the newest ComfyUI.</template>
            <template v-else-if="pending"
              >You’re on {{ current }}. Your snapshots, models and node packs stay as they
              are.</template
            >
            <template v-else
              >ComfyUI {{ current }}<template v-if="channel"> · {{ channel }}</template> · checked
              {{ facts.checked }}</template
            >
          </p>
        </div>
        <template v-if="!managed">
          <Button v-if="pending" variant="primary" :disabled="updating" @click="update"
            ><ArrowUpCircle :size="14" />Update</Button
          >
          <Button v-else variant="ghost" @click="toast(`${env.name} is up to date`)"
            ><RefreshCw :size="13" />Check now</Button
          >
        </template>
        <div v-if="!managed" class="mar-bp-update-foot">
          <span class="mar-bp-update-label">Update channel</span>
          <Select
            v-if="k === 'local'"
            v-model="channel"
            :options="CHANNELS"
            variant="ghost"
            size="sm"
            class="w-32"
          />
          <span v-else class="mar-bp-update-value">Pinned to its current snapshot</span>
          <span class="mar-bp-update-hint">{{
            channel === 'Nightly'
              ? 'The newest ComfyUI, every day. Things can break.'
              : 'Tested releases, about every two weeks.'
          }}</span>
        </div>
      </Card>

      <h2 class="mar-bp-h2">About this build</h2>
      <Card class="mar-bp-facts">
        <div
          v-for="f in FACTS"
          :key="f.label"
          class="mar-bp-fact"
          :class="'reveal' in f && 'is-wide'"
        >
          <span class="mar-bp-fact-label">{{ f.label }}</span>
          <span class="mar-bp-fact-value">
            <span class="truncate" :class="'reveal' in f && 'font-mono'">{{ f.value }}</span>
            <Button
              v-if="'reveal' in f"
              variant="ghost"
              size="icon-xs"
              aria-label="Show in Finder"
              title="Show in Finder"
              @click="toast(`Revealed ${env.name}`)"
              ><FolderOpen :size="13"
            /></Button>
          </span>
        </div>
      </Card>

      <h2 class="mar-bp-h2">Last 7 days</h2>
      <Card
        class="grid divide-x divide-border-default"
        :class="can.builder ? 'grid-cols-4' : 'grid-cols-3'"
      >
        <StatTile label="Runs" :value="fmt(s.runs7d)"><Sparkline :values="s.trend" /></StatTile>
        <StatTile label="GPU time" :value="fmtGpu(s.gpuMin7d)" :hint="env.gpu" />
        <StatTile
          v-if="k === 'local'"
          label="Outputs saved"
          :value="fmt(Math.round(s.runs7d * 1.6))"
          hint="In the shared output folder"
        />
        <StatTile v-else label="Credits" :value="fmt(s.spend7d)" hint="Sessions on Comfy Cloud" />
        <StatTile
          v-if="can.builder"
          label="API requests"
          :value="deps.length ? fmtCompact(deps.reduce((n, d) => n + d.requests7d, 0)) : '—'"
          :hint="
            deps.length ? `${deps.length} deployment${deps.length > 1 ? 's' : ''}` : 'Not deployed'
          "
        />
      </Card>
      <SectionHeader title="Recent workflows" class="mt-7" />
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

    <!-- Snapshots: frozen copies of the build; published ones can be deployed -->
    <template v-else-if="tab === 'snapshots'">
      <div
        v-if="snaps.length"
        class="mar-table"
        role="table"
        aria-label="Snapshots"
        :style="{
          '--mar-grid': can.builder
            ? '48px minmax(0, 1fr) 120px 140px 132px'
            : '48px minmax(0, 1fr) 120px 132px'
        }"
      >
        <div class="mar-table-head" role="row">
          <span role="columnheader" style="grid-column: span 2">Snapshot</span>
          <span role="columnheader">Created</span>
          <span v-if="can.builder" role="columnheader">Where</span>
          <span role="columnheader" class="is-end" />
        </div>
        <div v-for="(v, i) in snaps" :key="v.id" role="row" class="mar-table-row cursor-default">
          <span class="mar-table-cell" role="cell"
            ><span class="mar-tag">{{ v.label }}</span></span
          >
          <span class="mar-table-name" role="cell">
            <span class="mar-table-title">{{ v.note }}</span>
            <span v-if="i === 0 || deps.some((d) => d.version === v.id)" class="mar-table-sub">{{
              [
                i === 0 ? 'What this build runs now' : '',
                deps.some((d) => d.version === v.id)
                  ? `Deployed to ${deps
                      .filter((d) => d.version === v.id)
                      .map((d) => d.name)
                      .join(', ')}`
                  : ''
              ]
                .filter(Boolean)
                .join(' · ')
            }}</span>
          </span>
          <span class="mar-table-cell" role="cell">{{ v.when }}</span>
          <span
            v-if="can.builder"
            class="mar-table-cell"
            :class="!v.published && 'is-quiet'"
            role="cell"
            >{{ v.published ? 'In the cloud' : 'This computer only' }}</span
          >
          <span class="mar-table-cell is-end is-center mar-bp-snap-acts" role="cell">
            <Button v-if="i > 0" variant="ghost" size="sm" @click="restore(v.id)"
              ><RotateCcw :size="13" />Restore</Button
            >
            <MarItemMenu :lines="snapLines(v.id, i === 0)" :label="`${v.label} actions`" />
          </span>
        </div>
      </div>
      <MarEmpty
        v-else
        compact
        :icon="Camera"
        title="No snapshots yet"
        text="A snapshot keeps this build’s ComfyUI version and node packs, so you can go back to it."
        action="Create snapshot"
        @action="createSnapshot"
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
          <span role="columnheader">Snapshot</span>
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
        text="Run a snapshot behind an API endpoint that scales with traffic."
        action="Deploy as API"
        @action="deployEnv(env.id)"
      />
    </template>

    <!-- Settings: one page, how it starts, then where it keeps things. -->
    <div v-else class="mar-bp-settings">
      <h2 class="mar-bp-h2">Startup</h2>
      <p class="mar-bp-lead">Changes apply the next time {{ env.name }} starts.</p>
      <SettingsSection title="Launch" description="How ComfyUI starts and where it opens.">
        <SettingsRow
          label="Launch arguments"
          hint="Passed to ComfyUI as it starts, for example --lowvram."
        >
          <Input
            v-model="set.args"
            mono
            placeholder="--preview-method auto"
            aria-label="Launch arguments"
          />
        </SettingsRow>
        <SettingsRow label="Opens" layout="inline">
          <Select v-model="set.mode" :options="LAUNCH_MODES" class="w-44" />
        </SettingsRow>
        <SettingsRow label="Port" layout="inline">
          <Input v-model="set.port" mono inputmode="numeric" aria-label="Port" class="w-28" />
        </SettingsRow>
        <SettingsRow
          label="Reachable from"
          layout="inline"
          :hint="
            set.listen === 'network'
              ? `Other devices open it at this computer’s address, port ${set.port}.`
              : undefined
          "
        >
          <Select v-model="set.listen" :options="LISTEN" class="w-44" />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Environment variables"
        description="Set for ComfyUI and its custom nodes, in this build only."
      >
        <div v-for="(v, i) in set.env" :key="i" class="mar-bp-var">
          <Input v-model="v.key" mono placeholder="NAME" aria-label="Variable name" />
          <span class="text-subtle-foreground">=</span>
          <Input v-model="v.value" mono placeholder="value" aria-label="Variable value" />
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="`Remove ${v.key || 'variable'}`"
            @click="removeVar(i)"
            ><X :size="14"
          /></Button>
        </div>
        <div class="px-5 py-3">
          <Button variant="ghost" size="sm" @click="addVar"><Plus :size="13" />Add variable</Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="ComfyUI-Manager"
        description="Installs and updates node packs from inside ComfyUI."
      >
        <SettingsRow label="Enable ComfyUI-Manager" layout="inline">
          <Switch v-model="set.manager" aria-label="Enable ComfyUI-Manager" />
        </SettingsRow>
        <template v-if="set.manager">
          <SettingsRow
            label="Security level"
            layout="inline"
            hint="How risky an install it allows. Weak allows everything."
          >
            <Select v-model="set.security" :options="SECURITY" class="w-36" />
          </SettingsRow>
          <SettingsRow
            label="Network mode"
            layout="inline"
            :hint="
              installsBlocked
                ? 'Installing node packs is blocked while ComfyUI is reachable from your network. Choose Personal cloud to allow it.'
                : undefined
            "
          >
            <Select v-model="set.network" :options="NETWORK" class="w-40" />
          </SettingsRow>
          <SettingsRow label="Allow installs from Git URLs" layout="inline">
            <Switch v-model="set.gitInstall" aria-label="Allow installs from Git URLs" />
          </SettingsRow>
          <SettingsRow label="Allow pip installs" layout="inline">
            <Switch v-model="set.pipInstall" aria-label="Allow pip installs" />
          </SettingsRow>
        </template>
      </SettingsSection>

      <h2 class="mar-bp-h2 mt-10">Storage</h2>
      <p class="mar-bp-lead">Where this build finds models and keeps what it makes.</p>
      <SettingsSection
        title="Model folders"
        description="ComfyUI looks for models in every folder here, in this order."
      >
        <div v-for="(f, i) in set.modelFolders" :key="f.path" class="mar-bp-folder">
          <Folder :size="14" class="shrink-0 text-subtle-foreground" />
          <span class="min-w-0 flex-1 truncate font-mono">{{ f.path }}</span>
          <Badge v-if="f.own" size="sm">This build</Badge>
          <Button
            v-else
            variant="ghost"
            size="icon-sm"
            :aria-label="`Remove ${f.path}`"
            @click="removeFolder(i)"
            ><X :size="14"
          /></Button>
        </div>
        <div class="px-5 py-3">
          <Button variant="ghost" size="sm" @click="addFolder"
            ><Plus :size="13" />Add folder</Button
          >
        </div>
      </SettingsSection>

      <SettingsSection title="Input and output" description="Where images go in and come out.">
        <SettingsRow
          label="Share with every build"
          layout="inline"
          hint="Every build on this computer reads and saves in the same two folders."
        >
          <Switch v-model="set.shared" aria-label="Share input and output with every build" />
        </SettingsRow>
        <SettingsRow label="Input folder" layout="inline">
          <span class="max-w-56 truncate font-mono text-muted-foreground">{{
            set.shared ? set.input : `~/Documents/ComfyUI/${env.name}/input`
          }}</span>
          <Button size="sm" @click="toast('Choose the input folder')">Change</Button>
        </SettingsRow>
        <SettingsRow label="Output folder" layout="inline">
          <span class="max-w-56 truncate font-mono text-muted-foreground">{{
            set.shared ? set.output : `~/Documents/ComfyUI/${env.name}/output`
          }}</span>
          <Button size="sm" @click="toast('Choose the output folder')">Change</Button>
        </SettingsRow>
      </SettingsSection>
    </div>
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
  min-height: 36px;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
.mar-bp-h2 {
  margin: 28px 0 10px;
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 600;
}
.mar-bp-lead {
  margin: -6px 0 0;
  color: var(--color-muted-foreground);
  font-size: 13px;
}
/* Up to date: the first thing on the page. An icon, one line and the
   action, then the channel under a hairline. */
:root .proto-ui.proto-ui.proto-ui .mar-bp-update {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
}
.mar-bp-update-icon {
  display: inline-flex;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-status-running) 14%, transparent);
  color: var(--color-status-running);
}
.mar-bp-update.is-pending .mar-bp-update-icon {
  background: color-mix(in oklch, oklch(0.8 0.15 75) 16%, transparent);
  color: oklch(0.8 0.15 75);
}
.mar-bp-update-title {
  margin: 0;
  color: var(--color-base-foreground);
  font-size: 14px;
  font-weight: 600;
}
.mar-bp-update-sub {
  margin: 2px 0 0;
  color: var(--color-muted-foreground);
  font-size: 13px;
}
.mar-bp-update-foot {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 12px;
  margin-top: 2px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border-default);
  font-size: 13px;
}
.mar-bp-update-label {
  color: var(--color-base-foreground);
  font-weight: 500;
}
.mar-bp-update-value,
.mar-bp-update-hint {
  color: var(--color-muted-foreground);
}
.mar-bp-update-hint {
  margin-left: auto;
  color: var(--color-subtle-foreground);
}
/* The facts: label over value, three across. */
:root .proto-ui.proto-ui.proto-ui .mar-bp-facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 18px 24px;
  padding: 18px 20px;
}
.mar-bp-fact {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.mar-bp-fact.is-wide {
  grid-column: span 2;
}
.mar-bp-fact-label {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.mar-bp-fact-value {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: var(--color-base-foreground);
  font-size: 13px;
}
.mar-bp-snap-acts {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  overflow: visible;
}
.mar-bp-settings > section:first-of-type {
  padding-top: 20px;
}
.mar-bp-var {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 10px 20px;
}
.mar-bp-folder {
  display: flex;
  min-width: 0;
  min-height: 52px;
  align-items: center;
  gap: 10px;
  padding: 8px 12px 8px 20px;
  font-size: 13px;
}
</style>
