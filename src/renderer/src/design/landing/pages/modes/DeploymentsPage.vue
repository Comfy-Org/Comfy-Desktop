<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus } from 'lucide-vue-next'
import Badge from '../../ui/Badge.vue'
import Select from '../../ui/Select.vue'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import PageHeader from '../../ui/PageHeader.vue'
import Sparkline from '../../ui/Sparkline.vue'
import StatusDot from '../../ui/StatusDot.vue'
import CloudSignInCta from '../../parts/CloudSignInCta.vue'
import InstanceGlyph from '../../parts/InstanceGlyph.vue'
import { deployments, envById, fmt, fmtCompact } from '../../parts/env/env'
import { deployEnv, go, instances, proto } from '../../useProto'
import SpaceMark from '../../parts/space/SpaceMark.vue'
import { SPACES } from '../../spaces'
import { PROJECTS } from '../../mock'

/** Deployments: a pinned environment version + GPUs + an endpoint. */
const firstLocal = computed(() => instances.value.find((i) => i.kind === 'local'))
const project = ref('all')
const space = ref('all')
/** Projects reference environments, so a deployment belongs to the
 *  projects that run on its environment. A filter, not navigation. */
const projectsOf = (envId: string): string[] =>
  PROJECTS.filter((p) => p.envId === envId).map((p) => p.name)
const list = computed(() =>
  deployments.value.filter(
    (d) =>
      (!proto.projects || project.value === 'all' || projectsOf(d.envId).includes(project.value)) &&
      (!proto.spaces ||
        space.value === 'all' ||
        (space.value === 'none' ? !d.spaceId : d.spaceId === space.value))
  )
)
// Deployment, [Project], [Space], Environment, Endpoint, Status, Req, Errors, Spend, Trend
const COLS = computed(
  () =>
    `grid-template-columns: minmax(0,1.3fr) ${proto.projects ? 'minmax(0,0.9fr) ' : ''}${proto.spaces ? '140px ' : ''}minmax(0,1fr) minmax(0,1fr) 110px 64px 60px 76px 80px`
)
const spaceOf = (id?: string) => (id ? SPACES.find((s) => s.id === id) : undefined)
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader
      title="Deployments"
      description="A fixed version of a build, on GPUs that scale with traffic, behind an endpoint."
    >
      <template #actions>
        <Select
          v-if="proto.projects && proto.signedIn"
          v-model="project"
          label="Project"
          class="w-56"
          :options="[
            { value: 'all', label: 'All' },
            ...PROJECTS.map((p) => ({ value: p.name, label: p.name }))
          ]"
        />
        <Select
          v-if="proto.spaces && proto.signedIn"
          v-model="space"
          label="Space"
          class="w-48"
          :options="[
            { value: 'all', label: 'All' },
            ...SPACES.map((s) => ({ value: s.id, label: s.name })),
            { value: 'none', label: 'Not in a space' }
          ]"
        />
        <Button
          v-if="firstLocal && proto.signedIn"
          variant="primary"
          size="lg"
          @click="deployEnv(firstLocal.id)"
          ><Plus :size="15" />New deployment</Button
        >
      </template>
    </PageHeader>
    <CloudSignInCta
      v-if="!proto.signedIn"
      title="Deploy ComfyUI as an API"
      body="Log in to deploy a build behind an endpoint."
    />
    <Card v-else class="overflow-hidden">
      <div
        class="grid h-10 items-center gap-4 border-b border-border-default bg-secondary-background/40 px-4 text-ui font-medium tracking-wider text-subtle-foreground uppercase"
        :style="COLS"
      >
        <span>Deployment</span><span v-if="proto.projects">Project</span
        ><span v-if="proto.spaces">Space</span><span>Build</span><span>Endpoint</span
        ><span>Status</span> <span class="text-right">Req 7d</span
        ><span class="text-right">Errors</span><span class="text-right">Spend 7d</span
        ><span>Trend</span>
      </div>
      <div
        v-for="d in list"
        :key="d.id"
        role="button"
        tabindex="0"
        class="grid min-h-15 cursor-pointer items-center gap-4 border-b border-border-default px-4 outline-none last:border-b-0 hover:bg-secondary-background/50 focus-visible:bg-secondary-background"
        :style="COLS"
        @click="go(`deployment:${d.id}`)"
        @keydown.enter="go(`deployment:${d.id}`)"
      >
        <span class="flex min-w-0 items-center gap-2">
          <span class="min-w-0">
            <span class="block truncate font-mono text-ui">{{ d.name }}</span>
            <span v-if="d.tool" class="block truncate text-ui text-subtle-foreground">{{
              d.tool
            }}</span>
          </span>
          <Badge v-if="d.stage === 'staging'" size="sm">staging</Badge>
        </span>
        <span v-if="proto.projects" class="truncate text-ui text-muted-foreground">{{
          projectsOf(d.envId).join(', ') || '—'
        }}</span>
        <span
          v-if="proto.spaces"
          class="flex min-w-0 items-center gap-2 text-ui text-muted-foreground"
        >
          <template v-if="spaceOf(d.spaceId)">
            <SpaceMark :brand="spaceOf(d.spaceId)!.brand" size="xs" />
            <span class="truncate">{{ spaceOf(d.spaceId)!.name }}</span>
          </template>
          <span v-else class="text-subtle-foreground">—</span>
        </span>
        <span class="flex min-w-0 items-center gap-2 text-ui text-muted-foreground">
          <InstanceGlyph v-if="envById(d.envId)" :inst="envById(d.envId)!" size="xs" />
          <span class="truncate">{{ envById(d.envId)?.name }} · {{ d.version }}</span>
        </span>
        <code class="truncate font-mono text-ui text-subtle-foreground">{{
          d.endpoint.replace('https://', '')
        }}</code>
        <span class="flex items-center gap-1.5 text-ui text-muted-foreground"
          ><StatusDot :status="d.status === 'running' ? 'running' : 'idle'" />{{
            d.status === 'running' ? 'Running' : 'Scaled to zero'
          }}</span
        >
        <span class="text-right text-ui tabular-nums">{{ fmtCompact(d.requests7d) }}</span>
        <span
          class="text-right text-ui tabular-nums"
          :class="d.errorRate > 1 ? 'text-base-foreground' : 'text-muted-foreground'"
          >{{ d.errorRate }}%</span
        >
        <span class="text-right text-ui text-muted-foreground tabular-nums">{{
          fmt(d.spend7d)
        }}</span>
        <Sparkline :values="d.trend" :width="88" :height="20" />
      </div>
    </Card>
  </div>
</template>
