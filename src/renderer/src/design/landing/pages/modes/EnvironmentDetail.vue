<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ChevronLeft,
  Cloud,
  CloudUpload,
  EllipsisVertical,
  Rocket,
  Save,
  Settings2,
  Square
} from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuSeparator from '../../ui/DropdownMenuSeparator.vue'
import Sparkline from '../../ui/Sparkline.vue'
import StatusDot from '../../ui/StatusDot.vue'
import Tabs from '../../ui/Tabs.vue'
import AssetsPage from '../AssetsPage.vue'
import ProjectWorkflows from '../project/ProjectWorkflows.vue'
import EnvModels from '../env/EnvModels.vue'
import InstanceGlyph from '../../parts/InstanceGlyph.vue'
import WorkflowCard from '../../parts/WorkflowCard.vue'
import { allWorkflows } from '../../gallery'
import EnvLaunchButton from '../../parts/env/EnvLaunchButton.vue'
import RunsOn from '../../parts/env/RunsOn.vue'
import StatTile from '../../parts/env/StatTile.vue'
import {
  deploymentsOf,
  envKind,
  envKindLabel,
  envStatus,
  fmt,
  fmtCompact,
  fmtGpu,
  isPublished,
  statsOf,
  versionsOf
} from '../../parts/env/env'
import { deployEnv, go, goIn, proto, toast } from '../../useProto'
import { can } from '../../milestones'
import { PROJECTS, type ProtoInstance } from '../../mock'

/**
 * One environment: what it is (version, nodes, models), where it runs
 * (this computer, Comfy Cloud, deployments) and its versions. Same page in
 * both lenses; Build opens on Versions.
 */
const { env } = defineProps<{ env: ProtoInstance }>()

