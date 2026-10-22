<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Cpu,
  Folder,
  HardDrive,
  Heart,
  Maximize2,
  Minus,
  Play,
  Plus,
  Puzzle,
  Share2,
  SquareArrowOutUpRight
} from 'lucide-vue-next'
import {
  DialogDescription,
  DialogRoot,
  DialogTitle,
  RadioGroupIndicator,
  RadioGroupItem,
  RadioGroupRoot
} from 'reka-ui'
import ComfyCLogo from '../../../components/icons/ComfyCLogo.vue'
import Badge from '../ui/Badge.vue'
import Button from '../ui/Button.vue'
import Card from '../ui/Card.vue'
import DialogContent from '../ui/DialogContent.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import GraphPreview from './GraphPreview.vue'
import InstanceGlyph from './InstanceGlyph.vue'
import { hostActions, instanceById, instances, isUsable, proto } from '../useProto'
import { thumb, type ProtoInstance } from '../mock'
import {
  bestTarget,
  modelsFor,
  templateAbout,
  templateById,
  templateFit,
  templateStats,
  workflowByName,
  workflowFit,
  type Fit
} from '../fit'

/**
 * Summary shown before anything opens. The desktop-specific part is the
 * footer: *where* to open it, what each instance would need, and that
 * ComfyUI launches from that instance.
 */
const open = computed({
  get: () => Boolean(proto.detail),
  set: (v) => {
    if (!v) proto.detail = null
  }
})
const template = computed(() =>
  proto.detail?.kind === 'template' ? templateById(proto.detail.id) : undefined
)
const workflow = computed(() =>
  proto.detail?.kind === 'workflow' ? workflowByName(proto.detail.id) : undefined
)

const title = computed(() => template.value?.title ?? workflow.value?.name ?? '')
const thumbId = computed(() => template.value?.id ?? workflow.value?.thumbId ?? '')
const stats = computed(() => (template.value ? templateStats(template.value) : undefined))
const models = computed(() => (template.value ? modelsFor(template.value) : []))

const targets = computed<{ inst: ProtoInstance; fit: Fit }[]>(() =>
  instances.value.map((inst) => ({
    inst,
    fit: template.value
      ? templateFit(template.value, inst, proto.signedIn)
      : workflow.value
        ? workflowFit(workflow.value, inst, proto.signedIn)
        : { state: 'ready', label: '' }
  }))
)
const recommended = computed(() => bestTarget(targets.value.filter((t) => isUsable(t.inst))))
const selectedId = ref<string>()
const tab = ref<'graph' | 'output'>('graph')
const zoom = ref(1)
watch(
  () => proto.detail,
  () => {
    selectedId.value = recommended.value?.id
    tab.value = 'graph'
    zoom.value = 1
  },
  { immediate: true }
)
const selected = computed(() => targets.value.find((t) => t.inst.id === selectedId.value))

const explain = computed(() => {
  const s = selected.value
  if (!s) return 'Pick where to open it.'
  const i = s.inst
  if (i.deployment) return `Opens ${i.name} on Comfy Cloud in a new window.`
  if (i.kind === 'cloud')
    return 'Opens Comfy Cloud in a new window. Runs on cloud GPUs and uses credits.'
  if (i.state === 'running') return `${i.name} is already running. This opens in a new tab there.`
  const extra = s.fit.state === 'download' ? ' Missing models download first.' : ''
  return `Launches ComfyUI from ${i.name} (about 20 s) and opens this in its own window.${extra}`
})
const cta = computed(() => {
  const s = selected.value
  if (!s) return 'Open'
  return s.inst.state === 'running' ? `Open in ${s.inst.name}` : `Launch ${s.inst.name}`
})

