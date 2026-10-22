<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  AppWindow,
  ArrowRight,
  Check,
  Clapperboard,
  Code,
  Copy,
  Download,
  Eye,
  Hand,
  Image,
  ListChecks,
  Loader2,
  Pencil,
  Play,
  Plus,
  Rocket,
  Sparkles,
  ToggleRight,
  Type,
  Waypoints,
  X
} from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Badge from '../ui/Badge.vue'
import Button from '../ui/Button.vue'
import Card from '../ui/Card.vue'
import Checkbox from '../ui/Checkbox.vue'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import { cn } from '../ui/cn'
import GraphPreview from '../parts/GraphPreview.vue'
import SpaceMark from '../parts/space/SpaceMark.vue'
import LayoutThumb from '../parts/agent/LayoutThumb.vue'
import PromptBox from '../parts/PromptBox.vue'
import {
  agent,
  approveDeploy,
  askLayout,
  chooseLayout,
  LAYOUTS,
  layoutLabel,
  resetAgent,
  send,
  suggestions,
  WORKFLOW_LIBRARY,
  type AppInput,
  type Stage
} from '../agent'
import { GPU_OPTIONS, openDeploy, previewSpace, REGION_OPTIONS, SPACES } from '../spaces'
import { go, hostActions, instanceById, toast } from '../useProto'
import { thumb } from '../mock'

/**
 * The agent, as a conversation. Each reply can carry an artifact you act
 * on: the workflow it built, the app it made from workflows, the deploy
 * plan (needs your approval), and where it went live.
 */
const text = ref('')
// Example ideas, loosely stacked and tilted.
const IDEAS = [
  { text: "Put this product in a model's hand", icon: Hand, tilt: -2.5, x: -28 },
  { text: 'Turn this photo into a 5 s video', icon: Clapperboard, tilt: 2, x: 34 },
  { text: 'Build an API for product shots', icon: Code, tilt: -1.5, x: -12 }
]
const scroller = ref<HTMLElement>()
function submit(t = text.value): void {
  send(t)
  text.value = ''
}
watch(
  () => [agent.messages.length, agent.messages.at(-1)?.shown, agent.stage],
  () => nextTick(() => scroller.value?.scrollTo({ top: 1e6, behavior: 'smooth' }))
)

const lastAgent = computed(() => [...agent.messages].reverse().find((m) => m.role === 'agent'))

// Latest artifact of each kind is the live one; older ones show as history.
const isLatest = (id: number, kind: Stage): boolean =>
  [...agent.messages].reverse().find((m) => m.artifact === kind)?.id === id

const INPUT_ICON: Record<AppInput['kind'], unknown> = {
  image: Image,
  text: Type,
  select: ListChecks,
  toggle: ToggleRight,
  number: ListChecks
}
const bold = (s: string): string =>
  s
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-base-foreground">$1</strong>')