type Tab = 'overview' | 'workflows' | 'assets' | 'contents' | 'versions' | 'deployments'
// Build opens on Versions. Without projects the environment *is* the place
// your work lives, so it opens on Workflows - like a project would.
const tab = ref<Tab>(
  proto.mode === 'build' ? 'versions' : proto.projects ? 'overview' : 'workflows'
)
const k = computed(() => envKind(env))
const st = computed(() => envStatus(env))
const s = computed(() => statsOf(env))
const versions = computed(() => versionsOf(env))
const deps = computed(() => deploymentsOf(env.id))
const recent = computed(() =>
  allWorkflows.value
    .filter((w) => w.envId === env.id)
    .sort((a, b) => a.age - b.age)
    .slice(0, 4)
)
const usedBy = computed(() => PROJECTS.filter((p) => p.envId === env.id))
const tabs = computed(() => [
  ...(proto.projects
    ? [
        { value: 'overview' as Tab, label: 'Overview' },
        { value: 'workflows' as Tab, label: 'Workflows' }
      ]
    : [
        {
          value: 'workflows' as Tab,
          label: 'Workflows',
          count: allWorkflows.value.filter((w) => w.envId === env.id).length
        },
        { value: 'overview' as Tab, label: 'Activity' }
      ]),
  { value: 'assets' as Tab, label: 'Assets' },
  { value: 'contents' as Tab, label: 'Models & nodes' },
  ...(k.value !== 'managed'
    ? [{ value: 'versions' as Tab, label: 'Versions', count: versions.value.length }]
    : []),
  // Deployments come with the Builder (Milestone 6).
  ...(can.value.builder && proto.signedIn && k.value !== 'managed'
    ? [{ value: 'deployments' as Tab, label: 'Deployments', count: deps.value.length }]
    : [])
])
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <Button variant="link" size="sm" class="mt-6 -mb-4" @click="go('environments')"
      ><ChevronLeft :size="14" />Builds</Button
    >

    <header class="flex items-start gap-4 pt-12 pb-8">
      <InstanceGlyph :inst="env" size="xl" />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2.5">
          <h1 class="text-title font-semibold tracking-[-0.01em]">{{ env.name }}</h1>
          <Badge v-if="k === 'managed'" variant="outline" size="md">Managed</Badge>
          <Badge v-else-if="versions[0]" size="md">{{ versions[0].label }}</Badge>
        </div>
        <p class="mt-1 flex items-center gap-2 text-ui text-muted-foreground">
          <StatusDot :status="st.live ? 'running' : 'idle'" />{{ st.label }}
          <span class="text-subtle-foreground">· {{ envKindLabel(env) }}</span>
          <template v-if="!st.live"
            ><span class="text-subtle-foreground">· {{ st.start }}</span></template
          >
        </p>
        <div class="mt-3 flex items-center gap-2">
          <span class="text-ui text-subtle-foreground">Runs on</span>
          <RunsOn :env />
        </div>
        <div v-if="proto.projects && usedBy.length" class="mt-2 flex items-center gap-2">
          <span class="text-ui text-subtle-foreground">Used by</span>
          <Button
            v-for="p in usedBy"
            :key="p.id"
            variant="ghost"
            size="sm"
            class="h-6 rounded-full border border-border-default px-2 text-ui"
            @click="go(`project:${p.id}`)"
          >
            <Folder :size="12" />{{ p.name }}
          </Button>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Button
          v-if="k === 'local' && env.state === 'running'"
          size="lg"
          @click="toast(`Stopping ${env.name}…`)"
          ><Square :size="12" />Stop</Button
        >
        <Button
          v-if="can.builder && k !== 'managed' && proto.signedIn"
          size="lg"
          @click="deployEnv(env.id)"
          ><Rocket :size="14" />Deploy as API</Button
        >
        <EnvLaunchButton :env size="lg" />
        <DropdownMenuRoot v-if="k !== 'managed'" :modal="false">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" aria-label="More"
              ><EllipsisVertical :size="15"
            /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-60">
            <DropdownMenuItem @select="toast(`Saved ${env.name} v${versions.length + 1}`)"
              ><Save :size="14" />Save a version</DropdownMenuItem
            >
            <DropdownMenuItem
              v-if="can.builder && k === 'local' && !isPublished(env)"
              @select="toast('Publishing to the cloud…')"
            >
              <CloudUpload :size="14" />Publish to the cloud
            </DropdownMenuItem>
            <DropdownMenuItem
              v-else-if="can.builder && k === 'local'"
              @select="toast('Updating the cloud from this computer…')"
            >
              <Cloud :size="14" />Update cloud from this computer
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @select="toast('Build settings')"
              ><Settings2 :size="14" />Settings</DropdownMenuItem
            >
          </DropdownMenuContent>
        </DropdownMenuRoot>
      </div>
    </header>

    <Tabs v-model="tab" :options="tabs">
      <template v-if="tab === 'overview'">
        <Card class="mt-5 grid grid-cols-4 divide-x divide-border-default">
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
              deps.length
                ? `${deps.length} deployment${deps.length > 1 ? 's' : ''}`
                : 'Not deployed'
            "
          />
        </Card>
        <p class="mt-7 mb-3 text-ui font-semibold">Recent workflows</p>
        <div
          v-if="recent.length"
          class="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5"
        >
          <WorkflowCard v-for="w in recent" :key="w.id" :wf="w" />
        </div>
        <p v-else class="text-ui text-muted-foreground">No workflows in this build yet.</p>
      </template>

      <ProjectWorkflows v-else-if="tab === 'workflows'" :scope="env" />
      <AssetsPage v-else-if="tab === 'assets'" :scope="env" embedded />
      <EnvModels v-else-if="tab === 'contents'" :env />

      <!-- Versions: frozen snapshots; published ones can be deployed -->
      <div v-else-if="tab === 'versions'" class="mt-5">
        <div class="mb-3 flex items-center justify-between">
          <p class="text-ui text-muted-foreground">
            {{
              k === 'local'
                ? 'Snapshots of this computer’s setup. Publish one to run it in the cloud.'
                : 'Each version is a frozen copy you can deploy.'
            }}
          </p>
          <Button size="sm" @click="toast(`Saved v${versions.length + 1}`)"
            ><Save :size="13" />Save a version</Button
          >
        </div>
        <Card class="overflow-hidden">
          <div
            v-for="(v, i) in versions"
            :key="v.id"
            class="flex min-h-14 items-center gap-4 border-b border-border-default px-4 last:border-b-0"
          >
            <Badge size="md" class="w-10 justify-center">{{ v.label }}</Badge>
            <div class="min-w-0 flex-1">
              <p class="truncate text-ui">{{ v.note }}</p>
              <p class="text-ui text-subtle-foreground">
                {{ v.when }}<template v-if="i === 0"> · current</template>
                <template v-if="deps.some((d) => d.version === v.id)">
                  · deployed to
                  {{
                    deps
                      .filter((d) => d.version === v.id)
                      .map((d) => d.name)
                      .join(', ')
                  }}</template
                >
              </p>
            </div>
            <span
              class="flex items-center gap-1.5 text-ui"
              :class="v.published ? 'text-muted-foreground' : 'text-subtle-foreground'"
            >
              <component :is="v.published ? Cloud : Save" :size="13" />{{
                v.published ? 'In the cloud' : 'This computer only'
              }}
            </span>
            <Button v-if="proto.signedIn" variant="ghost" size="sm" @click="deployEnv(env.id)"
              ><Rocket :size="13" />Deploy</Button
            >
          </div>
        </Card>
      </div>

      <!-- Deployments of this environment (bridge to Build) -->
      <div v-else class="mt-5">
        <Card v-if="deps.length" class="overflow-hidden">
          <div
            v-for="d in deps"
            :key="d.id"
            role="button"
            tabindex="0"
            class="flex min-h-14 cursor-pointer items-center gap-4 border-b border-border-default px-4 outline-none last:border-b-0 hover:bg-secondary-background/50 focus-visible:bg-secondary-background"
            @click="goIn('build', `deployment:${d.id}`)"
            @keydown.enter="goIn('build', `deployment:${d.id}`)"
          >
            <Rocket :size="16" class="text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <p class="truncate font-mono text-ui">{{ d.name }}</p>
              <p class="text-ui text-subtle-foreground">
                {{ d.stage }} · {{ d.version }} · {{ d.gpu }}
              </p>
            </div>
            <span class="flex items-center gap-1.5 text-ui text-muted-foreground"
              ><StatusDot :status="d.status === 'running' ? 'running' : 'idle'" />{{
                d.status === 'running' ? 'Running' : 'Scaled to zero'
              }}</span
            >
            <span class="w-24 text-right text-ui tabular-nums"
              >{{ fmtCompact(d.requests7d) }} req</span
            >
          </div>
        </Card>
        <Card v-else variant="dashed" class="flex items-center justify-between gap-4 px-5 py-4">
          <p class="text-ui text-muted-foreground">
            Not deployed. Run a version behind an API endpoint that scales with traffic.
          </p>
          <Button variant="primary" @click="deployEnv(env.id)"
            ><Rocket :size="14" />Deploy as API</Button
          >
        </Card>
      </div>
    </Tabs>
  </div>
</template>
