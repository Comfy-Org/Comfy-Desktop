<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  Camera,
  Ellipsis,
  CircleStop,
  Cloud,
  CloudUpload,
  CopyPlus,
  Download,
  EyeOff,
  Folder,
  FolderOpen,
  Laptop,
  Pencil,
  Play,
  Rocket,
  RotateCcw,
  RotateCw,
  Save,
  ScrollText,
  Server,
  Settings2,
  Square,
  SquareArrowOutUpRight,
  Trash2,
  Upload,
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
import { deployEnv, go, goIn, hostActions, proto, toast, type Page } from '../../useProto'
import { can } from '../../milestones'
import { buildsAsM1 } from './buildsAsM1'
import { PROJECTS, type ProtoInstance } from '../../mock'
import MarEntityHeader from '../pages/MarEntityHeader.vue'
import MarEmpty from '../pages/MarEmpty.vue'
import MarItemMenu from '../pages/MarItemMenu.vue'
import MarSeg from '../pages/MarSeg.vue'
import MarStatus, { type ItemStatus } from '../pages/MarStatus.vue'
import { notify } from '../pages/undo'
import type { MenuLine } from '../pages/menu'
import { marTabsOn } from '../shell/titleTabs'
import EnvModels from './EnvModelsEntry.vue'
import BuildAbout from './BuildAbout.vue'
import BuildArgs from './BuildArgs.vue'
import BuildOp from './BuildOp.vue'
import BuildOverviewCards from './BuildOverviewCards.vue'
import BuildUpdating from './BuildUpdating.vue'
import BuildStorage from './BuildStorage.vue'
import BuildTerminal from './BuildTerminal.vue'
import { opOf } from './buildOps'
import { runs } from './homeRun'
import { extraOf, isRemote } from './m1Builds'
import BuildSettings from './BuildSettings.vue'
import BuildSnapshots from './BuildSnapshots.vue'
import BuildUpdate from './BuildUpdate.vue'
import BuildUpdateSummary from './BuildUpdateSummary.vue'
import { createSnapshot, leaving, pendingOf, snapshotsOf, stateOf } from './buildFacts'
import { buildPage } from './buildPage'
import { desktopTabs, nextBuildTab, openBuildSettings, tabOf } from './buildTab'
import { syncing } from './syncPrevious'
import { clearError, errorOf } from './buildErrors'
import '../table/table.css'

/**
 * A build's page (mar/build/buildNav.ts). One place
 * says where you are: the title bar's breadcrumb (Home › Builds › this
 * build), so there is no back link here - only when Mar's tabs title bar
 * has no breadcrumb. The header is one row: the build's mark, name and
 * state, then one quiet meta line (what it is, where it runs, who uses
 * it); its deployments link to their tab. Below it, one tab group, each
 * tab with content or an empty state, and the tab's own action on the
 * same row. Versions and deployments are tables in the one table
 * pattern (mar/table/table.css).
 *
 * The Builds milestone (before the breadcrumb) is Desktop's build page
 * (components/settings/ComfyUISettingsContent.vue on bl/desktop-as-a-
 * platform): a "← Builds" link, the header's one button (Start, Restart,
 * Restart to apply changes, Open Cloud, Open Remote) with Window options
 * in its caret and More beside it; then Desktop's tabs - Update, Startup
 * Args, Snapshots, Storage, Terminal, About (Cloud: Storage and About;
 * Remote: About). Update carries a dot while one is waiting. Long work
 * runs inside the tab (buildOps.ts). UI Playground › Build page keeps
 * Overview first as the alternative.
 *
 * Past that milestone, UI Playground › Sync with previous versions keeps
 * Desktop's tabs on a Settings page of their own (MarBuildSettingsPage):
 * More's Settings opens it, and the Update chip opens it on Update.
 */
const { env } = defineProps<{ env: ProtoInstance }>()

type Tab =
  | 'overview'
  | 'versions'
  | 'deployments'
  | 'workflows'
  | 'assets'
  | 'contents'
  | 'about'
  | 'update'
  | 'snapshots'
  | 'settings'
  | 'args'
  | 'storage'
  | 'terminal'

// The Builds milestone: production's tabs (or Overview first).
const mvp = computed(() => buildsAsM1.value)
const state = stateOf(env)
const snaps = snapshotsOf(env)
const pending = computed(() => pendingOf(env))