function toggleSpace(id: string, on: boolean): void {
  agent.spaceIds = on ? [...agent.spaceIds, id] : agent.spaceIds.filter((x) => x !== id)
}
function removeSource(name: string): void {
  if (!agent.app || agent.app.sources.length < 2) return
  agent.app.sources = agent.app.sources.filter((s) => s.name !== name)
}
function addSource(name: string): void {
  const w = WORKFLOW_LIBRARY.find((x) => x.name === name)
  if (w && agent.app && !agent.app.sources.includes(w)) agent.app.sources.push(w)
}
const spaceById = (id: string) => SPACES.find((s) => s.id === id)
const PAYER = { owner: 'You pay', split: 'Split', members: 'Clients pay' } as const
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Header: where you are in idea -> workflow -> app -> deploy -->
    <header class="flex items-center gap-4 px-10 pt-6 pb-4">
      <h1 class="flex items-center gap-2 text-heading font-semibold">
        <Sparkles :size="16" />Agent
      </h1>
      <Button
        v-if="agent.messages.length"
        variant="ghost"
        size="sm"
        class="ml-auto"
        @click="resetAgent"
        ><Plus :size="13" />New chat</Button
      >
    </header>

    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pb-8">
        <!-- Empty state: a short headline and a loose stack of ideas -->
        <div v-if="!agent.messages.length" class="flex flex-col items-center pt-24 text-center">
          <h2 class="heading-gradient text-display font-bold tracking-[-0.02em]">
            Dream it. Comfy builds it.
          </h2>
          <div class="mt-10 flex flex-col items-center">
            <button
              v-for="(s, i) in IDEAS"
              :key="s.text"
              type="button"
              class="idea relative flex h-14 items-center gap-3 rounded-full border border-border-default bg-card-background px-6 text-[15px] shadow-[0_14px_30px_-14px_rgb(0_0_0/0.9)] outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              :style="{
                '--tilt': `${s.tilt}deg`,
                transform: `translateX(${s.x}px) rotate(${s.tilt}deg)`,
                marginTop: i ? '-8px' : '0',
                zIndex: IDEAS.length - i
              }"
              @click="submit(s.text)"
            >
              <component :is="s.icon" :size="17" class="text-muted-foreground" />{{ s.text }}
            </button>
          </div>
        </div>

        <template v-for="m in agent.messages" :key="m.id">
          <!-- You -->
          <div v-if="m.role === 'user'" class="flex justify-end">
            <p class="max-w-[80%] rounded-card bg-secondary-background px-4 py-2.5 text-ui">
              {{ m.text }}
            </p>
          </div>

          <!-- Agent -->
          <div v-else class="flex gap-3">
            <span
              class="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary-background"
              ><Sparkles :size="13"
            /></span>
            <div class="min-w-0 flex-1">
              <ul v-if="m.steps" class="mb-3 flex flex-col gap-1.5">
                <li
                  v-for="(s, i) in m.steps.slice(0, m.shown ?? m.steps.length)"
                  :key="s"
                  class="flex items-center gap-2 text-ui text-muted-foreground"
                >
                  <Loader2
                    v-if="m.pending && i === (m.shown ?? 0) - 1"
                    :size="13"
                    class="animate-spin"
                  />
                  <Check v-else :size="13" class="text-status-running" />{{ s }}
                </li>
              </ul>
              <template v-if="!m.pending">
                <!-- eslint-disable-next-line vue/no-v-html -- mock copy, escaped above -->
                <p class="text-ui text-muted-foreground" v-html="bold(m.text)" />

                <!-- 0. Generated outputs: pick one to edit or open in ComfyUI -->
                <div
                  v-if="m.artifact === 'output' && m.outputs"
                  class="mt-3 grid grid-cols-2 gap-2.5"
                >
                  <div
                    v-for="(o, i) in m.outputs"
                    :key="o + i"
                    class="group relative aspect-[4/3] overflow-hidden rounded-card border border-border-default"
                  >
                    <img
                      :src="o.includes(':') ? o : thumb(o)"
                      alt=""
                      class="size-full object-cover"
                    />
                    <div
                      class="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-[linear-gradient(0deg,rgb(0_0_0/0.7),transparent)] p-2.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                    >
                      <Button size="sm" variant="primary" @click="text = `Edit option ${i + 1}: `"
                        ><Pencil :size="12" />Edit</Button
                      >
                      <Button
                        size="sm"
                        @click="hostActions.launch(instanceById('cloud')!, agent.workflow?.name)"
                        ><Play :size="12" />Open in ComfyUI</Button
                      >
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        class="ml-auto text-white"
                        aria-label="Download"
                        @click="toast('Downloading…')"
                        ><Download :size="13"
                      /></Button>
                    </div>
                    <Badge variant="overlay" size="md" class="absolute top-2.5 left-2.5">{{
                      i + 1
                    }}</Badge>
                  </div>
                </div>

                <!-- 1. Workflow -->
                <Card
                  v-else-if="m.artifact === 'workflow' && agent.workflow"
                  class="mt-3 overflow-hidden"
                >
                  <div class="relative aspect-[16/7] border-b border-border-default">
                    <GraphPreview :thumb-id="agent.workflow.thumbId" :zoom="0.5" />
                  </div>
                  <div class="flex items-center gap-3 px-4 py-3">
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-ui font-medium">{{ agent.workflow.name }}.json</p>
                      <p class="text-ui text-subtle-foreground">
                        {{ agent.workflow.nodes }} nodes · {{ agent.workflow.model }} · My Local 1
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" @click="toast('Saved to Workflows')"
                      >Save</Button
                    >
                    <Button
                      size="sm"
                      @click="hostActions.launch(instanceById('local-1')!, agent.workflow.name)"
                      ><Play :size="12" />Open in ComfyUI</Button
                    >
                  </div>
                  <!-- Call it from code: deploy as an API, or grab the request. -->
                  <div
                    v-if="isLatest(m.id, 'workflow')"
                    class="flex items-center gap-3 border-t border-border-default px-4 py-3.5"
                  >
                    <span
                      class="inline-flex size-9 items-center justify-center rounded-control bg-inverted-background text-inverted-foreground"
                      ><Code :size="16"
                    /></span>
                    <span class="min-w-0 flex-1">
                      <span class="block text-ui font-semibold">Use it as an API</span>
                      <span class="block font-mono text-ui text-subtle-foreground"
                        >POST api.comfy.org/v1/{{ agent.workflow.name }}/run</span
                      >
                    </span>
                    <Button size="sm" @click="toast('Copied curl example')"
                      ><Copy :size="12" />Copy request</Button
                    >
                    <Button
                      variant="primary"
                      size="sm"
                      @click="
                        openDeploy({
                          kind: 'workflow',
                          name: agent.workflow.name,
                          thumbId: agent.workflow.thumbId
                        })
                      "
                      ><Rocket :size="12" />Deploy as API</Button
                    >
                  </div>
                  <!-- The clear next step: make it something people can use. -->
                  <button
                    v-if="agent.stage === 'workflow' && isLatest(m.id, 'workflow')"
                    type="button"
                    class="flex w-full items-center gap-3 border-t border-border-default px-4 py-3.5 text-left outline-none hover:bg-secondary-background focus-visible:bg-secondary-background"
                    @click="submit('Create an app from this')"
                  >
                    <span
                      class="inline-flex size-9 items-center justify-center rounded-control bg-inverted-background text-inverted-foreground"
                      ><AppWindow :size="16"
                    /></span>
                    <span class="min-w-0 flex-1">
                      <span class="block text-ui font-semibold"
                        >Create an app from this workflow</span
                      >
                      <span class="block text-ui text-subtle-foreground"
                        >Pick a layout and the inputs people fill in. No graph for them to
                        learn.</span
                      >
                    </span>
                    <ArrowRight :size="15" class="text-muted-foreground" />
                  </button>
                </Card>

                <!-- Layout picker: three layouts or a custom one -->
                <div v-else-if="m.artifact === 'layout'" class="mt-3 grid grid-cols-4 gap-2.5">
                  <button
                    v-for="l in [
                      ...LAYOUTS,
                      {
                        id: 'custom' as const,
                        label: 'Custom',
                        hint: 'Describe it and the agent builds it'
                      }
                    ]"
                    :key="l.id"
                    type="button"
                    :disabled="agent.stage !== 'layout' || !isLatest(m.id, 'layout')"
                    :class="
                      cn(
                        'edge-shine relative flex flex-col gap-2 rounded-card border bg-card-background p-2 text-left outline-none transition-colors enabled:hover:[--shine:0.22] enabled:hover:bg-card-background-hover focus-visible:ring-2 focus-visible:ring-border-focus disabled:cursor-default',
                        isLatest(m.id, 'layout') &&
                          agent.app?.layout === l.id &&
                          'ring-2 ring-base-foreground/80',
                        agent.stage !== 'layout' && !(agent.app?.layout === l.id) && 'opacity-50'
                      )
                    "
                    @click="chooseLayout(l.id)"
                  >
                    <LayoutThumb
                      :layout="l.id"
                      :src="thumb(agent.pendingSources[0]?.thumbId ?? 'template_product_placement')"
                    />
                    <span class="px-1 pb-1">
                      <span class="block text-ui font-medium">{{ l.label }}</span>
                      <span class="block text-ui text-subtle-foreground">{{ l.hint }}</span>
                    </span>
                  </button>
                </div>

                <!-- 2. App from one or more workflows -->
                <Card
                  v-else-if="m.artifact === 'app' && agent.app"
                  class="mt-3 grid grid-cols-[minmax(0,1fr)_260px] overflow-hidden"
                >
                  <div class="flex flex-col gap-4 p-4">
                    <div class="flex items-center gap-2">
                      <AppWindow :size="15" />
                      <p class="flex-1 text-ui font-semibold">{{ agent.app.name }}</p>
                      <Badge size="md">App</Badge>
                    </div>
                    <div>
                      <p class="mb-1.5 text-ui text-subtle-foreground">Built from</p>
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span
                          v-for="(s, i) in agent.app.sources"
                          :key="s.name"
                          class="inline-flex h-7 items-center gap-1.5 rounded-full border border-border-default pr-1 pl-2.5 text-ui"
                        >
                          <span
                            v-if="agent.app.sources.length > 1"
                            class="text-ui text-subtle-foreground"
                            >{{ i + 1 }}</span
                          >
                          <Waypoints :size="12" />{{ s.name }}
                          <Button
                            v-if="isLatest(m.id, 'app') && agent.app.sources.length > 1"
                            variant="ghost"
                            size="icon-xs"
                            class="size-5 rounded-full"
                            :aria-label="`Remove ${s.name}`"
                            @click="removeSource(s.name)"
                            ><X :size="11"
                          /></Button>
                        </span>
                        <DropdownMenuRoot v-if="isLatest(m.id, 'app')" :modal="false">
                          <DropdownMenuTrigger as-child>
                            <Button variant="ghost" size="sm" class="h-7 rounded-full"
                              ><Plus :size="12" />Add workflow</Button
                            >
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" class="w-56">
                            <DropdownMenuItem
                              v-for="w in WORKFLOW_LIBRARY.filter(
                                (x) => !agent.app!.sources.includes(x)
                              )"
                              :key="w.name"
                              @select="addSource(w.name)"
                              ><Waypoints :size="14" />{{ w.name }}</DropdownMenuItem
                            >
                          </DropdownMenuContent>
                        </DropdownMenuRoot>
                      </div>
                    </div>
                    <div>
                      <p class="mb-1.5 text-ui text-subtle-foreground">Inputs people fill in</p>
                      <div
                        class="divide-y divide-border-default rounded-control border border-border-default"
                      >
                        <div
                          v-for="inp in agent.app.inputs"
                          :key="inp.label"
                          class="flex items-center gap-2.5 px-3 py-2 text-ui"
                        >
                          <component
                            :is="INPUT_ICON[inp.kind]"
                            :size="13"
                            class="text-subtle-foreground"
                          />
                          <span class="flex-1">{{ inp.label }}</span>
                          <span class="text-ui text-subtle-foreground">{{ inp.from }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <!-- Preview in the chosen layout -->
                  <div class="flex flex-col gap-2.5 border-l border-border-default bg-black/20 p-4">
                    <div class="flex items-center justify-between">
                      <p class="text-ui text-subtle-foreground">
                        {{ layoutLabel(agent.app.layout, 'Custom') }}
                      </p>
                      <Button
                        v-if="isLatest(m.id, 'app') && agent.stage === 'app'"
                        variant="link"
                        size="sm"
                        @click="askLayout()"
                        >Change layout</Button
                      >
                    </div>
                    <LayoutThumb
                      described
                      :layout="agent.app.layout"
                      :src="thumb(agent.app.sources[0]!.thumbId)"
                    />
                    <p v-if="agent.app.layout === 'custom'" class="text-ui text-subtle-foreground">
                      “{{ agent.app.custom }}”
                    </p>
                  </div>
                </Card>

                <!-- 3. Deploy plan: needs approval -->
                <Card v-else-if="m.artifact === 'deploy' && agent.app" class="mt-3 overflow-hidden">
                  <dl class="grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-3 p-4 text-ui">
                    <dt class="text-muted-foreground">What</dt>
                    <dd>{{ agent.app.name }} · App · {{ agent.app.sources.length }} workflows</dd>
                    <dt class="text-muted-foreground">Endpoint</dt>
                    <dd>
                      <span class="font-mono text-ui">product-studio</span> ·
                      {{ GPU_OPTIONS[0]!.label.split(' · ')[0] }} · {{ REGION_OPTIONS[0]!.label }} ·
                      scales to zero
                    </dd>
                    <dt class="pt-1.5 text-muted-foreground">Spaces</dt>
                    <dd class="flex flex-col gap-1">
                      <label
                        v-for="s in SPACES.filter((x) => x.status === 'live')"
                        :key="s.id"
                        class="flex h-8 cursor-pointer items-center gap-2.5 rounded-control px-1.5 hover:bg-secondary-background"
                      >
                        <Checkbox
                          :model-value="agent.spaceIds.includes(s.id)"
                          :disabled="agent.stage === 'live'"
                          @update:model-value="(v: boolean) => toggleSpace(s.id, v)"
                        />
                        <SpaceMark :brand="s.brand" size="xs" />
                        <span class="flex-1">{{ s.name }}</span>
                        <span class="text-ui text-subtle-foreground">{{ PAYER[s.payer] }}</span>
                      </label>
                    </dd>
                  </dl>
                  <div
                    v-if="agent.stage === 'deploy'"
                    class="flex items-center gap-2 border-t border-border-default px-4 py-3"
                  >
                    <p class="flex-1 text-ui text-subtle-foreground">
                      Clients see it as an app. You can hide or remove it anytime.
                    </p>
                    <Button variant="ghost" size="sm" @click="toast('Tell me what to change')"
                      >Change</Button
                    >
                    <Button
                      variant="primary"
                      size="sm"
                      :disabled="!agent.spaceIds.length"
                      @click="approveDeploy"
                      ><Rocket :size="12" />Approve and deploy</Button
                    >
                  </div>
                </Card>

                <!-- Live -->
                <Card v-else-if="m.artifact === 'live'" class="mt-3 divide-y divide-border-default">
                  <div
                    v-for="id in agent.deployed"
                    :key="id"
                    class="flex items-center gap-3 px-4 py-3"
                  >
                    <SpaceMark :brand="spaceById(id)!.brand" size="sm" />
                    <span class="flex-1 text-ui font-medium">{{ spaceById(id)!.name }}</span>
                    <Button size="sm" @click="go(`space:${id}`)">Manage</Button>
                    <Button size="sm" @click="previewSpace(id)"
                      ><Eye :size="12" />Client view</Button
                    >
                  </div>
                </Card>
              </template>
            </div>
          </div>
        </template>

        <!-- Suggested next steps -->
        <div
          v-if="lastAgent && !lastAgent.pending && suggestions().length"
          class="flex flex-wrap gap-2 pl-10"
        >
          <Button v-for="s in suggestions()" :key="s" size="sm" @click="submit(s)">{{ s }}</Button>
        </div>
      </div>
    </div>

    <!-- Composer: the same prompt box as Home -->
    <div class="px-6 pb-5">
      <PromptBox v-model="text" target chat class="max-w-3xl" @send="submit" />
    </div>
  </div>
</template>

<style scoped>
/* Ideas: lift and straighten a touch on hover (mouse only). */
.idea {
  transition:
    transform 300ms cubic-bezier(0.19, 1, 0.22, 1),
    background-color 150ms ease;
}
@media (hover: hover) and (pointer: fine) {
  .idea:hover {
    background-color: var(--color-card-background-hover);
    z-index: 10 !important;
  }
}
@media (prefers-reduced-motion: reduce) {
  .idea {
    transition: none;
  }
}
</style>
