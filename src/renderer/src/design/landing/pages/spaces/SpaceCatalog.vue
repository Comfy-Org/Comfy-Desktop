<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Copy,
  EllipsisVertical,
  LayoutGrid,
  Plus,
  SlidersHorizontal,
  Trash2,
  Waypoints,
  ArrowUpRight
} from 'lucide-vue-next'
import {
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import DialogContent from '../../ui/DialogContent.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuSeparator from '../../ui/DropdownMenuSeparator.vue'
import Input from '../../ui/Input.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import Select from '../../ui/Select.vue'
import { allWorkflows } from '../../gallery'
import {
  FLAVOR_LABEL,
  GPU_OPTIONS,
  REGION_OPTIONS,
  spaceById,
  SPACES,
  type Flavor
} from '../../spaces'
import StatusDot from '../../ui/StatusDot.vue'
import Switch from '../../ui/Switch.vue'
import { goIn, toast } from '../../useProto'
import { APPS, thumb } from '../../mock'

/**
 * What members of this space can run. Each item comes from the studio (an app or a
 * workflow), in one of two flavours, pinned to a version so the studio's
 * own changes never surprise members.
 */
const { spaceId } = defineProps<{ spaceId: string }>()
const space = computed(() => spaceById(spaceId)!)
const VERSIONS = [
  { value: 'latest', label: 'Follows latest' },
  { value: 'Product Shots v4', label: 'Pinned · Product Shots v4' },
  { value: 'My Local 1 v3', label: 'Pinned · My Local 1 v3' },
  { value: 'Flux Sandbox v2', label: 'Pinned · Flux Sandbox v2' },
  { value: 'Video Lab v2', label: 'Pinned · Video Lab v2' }
]

// Add to space
const open = ref(false)
const sources = computed(() => [
  ...APPS.map((a) => ({
    value: `app:${a.id}`,
    label: `App · ${a.name}`,
    name: a.name,
    thumbId: a.thumbId
  })),
  ...allWorkflows.value.slice(0, 8).map((w) => ({
    value: `wf:${w.name}`,
    label: `Workflow · ${w.name}`,
    name: w.name.replace(/\.json$/, '').replaceAll('-', ' '),
    thumbId: w.thumbId
  }))
])
const source = ref('app:a-relight')
const flavor = ref<Flavor>('app')
const name = ref('')
const version = ref('latest')
const cost = ref('6')
const gpu = ref(GPU_OPTIONS[0]!.value)
const region = ref(REGION_OPTIONS[0]!.value)
// Endpoint settings for one tool
const editing = ref<string | null>(null)
const editItem = computed(() => space.value.catalog.find((c) => c.id === editing.value))
function add(): void {
  const s = sources.value.find((x) => x.value === source.value)
  if (!s) return
  space.value.catalog.unshift({
    id: `c-${Date.now()}`,
    name: name.value.trim() || s.name,
    blurb: 'New from the studio.',
    thumbId: s.thumbId,
    flavor: flavor.value,
    source: s.label,
    version: version.value === 'latest' ? null : version.value,
    presets: [],
    cost: Number(cost.value) || 6,
    runs: 0,
    visible: true,
    isNew: true,
    endpoint: {
      name: `${space.value.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${(name.value.trim() || s.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      gpu: gpu.value,
      region: region.value,
      warm: false
    }
  })
  space.value.activity.unshift({
    who: 'Pablo',
    what: `added ${name.value.trim() || s.name}`,
    when: 'Just now',
    studio: true
  })
  toast(`Added to ${space.value.name}`)
  open.value = false
  name.value = ''
}
function remove(id: string): void {
  space.value.catalog = space.value.catalog.filter((c) => c.id !== id)
}
</script>

<template>
  <div class="mt-8 mb-3 flex items-center justify-between">
    <p class="text-ui text-muted-foreground">
      {{ space.catalog.filter((c) => c.visible).length }} of {{ space.catalog.length }} visible to
      members. Hidden items keep their history.
    </p>
    <Button variant="primary" @click="open = true"><Plus :size="14" />Add to space</Button>
  </div>
  <Card class="overflow-hidden">
    <div
      class="grid h-10 grid-cols-[minmax(0,1fr)_170px_190px_220px_64px_76px] items-center gap-4 border-b border-border-default px-4 text-ui text-subtle-foreground"
    >
      <span>Tool</span><span>Shown as</span><span>Version</span><span>Endpoint</span
      ><span class="text-right">Cost</span><span class="text-right">Visible</span>
    </div>
    <div
      v-for="c in space.catalog"
      :key="c.id"
      class="grid min-h-16 grid-cols-[minmax(0,1fr)_170px_190px_220px_64px_76px] items-center gap-4 border-b border-border-default px-4 last:border-b-0"
    >
      <span class="flex min-w-0 items-center gap-3">
        <img
          :src="thumb(c.thumbId)"
          alt=""
          class="h-10 w-14 shrink-0 rounded-control object-cover"
        />
        <span class="min-w-0">
          <span class="flex items-center gap-2 truncate text-ui font-medium"
            >{{ c.name }}<Badge v-if="c.isNew" size="sm">New</Badge></span
          >
          <span class="block truncate text-ui text-subtle-foreground"
            >{{ c.source }} · {{ c.runs.toLocaleString('en-US') }} runs</span
          >
        </span>
      </span>
      <Select
        v-model="c.flavor"
        variant="ghost"
        size="sm"
        :options="[
          { value: 'app', label: FLAVOR_LABEL.app },
          { value: 'workflow', label: FLAVOR_LABEL.workflow }
        ]"
      />
      <Select
        :model-value="c.version ?? 'latest'"
        variant="ghost"
        size="sm"
        :options="VERSIONS"
        @update:model-value="(v: string) => (c.version = v === 'latest' ? null : v)"
      />
      <button
        type="button"
        class="min-w-0 rounded-control px-2 py-1 text-left outline-none hover:bg-secondary-background focus-visible:ring-2 focus-visible:ring-border-focus"
        @click="editing = c.id"
      >
        <span class="flex items-center gap-1.5 truncate font-mono text-ui"
          ><StatusDot :status="c.endpoint?.warm ? 'running' : 'idle'" />{{ c.endpoint?.name }}</span
        >
        <span class="block truncate text-ui text-subtle-foreground"
          >{{ c.endpoint?.gpu.split(' · ')[0] }} · {{ c.endpoint?.region }}</span
        >
      </button>
      <span class="text-right text-ui text-muted-foreground tabular-nums">{{ c.cost }} cr</span>
      <span class="flex items-center justify-end gap-1">
        <Switch v-model="c.visible" :aria-label="`Visible to members: ${c.name}`" />
        <DropdownMenuRoot :modal="false">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-xs" :aria-label="`${c.name} options`"
              ><EllipsisVertical :size="13"
            /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-60">
            <DropdownMenuItem @select="toast('Choose exposed inputs, defaults and presets')"
              ><SlidersHorizontal :size="14" />Inputs and presets</DropdownMenuItem
            >
            <DropdownMenuItem
              v-for="o in SPACES.filter((x) => x.id !== spaceId)"
              :key="o.id"
              @select="toast(`Copied ${c.name} to ${o.name}`)"
              ><Copy :size="14" />Copy to {{ o.name }}</DropdownMenuItem
            >
            <DropdownMenuSeparator />
            <DropdownMenuItem @select="remove(c.id)"><Trash2 :size="14" />Remove</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuRoot>
      </span>
    </div>
  </Card>

  <DialogRoot v-model:open="open">
    <DialogContent size="md" class="p-5">
      <DialogTitle class="text-heading font-semibold">Add to {{ space.name }}</DialogTitle>
      <DialogDescription class="mt-1 text-ui text-muted-foreground">
        Pick something from your studio and how members should see it.
      </DialogDescription>
      <div class="mt-5 grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
        <span class="text-ui text-muted-foreground">From</span>
        <Select v-model="source" :options="sources" />
        <span class="text-ui text-muted-foreground">Show as</span>
        <SegmentedControl
          v-model="flavor"
          variant="contained"
          :options="[
            { value: 'app', label: 'App', icon: LayoutGrid },
            { value: 'workflow', label: 'Workflow', icon: Waypoints }
          ]"
        />
        <span />
        <p class="text-ui text-subtle-foreground">
          {{
            flavor === 'app'
              ? 'A form with the inputs you choose and a Generate button. No graph.'
              : 'The graph, locked. Members see how it works and changes only the inputs you expose.'
          }}
        </p>
        <span class="text-ui text-muted-foreground">Name</span>
        <Input v-model="name" placeholder="Name members see" />
        <span class="text-ui text-muted-foreground">Version</span>
        <Select v-model="version" :options="VERSIONS" />
        <span class="text-ui text-muted-foreground">GPU</span>
        <Select v-model="gpu" :options="GPU_OPTIONS" />
        <span class="text-ui text-muted-foreground">Region</span>
        <Select v-model="region" :options="REGION_OPTIONS" />
        <span class="text-ui text-muted-foreground">Cost</span>
        <Input v-model="cost" mono aria-label="Credits per run"
          ><template #trailing
            ><span class="text-ui text-subtle-foreground">credits a run</span></template
          ></Input
        >
      </div>
      <div class="mt-6 flex justify-end gap-2">
        <Button variant="ghost" @click="open = false">Cancel</Button>
        <Button variant="primary" @click="add">Add to space</Button>
      </div>
    </DialogContent>
  </DialogRoot>
  <DialogRoot :open="!!editItem" @update:open="(o: boolean) => !o && (editing = null)">
    <DialogContent v-if="editItem?.endpoint" size="md" class="p-5">
      <DialogTitle class="text-heading font-semibold">Endpoint · {{ editItem.name }}</DialogTitle>
      <DialogDescription class="mt-1 text-ui text-muted-foreground">
        Each tool runs on its own endpoint, so you can size and place it on its own.
      </DialogDescription>
      <div class="mt-5 grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
        <span class="text-ui text-muted-foreground">Name</span>
        <Input v-model="editItem.endpoint.name" mono />
        <span class="text-ui text-muted-foreground">GPU</span>
        <Select v-model="editItem.endpoint.gpu" :options="GPU_OPTIONS" />
        <span class="text-ui text-muted-foreground">Region</span>
        <Select v-model="editItem.endpoint.region" :options="REGION_OPTIONS" />
      </div>
      <Switch
        v-model="editItem.endpoint.warm"
        label="Keep warm (no cold starts, billed while idle)"
        class="mt-4"
      />
      <div class="mt-6 flex items-center justify-between">
        <!-- Scaling, versions, logs and keys live with the deployment in Build. -->
        <Button
          variant="ghost"
          @click="(goIn('build', `deployment:sp-${spaceId}-${editItem.id}`), (editing = null))"
          >Advanced settings<ArrowUpRight :size="13"
        /></Button>
        <Button variant="primary" @click="editing = null">Done</Button>
      </div>
    </DialogContent>
  </DialogRoot>
</template>
