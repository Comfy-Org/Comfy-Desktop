<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Code, Rocket } from 'lucide-vue-next'
import { GraphIcon, AppIcon } from '../../mar/icons/kindIcons'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Checkbox from '../../ui/Checkbox.vue'
import DialogContent from '../../ui/DialogContent.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import Select from '../../ui/Select.vue'
import Switch from '../../ui/Switch.vue'
import SpaceMark from './SpaceMark.vue'
import {
  deployTool,
  GPU_OPTIONS,
  placementsOf,
  REGION_OPTIONS,
  SPACES,
  type Flavor
} from '../../spaces'
import { proto } from '../../useProto'
import { thumb } from '../../mock'

/**
 * Deploy an app or workflow. Deploying always creates an endpoint; spaces
 * are optional places to put it. Pick none and it's just an endpoint, callable
 * from code, listed under Build -> Deployments.
 */
const tool = computed(() => proto.deployingTool)
const open = computed({
  get: () => !!tool.value,
  set: (v: boolean) => {
    if (!v) proto.deployingTool = null
  }
})
const placed = computed(() => (tool.value ? placementsOf(tool.value) : { spaces: [], api: false }))
const picked = ref<string[]>([])
const flavor = ref<Flavor>('app')
const gpu = ref(GPU_OPTIONS[0]!.value)
const region = ref(REGION_OPTIONS[0]!.value)
const warm = ref(false)
watch(tool, (t) => {
  picked.value = []
  flavor.value = t?.kind ?? 'app'
})
const isIn = (id: string): boolean => placed.value.spaces.some((s) => s.id === id)
function toggle(id: string, on: boolean): void {
  picked.value = on ? [...picked.value, id] : picked.value.filter((x) => x !== id)
}
const cta = computed(() =>
  picked.value.length
    ? `Deploy to ${picked.value.length} ${picked.value.length === 1 ? 'space' : 'spaces'}`
    : 'Deploy endpoint'
)
function deploy(): void {
  if (!tool.value) return
  deployTool(tool.value, picked.value, {
    flavor: flavor.value,
    gpu: gpu.value,
    region: region.value,
    warm: warm.value,
    version: null
  })
  proto.deployingTool = null
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent v-if="tool" size="md" class="p-5">
      <div class="flex items-center gap-3">
        <img :src="thumb(tool.thumbId)" alt="" class="size-10 rounded-control object-cover" />
        <div class="min-w-0">
          <DialogTitle class="flex items-center gap-2 text-heading font-semibold"
            ><Rocket :size="15" />Deploy {{ tool.name }}</DialogTitle
          >
          <DialogDescription class="text-ui text-muted-foreground">
            Gets its own endpoint. Pick the spaces it should appear in.
          </DialogDescription>
        </div>
      </div>

      <p class="mt-5 mb-2 text-ui font-medium">Where</p>
      <div class="flex flex-col gap-0.5 rounded-control border border-border-default p-1">
        <label
          v-for="s in SPACES"
          :key="s.id"
          :class="[
            'flex min-h-10 items-center gap-3 rounded-control px-2.5',
            isIn(s.id) ? 'opacity-60' : 'cursor-pointer hover:bg-secondary-background'
          ]"
        >
          <Checkbox
            :model-value="isIn(s.id) || picked.includes(s.id)"
            :disabled="isIn(s.id)"
            @update:model-value="(v: boolean) => toggle(s.id, v)"
          />
          <SpaceMark :brand="s.brand" size="xs" />
          <span class="flex-1 truncate text-ui">{{ s.name }}</span>
          <Badge v-if="isIn(s.id)" size="sm">Deployed</Badge>
        </label>
        <div class="flex min-h-10 items-center gap-3 border-t border-border-default px-2.5 pt-1">
          <Code :size="14" class="text-subtle-foreground" />
          <span class="flex-1 text-ui text-muted-foreground">
            No space? It still gets an endpoint you can call from code.
          </span>
        </div>
      </div>

      <template v-if="picked.length">
        <p class="mt-5 mb-2 text-ui font-medium">Members see it as</p>
        <SegmentedControl
          v-model="flavor"
          variant="contained"
          :options="[
            { value: 'app', label: 'App', icon: AppIcon },
            { value: 'workflow', label: 'Workflow', icon: GraphIcon }
          ]"
        />
      </template>

      <p class="mt-5 mb-2 text-ui font-medium">Endpoint</p>
      <div class="grid grid-cols-2 gap-2">
        <Select v-model="gpu" label="GPU" :options="GPU_OPTIONS" />
        <Select v-model="region" label="Region" :options="REGION_OPTIONS" />
      </div>
      <Switch v-model="warm" label="Keep warm (no cold starts, billed while idle)" class="mt-3" />
      <p v-if="picked.length > 1" class="mt-2 text-ui text-subtle-foreground">
        Each space gets its own endpoint, so usage, data and scaling stay separate.
      </p>

      <div class="mt-6 flex justify-end gap-2">
        <Button variant="ghost" @click="open = false">Cancel</Button>
        <Button variant="primary" @click="deploy"><Rocket :size="14" />{{ cta }}</Button>
      </div>
    </DialogContent>
  </DialogRoot>
</template>