const k = computed(() => envKind(env))
const st = computed(() => envStatus(env))
const s = computed(() => statsOf(env))
const versions = computed(() => versionsOf(env))
// Deployments come with the Builder (Milestone 6).
const deps = computed(() => (can.value.builder ? deploymentsOf(env.id) : []))
const wfs = computed(() => allWorkflows.value.filter((w) => w.envId === env.id))
const recent = computed(() => [...wfs.value].sort((a, b) => a.age - b.age).slice(0, 4))
const usedBy = computed(() => (proto.projects ? PROJECTS.filter((p) => p.envId === env.id) : []))

// Versions and deployments are a build's own (not a managed one's);
// a build that already serves deployments always lists them.
const hasVersions = computed(() => k.value !== 'managed')
const hasDeployments = computed(
  () => deps.value.length > 0 || (can.value.builder && proto.signedIn && k.value !== 'managed')
)
const own = computed(() => k.value === 'local')
const remote = isRemote(env)
const remoteUrl = computed(() => extraOf(env.id).remote?.replace(/^https?:\/\//, ''))
const DESKTOP_TABS = computed<{ value: Tab; label: string; dot?: boolean }[]>(() =>
  desktopTabs(own.value, remote, Boolean(pending.value))
)
const MVP_TABS = computed<{ value: Tab; label: string; count?: number; dot?: boolean }[]>(() =>
  buildPage.id === 'production'
    ? DESKTOP_TABS.value
    : buildPage.id === 'overview'
      ? [
          { value: 'overview', label: 'Overview' },
          ...(own.value
            ? [
                { value: 'snapshots' as Tab, label: 'Snapshots', count: snaps.length },
                { value: 'settings' as Tab, label: 'Settings' }
              ]
            : [])
        ]
      : [
          { value: 'about', label: 'About' },
          ...(own.value
            ? [
                { value: 'update' as Tab, label: 'Update' },
                { value: 'snapshots' as Tab, label: 'Snapshots', count: snaps.length },
                { value: 'settings' as Tab, label: 'Settings' }
              ]
            : [])
        ]
)
const LATER_TABS = computed(() => [
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
const TABS = computed(() => (mvp.value ? MVP_TABS.value : LATER_TABS.value))
// A tab asked for (Builds' ⋯ menu), else Build opens on Versions where
// there are any; everything else on its first tab.
// Desktop's tabs have no Settings: there, its settings are Startup Args.
const asked =
  nextBuildTab.value === 'settings' && !TABS.value.some((t) => t.value === 'settings')
    ? 'args'
    : tabOf(nextBuildTab.value)
nextBuildTab.value = ''
const tab = ref<Tab>(
  asked && TABS.value.some((t) => t.value === asked)
    ? asked
    : !mvp.value && proto.mode === 'build' && hasVersions.value
      ? 'versions'
      : TABS.value[0]!.value
)
// Switching Build page in the UI Playground lands on a tab that exists.
watch(TABS, (list) => {
  if (!list.some((t) => t.value === tab.value)) tab.value = list[0]!.value
})

// Didn't start: the header's chip is the one red signal; the strip under
// it says why and offers the way out.
const error = computed(() => errorOf(env.id))
function retry(): void {
  clearError(env.id)
  toast(`Starting ${env.name}…`)
}

const status = computed<{ id: ItemStatus; label: string }>(() => {
  if (error.value) return { id: 'failed', label: mvp.value ? 'Error' : 'Failed to start' }
  if (remote)
    return state.run === 'running'
      ? { id: 'running', label: 'Running' }
      : { id: 'stopped', label: 'Stopped' }
  if (k.value === 'managed')
    return st.value.live
      ? { id: 'live', label: st.value.label }
      : { id: 'stopped', label: st.value.label }
  if ((mvp.value ? state.run : env.state) === 'running') return { id: 'running', label: 'Running' }
  if (mvp.value ? pending.value : env.state === 'update')
    return { id: 'update', label: 'Update available' }
  return { id: 'stopped', label: mvp.value ? 'Stopped' : st.value.label }
})

// Where it runs, inline in the meta line; deployments open their tab.
const where = computed(() =>
  remote ? [] : runsOn(env).filter((r) => r.where !== 'deployments' || can.value.builder)
)
const ICON = { computer: Laptop, cloud: Cloud, deployments: Rocket }

/* ---- The Builds milestone's header: Desktop's button, caret and More ---- */
const op = computed(() => opOf(env.id))
const running = computed(() => state.run === 'running')
function startHere(): void {
  state.run = 'launching'
  setTimeout(() => (state.run = 'running'), 1400)
}
function stopHere(): void {
  toast(`Stopping ${state.name}…`)
  setTimeout(() => {
    state.run = 'stopped'
    notify(`Stopped ${state.name}`, () => (state.run = 'running'))
  }, 1200)
}
function duplicateHere(): void {
  toast(`Duplicating ${env.name}…`)
  setTimeout(() => notify(`Duplicated ${env.name}`), 1600)
}
// The Builds list removes it on arrival; leaving says it all, no toast.
function leaveHere(): void {
  leaving.value = env.id
  go('environments' as Page)
}
function restartHere(): void {
  state.restart = false
  toast(`Restarting ${env.name}…`)
}
// Comfy-Desktop#2215: a running build reads Open (its window comes to
// the front), the same word as Home's cards; one button, no caret.
// Stop lives in More only, in its danger group beside Forget and
// Uninstall, as in Home's build menu.
const main = computed<{ label: string; icon: unknown; run: () => void }>(() => {
  if (remote) return { label: 'Open Remote', icon: Server, run: () => toast(`Opening ${env.name}`) }
  if (k.value !== 'local')
    return { label: 'Open Cloud', icon: Cloud, run: () => toast('Opening Comfy Cloud') }
  if (running.value)
    return state.restart
      ? { label: 'Restart to apply changes', icon: RotateCcw, run: restartHere }
      : { label: 'Open', icon: SquareArrowOutUpRight, run: () => hostActions.launch(env) }
  return { label: 'Start', icon: Play, run: startHere }
})
// An update running on the build (homeRun.ts) takes the tabs' place.
const updating = computed(() => runs.get(env.id)?.kind === 'update')
// Rename in the title, as Desktop does (the About tab is gone).
const renaming = ref(false)
const draft = ref('')
const nameField = ref<HTMLInputElement>()
async function rename(): Promise<void> {
  draft.value = state.name
  renaming.value = true
  await nextTick()
  nameField.value?.select()
}
function saveName(): void {
  const v = draft.value.trim()
  if (renaming.value && v) state.name = v
  renaming.value = false
}
// More: Desktop's order (updateSections.ts and pinBottomActions): the
// build's own actions, then Stop while it runs, Forget, Uninstall.
const gate = computed(() => ({
  disabled: running.value,
  title: running.value ? 'Stop the running build first.' : undefined
}))
const moreLines = computed<MenuLine[]>(() => [
  { label: 'Rename', icon: Pencil, run: rename },
  ...(own.value
    ? [
        { label: 'Duplicate', icon: CopyPlus, ...gate.value, run: duplicateHere },
        { label: 'Open Directory', icon: FolderOpen, run: () => toast(`Opened ${env.name}`) },
        { label: 'Export snapshot', icon: Download, run: () => toast('Snapshot exported') }
      ]
    : []),
  'sep',
  ...(own.value && running.value
    ? [{ label: 'Stop', icon: CircleStop, danger: true, run: stopHere }]
    : []),
  { label: 'Forget', icon: EyeOff, run: leaveHere },
  ...(own.value
    ? [{ label: 'Uninstall', icon: Trash2, danger: true, ...gate.value, run: leaveHere }]
    : [])
])

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
  {
    label: 'Settings',
    icon: Settings2,
    run: () =>
      syncing.value
        ? openBuildSettings(env.id)
        : mvp.value && own.value
          ? (tab.value = 'settings')
          : toast('Build settings')
  }
])

const saveVersion = (): void => toast(`Saved ${env.name} v${versions.value.length + 1}`)
</script>

<template>
  <div class="mar-bp mx-auto w-full max-w-440 px-11 pb-24">
    <MarEntityHeader
      :back="marTabsOn && !mvp ? 'Builds' : undefined"
      :title="mvp ? state.name : env.name"
      :status="status.id"
      :status-label="status.label"
      :status-link="syncing && status.id === 'update' && !remote ? 'Open Overview' : undefined"
      @back="go('environments' as Page)"
      @status="openBuildSettings(env.id, 'update')"
    >
      <template v-if="renaming" #title>
        <input
          ref="nameField"
          v-model="draft"
          class="mar-bp-rename"
          aria-label="Build name"
          @keydown.enter="saveName"
          @keydown.esc="renaming = false"
          @blur="saveName"
        />
      </template>
      <template #cover>
        <span class="mar-bp-glyph"
          ><Server v-if="remote" :size="26" class="text-muted-foreground" /><InstanceGlyph
            v-else
            :inst="env"
            size="lg"
        /></span>
      </template>
      <template #meta>
        <template v-if="remote">
          <Server :size="13" /><span class="font-mono">{{ remoteUrl }}</span>
        </template>
        <template v-else-if="k === 'managed'">
          <span>Managed by Comfy</span>
        </template>
        <Badge v-else-if="mvp" size="sm">{{ state.version }}</Badge>
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
      <template v-if="mvp && buildPage.id === 'production'" #actions>
        <Button
          variant="primary"
          :disabled="state.run === 'launching' || op?.status === 'running' || updating"
          @click="main.run()"
          ><component :is="main.icon" :size="15" />{{
            state.run === 'launching' ? 'Starting…' : main.label
          }}</Button
        >
        <MarItemMenu v-if="k !== 'managed' || remote" :lines="moreLines" label="More">
          <template #trigger>
            <Button variant="secondary" size="icon" aria-label="More"
              ><Ellipsis :size="16"
            /></Button>
          </template>
        </MarItemMenu>
      </template>
      <template v-else #actions>
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

    <div v-if="error && !mvp" class="mar-bp-alert" role="alert">
      <div class="min-w-0 flex-1">
        <p class="mar-bp-alert-title">{{ env.name }} didn’t start</p>
        <p class="mar-bp-alert-text">{{ error }}</p>
      </div>
      <Button variant="ghost" size="sm" @click="toast('Opening the logs')"
        ><ScrollText :size="13" />Show logs</Button
      >
      <Button size="sm" @click="retry"><RotateCw :size="13" />Try again</Button>
    </div>

    <!-- One row: the sections left, the open section's action right. -->
    <div class="mar-bp-row">
      <MarSeg v-if="TABS.length > 1" v-model="tab" :options="TABS" label="In this build" />
      <Button v-if="tab === 'versions' && versions.length" class="ml-auto" @click="saveVersion"
        ><Save :size="13" />Save a version</Button
      >
      <div v-if="tab === 'snapshots' && !mvp" class="ml-auto flex items-center gap-2">
        <Button variant="ghost" @click="toast('Choose a snapshot file to import')"
          ><Upload :size="13" />Import</Button
        >
        <Button v-if="snaps.length" variant="ghost" @click="toast('Snapshots exported.')"
          ><Download :size="13" />Export All</Button
        >
        <Button @click="createSnapshot(env)"><Camera :size="13" />Create Snapshot</Button>
      </div>
    </div>

    <!-- The Builds milestone: production's tabs, or Overview first. -->
    <template v-if="mvp">
      <!-- A long operation takes the tab's place until it settles. -->
      <BuildUpdating v-if="updating" :env />
      <BuildOp v-else-if="op" :id="env.id" :op :name="env.name" />
      <BuildOverviewCards
        v-else-if="tab === 'overview' && buildPage.id === 'production' && own"
        :env
      />
      <template v-else-if="tab === 'overview'">
        <BuildUpdateSummary v-if="own" :env />
        <BuildAbout :env />
      </template>
      <BuildAbout v-else-if="tab === 'about'" :env />
      <BuildUpdate v-else-if="tab === 'update'" :env />
      <BuildSnapshots v-else-if="tab === 'snapshots'" :env />
      <BuildSettings v-else-if="tab === 'settings'" :env />
      <BuildArgs v-else-if="tab === 'args'" :env />
      <BuildStorage v-else-if="tab === 'storage'" :env />
      <BuildTerminal v-else-if="tab === 'terminal'" :env />
    </template>

    <template v-else-if="tab === 'overview'">
      <Card
        class="grid divide-x divide-border-default"
        :class="can.builder ? 'grid-cols-4' : 'grid-cols-3'"
      >
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
          v-if="can.builder"
          label="API requests · 7 days"
          :value="deps.length ? fmtCompact(deps.reduce((n, d) => n + d.requests7d, 0)) : '—'"
          :hint="
            deps.length ? `${deps.length} deployment${deps.length > 1 ? 's' : ''}` : 'Not deployed'
          "
        />
      </Card>
      <SectionHeader
        title="Recent workflows"
        class="mar-sec mt-7"
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
            <Button
              v-if="can.builder && proto.signedIn"
              variant="ghost"
              size="sm"
              @click="deployEnv(env.id)"
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
            : 'Each version is a frozen copy of this build.'
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
.mar-bp-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -4px 0 20px;
  padding: 12px 12px 12px 16px;
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mar-bp-alert-title {
  margin: 0;
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 600;
}
.mar-bp-alert-text {
  margin: 2px 0 0;
  color: var(--color-muted-foreground);
  font-size: 13px;
}
.mar-bp-rename {
  min-width: 0;
  width: min(100%, 28rem);
  padding: 0 6px;
  margin-left: -6px;
  border: 0;
  border-radius: var(--radius-control);
  outline: none;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
  font: inherit;
  font-size: var(--text-display, 28px);
  font-weight: 600;
}
.mar-bp-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
</style>