function confirm(): void {
  if (selected.value) hostActions.launch(selected.value.inst, title.value)
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent size="lg">
      <header class="px-6 pt-6 pb-4 pr-14">
        <DialogTitle class="text-title font-semibold tracking-[-0.015em]">{{ title }}</DialogTitle>
        <DialogDescription class="mt-1.5 flex items-center gap-2 text-muted-foreground">
          <template v-if="template">
            <span
              class="inline-flex size-5 items-center justify-center rounded-full bg-secondary-background-hover"
            >
              <ComfyCLogo :size="11" />
            </span>
            by ComfyUI · Used {{ stats?.uses }} times
          </template>
          <template v-else-if="workflow">
            <InstanceGlyph :inst="instanceById(workflow.instanceId)!" size="sm" />
            Last opened in {{ instanceById(workflow.instanceId)?.name }} · edited
            {{ workflow.modified.toLowerCase() }}
          </template>
        </DialogDescription>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
        <!-- Preview 12; floating controls inset 8 -> 8. -->
        <div class="relative h-85 overflow-hidden rounded-card border border-border-default">
          <GraphPreview
            v-if="tab === 'graph'"
            :thumb-id="thumbId"
            :category="template?.category ?? 'image'"
            :zoom
            :model="models[0]?.name"
          />
          <img v-else :src="thumb(thumbId)" alt="" class="size-full bg-[#141415] object-contain" />
          <SegmentedControl
            v-model="tab"
            variant="contained"
            class="absolute top-2 left-2 bg-card-background/80 backdrop-blur-sm"
            :options="[
              { value: 'graph', label: 'Graph' },
              { value: 'output', label: 'Output' }
            ]"
          />
          <div
            v-if="tab === 'graph'"
            class="absolute right-2 bottom-2 flex items-center rounded-control border border-border-default bg-card-background/80 p-0.5 text-ui text-muted-foreground backdrop-blur-sm"
          >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom out"
              @click="zoom = Math.max(0.5, zoom - 0.1)"
              ><Minus :size="13"
            /></Button>
            <span class="min-w-10.5 text-center tabular-nums">{{ Math.round(zoom * 100) }}%</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom in"
              @click="zoom = Math.min(1.6, zoom + 0.1)"
              ><Plus :size="13"
            /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Reset zoom" @click="zoom = 1"
              ><Maximize2 :size="12"
            /></Button>
          </div>
        </div>

        <div class="grid grid-cols-[1.4fr_1fr] gap-8 pt-5.5 pb-2">
          <section>
            <h3
              class="mb-2.5 text-ui font-semibold tracking-wider text-subtle-foreground uppercase"
            >
              {{ template ? 'About this template' : 'About this workflow' }}
            </h3>
            <template v-if="template">
              <p
                v-for="(para, i) in templateAbout(template)"
                :key="i"
                class="mb-2.5 leading-relaxed"
              >
                {{ para }}
              </p>
            </template>
            <template v-else-if="workflow">
              <p class="mb-2.5 leading-relaxed">
                A workflow you saved on this computer. It opens with the same nodes, inputs and
                settings you left it with.
              </p>
              <p
                class="flex items-center gap-1.5 font-mono text-ui break-all text-subtle-foreground"
              >
                <Folder :size="12" />/Users/pablo/ComfyUI/{{
                  instanceById(workflow.instanceId)?.name
                }}/ComfyUI/user/default/workflows/{{ workflow.name }}
              </p>
            </template>
          </section>
          <section>
            <h3
              class="mb-2.5 text-ui font-semibold tracking-wider text-subtle-foreground uppercase"
            >
              Details
            </h3>
            <template v-if="stats">
              <div class="flex gap-1 border-b border-border-default pb-2">
                <Button variant="ghost" size="sm" class="-ml-2.5"
                  ><Heart :size="14" />{{ stats.likes }}</Button
                >
                <Button variant="ghost" size="sm"><Share2 :size="14" />Share</Button>
              </div>
              <div class="flex flex-wrap gap-1.5 pt-3">
                <Badge v-for="t in stats.tags" :key="t" size="tag" class="text-base-foreground">{{
                  t
                }}</Badge>
              </div>
            </template>
            <h3
              class="mt-4.5 mb-2.5 text-ui font-semibold tracking-wider text-subtle-foreground uppercase"
            >
              Needs
            </h3>
            <ul class="flex flex-col gap-2 text-ui text-muted-foreground">
              <template v-if="template">
                <li
                  v-for="m in models"
                  :key="m.name"
                  class="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2"
                >
                  <HardDrive :size="13" /><span class="truncate font-mono text-ui">{{
                    m.name
                  }}</span>
                  <span class="text-base-foreground tabular-nums">{{ m.size }}</span>
                </li>
                <li
                  v-if="template.vram"
                  class="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2"
                >
                  <Cpu :size="13" /><span>GPU memory</span
                  ><span class="text-base-foreground">{{ template.vram }}+</span>
                </li>
                <li
                  v-if="template.runs === 'cloud'"
                  class="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2"
                >
                  <Cpu :size="13" /><span>Partner model API</span
                  ><span class="text-base-foreground">Comfy Cloud</span>
                </li>
              </template>
              <template v-else>
                <li class="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2">
                  <Puzzle :size="13" /><span class="truncate">ComfyUI-KJNodes, rgthree-comfy</span
                  ><span class="text-base-foreground">2 packs</span>
                </li>
                <li class="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2">
                  <HardDrive :size="13" /><span>Models</span
                  ><span class="text-base-foreground">Installed</span>
                </li>
              </template>
            </ul>
            <p v-if="stats" class="mt-3.5 text-ui text-subtle-foreground">
              Added {{ stats.added }}
            </p>
          </section>
        </div>
      </div>

      <footer class="border-t border-border-default bg-secondary-background/25 px-6 pt-4 pb-5">
        <div class="mb-2.5 flex items-baseline gap-3">
          <span class="text-ui font-semibold tracking-wider text-subtle-foreground uppercase"
            >Open in</span
          >
          <span class="text-ui text-muted-foreground">{{ explain }}</span>
        </div>
        <RadioGroupRoot
          v-model="selectedId"
          class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2"
          aria-label="Open in"
        >
          <template v-for="t in targets" :key="t.inst.id">
            <!-- Logged out, Cloud is a login action rather than a choice. -->
            <Card
              v-if="!isUsable(t.inst)"
              as="button"
              variant="elevated"
              padding="none"
              interactive
              class="flex items-center gap-2.5 rounded-control p-2.5 text-left shadow-none"
              @click="hostActions.signIn()"
            >
              <InstanceGlyph :inst="t.inst" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="font-medium">{{ t.inst.name }}</span>
                <span class="truncate text-ui text-subtle-foreground">{{ t.fit.label }}</span>
              </span>
              <Badge variant="solid" size="md">Log in</Badge>
            </Card>
            <RadioGroupItem
              v-else
              :value="t.inst.id"
              :disabled="t.fit.state === 'blocked'"
              class="edge-shine group relative flex items-center gap-2.5 rounded-control border bg-card-background p-2.5 text-left outline-none transition-colors hover:bg-card-background-hover focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:border-border-focus data-[state=checked]:bg-card-background-hover"
            >
              <InstanceGlyph :inst="t.inst" dot />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="font-medium">{{ t.inst.name }}</span>
                <span
                  class="truncate text-ui text-subtle-foreground group-data-[state=checked]:text-muted-foreground"
                >
                  <span
                    v-if="recommended?.id === t.inst.id"
                    class="font-semibold text-base-foreground"
                    >Recommended · </span
                  >{{ t.fit.label }}
                </span>
              </span>
              <span
                class="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-border-strong group-data-[state=checked]:border-inverted-background group-data-[state=checked]:bg-inverted-background"
              >
                <RadioGroupIndicator class="size-1.5 rounded-full bg-inverted-foreground" />
              </span>
            </RadioGroupItem>
          </template>
        </RadioGroupRoot>
        <div class="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="lg" @click="open = false">Cancel</Button>
          <Button variant="primary" size="lg" :disabled="!selected" @click="confirm">
            <SquareArrowOutUpRight v-if="selected?.inst.state === 'running'" :size="13" />
            <Play v-else :size="13" />
            {{ cta }}
          </Button>
        </div>
      </footer>
    </DialogContent>
  </DialogRoot>
</template>
