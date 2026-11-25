<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Plus,
  Upload,
  X
} from 'lucide-vue-next'
import { AgentChat } from '../../icons/agentChat'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { activeInstance } from '../../../useProto'
import { mock, MOCK } from '../../assets/mock'
import { thumb } from '../../../mock'
import { NODE_TYPES, type NodeKind } from '../../graph/canvasData'
import { NODE_ICONS } from '../../graph/nodeIcons'
import {
  closeCreate,
  openTemplate,
  openWorkflow,
  startBlank,
  startWithAgentAsk,
  startWithNode
} from '../createScreen'
import { readiness, searchStarters, SHELVES, type Starter } from '../createStarters'
import { buildOf, graphFor, readyIcon, reducedMotion, useEscapeCloses } from './lookKitB'
import { agentStart, answer, quickPicks, type AgentAnswer } from './v07Agent'
import { agentOpens } from '../agentOpens'
import CreateComposer from './CreateComposer.vue'
import ResultsB from './ResultsB.vue'
import { composerPos } from '../composerPos'
import { createInput } from '../createInput'

type Item =
  | { id: string; type: 'blank' }
  | { id: string; type: 'template'; starter: Starter }
  | { id: string; type: 'workflow'; workflow: ProjectWorkflow }
  | { id: string; type: 'node'; node: NodeKind }

const STAGE_W = 1000
const STAGE_H = 440
const COL_X = [30, 360, 680]
const NODE_W = [230, 230, 300]
const BLANK: Item = { id: 'blank', type: 'blank' }
const YOURS = 'yours'

const query = ref('')
const composer = ref<InstanceType<typeof CreateComposer>>()
const shelf = ref<string>(SHELVES[0]!.id)
const hover = ref(-1)
const pinned = ref(-1)
const at = computed(() => (hover.value >= 0 ? hover.value : pinned.value))
const TABS = [
  { id: 'popular', label: 'Popular' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'edit', label: 'Edit' },
  { id: '3d', label: '3D' },
  { id: 'audio', label: 'Audio' },
  { id: YOURS, label: 'Yours' }
]

const q = computed(() => query.value.trim().toLowerCase())
const workflows = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age))
const tpl = (starter: Starter): Item => ({ id: `t:${starter.id}`, type: 'template', starter })
const wf = (workflow: ProjectWorkflow): Item => ({
  id: `w:${workflow.id}`,
  type: 'workflow',
  workflow
})

const center = computed(() => composerPos.id === 'center')
const dq = computed(() => (center.value ? '' : q.value))
const results = ref<InstanceType<typeof ResultsB>>()

const items = computed<Item[]>(() => {
  if (dq.value) {
    const kinds = (Object.keys(NODE_TYPES) as NodeKind[]).filter((k) =>
      `${NODE_TYPES[k].title} ${NODE_TYPES[k].description}`.toLowerCase().includes(q.value)
    )
    const found = searchStarters(q.value, 8).length
      ? searchStarters(q.value, 8)
      : quickPicks(q.value, 6)
    const rec = last.value?.rec
    const list = rec && !found.some((s) => s.id === rec.id) ? [rec, ...found] : found
    const seen = new Set<string>()
    const unique = list.filter((s) => (seen.has(s.poster) ? false : (seen.add(s.poster), true)))
    return [
      BLANK,
      ...unique.map(tpl),
      ...workflows.value
        .filter((w) => w.name.toLowerCase().includes(q.value))
        .slice(0, 6)
        .map(wf),
      ...kinds.slice(0, 4).map((node): Item => ({ id: `n:${node}`, type: 'node', node }))
    ]
  }
  if (shelf.value === YOURS) return [BLANK, ...workflows.value.slice(0, 10).map(wf)]
  return [BLANK, ...(SHELVES.find((s) => s.id === shelf.value) ?? SHELVES[0]!).starters().map(tpl)]
})
watch([dq, shelf, center], () => {
  hover.value = -1
  pinned.value = -1
  navigated.value = false
  page.value = 0
})

const page = ref(0)
const perPage = computed(() => (center.value ? 8 : 7))
const pages = computed(() => Math.max(1, Math.ceil((items.value.length - 1) / perPage.value)))
const slots = computed(() => [
  ...(center.value ? [] : [{ key: 'blank', index: 0, item: items.value[0] }]),
  ...Array.from({ length: perPage.value }, (_, j) => {
    const index = 1 + page.value * perPage.value + j
    const item = items.value[index]
    return { key: item?.id ?? `empty-${j}`, index, item }
  })
])
watch(pinned, (i) => {
  if (i > 0) page.value = Math.floor((i - 1) / perPage.value)
})

const lastOutput = (w: ProjectWorkflow): string | undefined =>
  MOCK[w.name] ?? (w.thumbId ? thumb(w.thumbId) : undefined)

const navigated = ref(false)
const BUILD_STEP_MS = 700
const TYPE_STEP_MS = 24
let timer: ReturnType<typeof setTimeout> | undefined
let typer: ReturnType<typeof setInterval> | undefined

interface Exchange {
  id: number
  prompt: string
  reply: string
  typed: number
  rec: Starter | null
  choice: string | null
}

const panel = ref(false)
const talk = ref<Exchange[]>([])
const last = computed(() => talk.value.at(-1))
const followUp = ref('')
const panelField = ref<HTMLInputElement>()
const scroller = ref<HTMLElement>()
const build = ref<{ starter: Starter; shown: number; total: number; prompt: string } | null>(null)
const built = computed(() => !!build.value && build.value.shown >= build.value.total)
const agentGraph = computed(() => !!build.value && hover.value < 0)
const recId = computed(() => last.value?.rec?.id)
const heroAway = computed(() => hover.value >= 0 || (agentGraph.value && panel.value))
const heroTop = computed(() => !heroAway.value && !!current.value)

const current = computed<Item | undefined>(() => {
  if (hover.value >= 0) return items.value[hover.value]
  if (build.value) return tpl(build.value.starter)
  return items.value[pinned.value]
})

function stopBuild(): void {
  clearTimeout(timer)
  build.value = null
}

function scrollDown(): void {
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' })
}

function step(): void {
  const b = build.value
  if (!b || b.shown >= b.total) return
  timer = setTimeout(() => {
    if (!build.value) return
    build.value.shown += 1
    step()
    nextTick(scrollDown)
  }, BUILD_STEP_MS)
}

function startBuild(starter: Starter, prompt: string): void {
  stopBuild()
  const total = graphFor(starter).nodes.length
  build.value = { starter, total, prompt, shown: reducedMotion() ? total : 1 }
  step()
}

function replyFor(a: AgentAnswer, prev: Starter | null): { text: string; rec: Starter | null } {
  const rec = a.picks[0] ?? prev
  if (!rec)
    return {
      text: `I couldn’t match “${a.prompt}” to a template yet. You can start blank and add nodes yourself.`,
      rec: null
    }
  const lead = a.understood ? `${a.understood}.` : 'Got it.'
  return {
    text: `${lead} I’d start from ${rec.model} ${rec.makes}, and I’m setting it up on the canvas now.`,
    rec
  }
}

function stream(): void {
  clearInterval(typer)
  typer = setInterval(() => {
    const e = last.value
    if (!e || e.typed >= e.reply.length) {
      clearInterval(typer)
      return
    }
    e.typed = Math.min(e.reply.length, e.typed + 3)
  }, TYPE_STEP_MS)
}

function onAsk(a: AgentAnswer): void {
  if (agentOpens.id === 'comfy') {
    startWithAgentAsk(agentStart(a.prompt))
    return
  }
  const { text, rec } = replyFor(a, last.value?.rec ?? null)
  talk.value.push({
    id: talk.value.length,
    prompt: a.prompt,
    reply: text,
    typed: reducedMotion() ? text.length : 0,
    rec,
    choice: null
  })
  panel.value = true
  hover.value = -1
  pinned.value = -1
  stream()
  if (rec) startBuild(rec, a.prompt)
  nextTick(scrollDown)
}

function refine(): void {
  const text = followUp.value.trim()
  if (!text) return
  followUp.value = ''
  onAsk(answer(text))
}

function changeSomething(): void {
  panelField.value?.focus()
}

function closePanel(): void {
  clearInterval(typer)
  panel.value = false
  composer.value?.focus()
}

onBeforeUnmount(() => {
  clearTimeout(timer)
  clearInterval(typer)
})

const STEP_LABEL: Partial<Record<NodeKind, string>> = {
  image: 'Adding your photo input',
  prompt: 'Adding the prompt',
  output: 'Wiring to Output'
}
const steps = computed(() =>
  build.value
    ? graphFor(build.value.starter).nodes.map((n) => STEP_LABEL[n.kind] ?? `Adding ${n.title}`)
    : []
)

const PLAIN = ['photo', 'image', 'picture', 'pic']
const subject = computed(() => {
  const word = /\bmy ([a-z]+)/i.exec(build.value?.prompt ?? '')?.[1]?.toLowerCase()
  return word && !PLAIN.includes(word) ? word : null
})
const dropLabel = computed(() =>
  subject.value ? `Drop your ${subject.value} photo` : 'Drop your photo'
)
const promptFill = computed(() => {
  const b = build.value
  if (!b) return ''
  if (b.starter.media === 'video')
    return subject.value
      ? `Your ${subject.value}, gentle camera push-in`
      : 'Gentle camera push-in, soft natural light'
  return b.prompt.charAt(0).toUpperCase() + b.prompt.slice(1)
})
const outLabel = computed(() =>
  build.value?.starter.media === 'video' ? 'Your video appears here' : 'Your image appears here'
)

function questionOf(e: Exchange): { label: string; options: string[] } {
  return e.rec?.media === 'video'
    ? { label: 'Length', options: ['5 s', '10 s'] }
    : { label: 'Runs on', options: [activeInstance.value.name, 'Comfy Cloud'] }
}
const choiceOf = (e: Exchange): string => e.choice ?? questionOf(e).options[0]!

function resultLine(e: Exchange): string {
  const rec = e.rec!
  const choice = choiceOf(e)
  const cost =
    choice === 'Comfy Cloud'
      ? 'Runs on Comfy Cloud, nothing to download'
      : readiness(rec.template).label
  const length = choice === '10 s' ? ' · 10 s clip' : ''
  return `${rec.makes} · ${build.value?.total ?? 0} nodes · ${cost}${length}`
}

function nameOf(item: Item): string {
  if (item.type === 'template') return item.starter.makes
  if (item.type === 'workflow') return item.workflow.name
  if (item.type === 'node') return NODE_TYPES[item.node].title
  return 'Blank canvas'
}

function press(i: number): void {
  if (pinned.value === i) pick(items.value[i]!)
  else pinned.value = i
}

function pick(item: Item): void {
  if (item.type === 'template') openTemplate(item.starter.template)
  else if (item.type === 'workflow') openWorkflow(item.workflow)
  else if (item.type === 'node') startWithNode(item.node)
  else startBlank()
}

interface Placed {
  key: string
  kind: NodeKind
  title: string
  left: number
  top: number
  w: number
  h: number
  col: number
}

const heightOf = (kind: NodeKind, col: number): number =>
  col === 2 ? 250 : kind === 'image' ? 150 : kind === 'prompt' ? 104 : 120

const graph = computed(() => {
  const item = current.value
  if (!item || item.type === 'blank') return { nodes: [] as Placed[], wires: [] as string[] }
  if (item.type === 'node') {
    const h = heightOf(item.node, 1)
    return {
      nodes: [
        {
          key: item.node,
          kind: item.node,
          title: NODE_TYPES[item.node].title,
          left: COL_X[1]!,
          top: STAGE_H / 2 - h / 2,
          w: NODE_W[1]!,
          h,
          col: 1
        }
      ],
      wires: []
    }
  }
  const starter =
    item.type === 'template'
      ? item.starter
      : ({ makes: item.workflow.name, model: 'Your workflow', media: 'image' } as Starter)
  const g = graphFor(starter)
  const nodes: Placed[] = g.nodes.map((n, i) => {
    const col = n.x < 300 ? 0 : n.x < 600 ? 1 : 2
    const h = heightOf(n.kind, col)
    return {
      key: `${i}-${n.kind}`,
      kind: n.kind,
      title: n.title,
      left: COL_X[col]!,
      top: n.y + 20 - h / 2,
      w: NODE_W[col]!,
      h,
      col
    }
  })
  const shown = agentGraph.value ? build.value!.shown : nodes.length
  const wires = g.wires
    .filter(([a, b]) => a < shown && b < shown)
    .map(([a, b]) => {
      const s = nodes[a]!
      const t = nodes[b]!
      const x1 = s.left + s.w
      const y1 = s.top + s.h / 2
      const x2 = t.left
      const y2 = t.top + t.h / 2
      const mid = (x1 + x2) / 2
      return `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`
    })
  return { nodes: nodes.slice(0, shown), wires }
})

const pct = (n: number, of: number): string => `${(n / of) * 100}%`
const box = (n: Placed) => ({
  left: pct(n.left, STAGE_W),
  top: pct(n.top, STAGE_H),
  width: pct(n.w, STAGE_W),
  height: pct(n.h, STAGE_H)
})

const outputOf = computed(() => {
  const item = current.value
  if (item?.type === 'template') return { src: item.starter.poster, clip: item.starter.clip }
  if (item?.type === 'workflow') {
    const src = lastOutput(item.workflow)
    return src ? { src, clip: undefined } : undefined
  }
  return undefined
})

const PROMPTS: Record<string, string> = {
  image: 'A ceramic vase on wet marble, morning light, 85mm',
  video: 'Slow push in, wings unfold, soft wind',
  audio: 'Warm lo-fi piano loop, vinyl crackle'
}
const promptOf = computed(() => {
  const item = current.value
  return item?.type === 'template' ? (PROMPTS[item.starter.media] ?? PROMPTS.image) : PROMPTS.image
})

function key(e: KeyboardEvent): void {
  if (center.value && createInput.id === 'search' && query.value.trim() && e.key !== 'Escape') {
    results.value?.key(e)
    return
  }
  const last = items.value.length - 1
  const sideways = !query.value && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')
  if (e.key === 'Escape') {
    if (panel.value) closePanel()
    else if (query.value) query.value = ''
    else closeCreate()
  } else if (e.key === 'Enter') {
    if (current.value) pick(current.value)
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || sideways) {
    hover.value = -1
    navigated.value = true
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight'
    pinned.value = forward ? Math.min(last, at.value + 1) : Math.max(0, at.value - 1)
  } else return
  e.preventDefault()
}

watch(at, (i) =>
  nextTick(() =>
    document
      .querySelector(`[data-v07-at="${i}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  )
)

useEscapeCloses(() => composer.value?.field)
</script>

<template>
  <section class="v07 relative flex h-full min-h-[640px]" aria-label="Create">
    <div class="v07-canvas" aria-hidden="true" />

    <div class="v07-main">
      <button type="button" class="v07-icon-btn v07-close" aria-label="Close" @click="closeCreate">
        <X :size="16" />
      </button>

      <div class="v07-stage-wrap" :class="agentGraph && 'is-agent'">
        <div class="v07-stage">
          <svg
            :key="`w-${current?.id}`"
            class="v07-wires"
            :viewBox="`0 0 ${STAGE_W} ${STAGE_H}`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path v-for="d in graph.wires" :key="d" :d class="v07-wire" />
            <path v-for="d in graph.wires" :key="`p${d}`" :d class="v07-pulse" pathLength="100" />
          </svg>
          <div
            v-for="(n, i) in graph.nodes"
            :key="`${current?.id}-${n.key}`"
            class="v07-node"
            :class="[`is-col${n.col}`, `is-${n.kind}`]"
            :style="[box(n), { '--i': i }]"
          >
            <p class="v07-node-head">
              <component :is="NODE_ICONS[n.kind]" :size="12" />
              <span class="truncate">{{ n.title }}</span>
            </p>
            <div v-if="n.col === 2" class="v07-out" :class="agentGraph && 'is-empty'">
              <p v-if="agentGraph" class="v07-out-empty">{{ outLabel }}</p>
              <template v-else-if="outputOf">
                <img :src="outputOf.src" alt="" />
                <video
                  v-if="outputOf.clip"
                  :key="outputOf.clip"
                  :src="outputOf.clip"
                  muted
                  loop
                  playsinline
                  autoplay
                  class="motion-reduce:hidden"
                />
              </template>
              <WorkflowCover
                v-else-if="current?.type === 'workflow'"
                :name="current.workflow.name"
              />
            </div>
            <div v-else-if="n.kind === 'image' && agentGraph" class="v07-drop">
              <Upload :size="16" />
              <span>{{ dropLabel }}</span>
            </div>
            <img
              v-else-if="n.kind === 'image'"
              :src="mock('asset-actor-ref')"
              alt=""
              class="v07-in-pic"
            />
            <p v-else-if="n.kind === 'prompt'" class="v07-prompt">
              {{ agentGraph ? promptFill : promptOf }}
            </p>
            <div v-else class="v07-widgets">
              <span><i>steps</i><b>20</b></span>
              <span><i>cfg</i><b>4.0</b></span>
              <span><i>seed</i><b>randomize</b></span>
            </div>
          </div>
          <p v-if="current?.type === 'blank'" class="v07-empty">
            An empty canvas on {{ activeInstance.name }}. Double-click to add your first node.
          </p>
        </div>

        <p v-if="!current && !center" class="v07-empty is-hint">
          Point at a template to preview it here
        </p>
        <div v-if="center" class="v07-hero" :class="[heroAway && 'is-away', heroTop && 'is-top']">
          <CreateComposer
            ref="composer"
            v-model="query"
            class="v07-hero-field"
            :mode="createInput.id"
            :navigated
            hero
            placeholder="Search or describe what you want to make…"
            external
            @key="key"
            @ask="onAsk"
          />
          <div v-if="createInput.id === 'search' && query.trim()" class="v07-hero-drop">
            <ResultsB ref="results" :query />
          </div>
          <button v-else-if="!heroTop" type="button" class="v07-hero-blank" @click="startBlank">
            <Plus :size="14" />Start with a blank canvas
          </button>
        </div>
        <aside
          v-if="current && !agentGraph"
          :key="`d-${current.id}`"
          class="v07-detail"
          aria-live="polite"
        >
          <template v-if="current.type === 'template'">
            <p class="v07-detail-title">{{ current.starter.makes }}</p>
            <p class="v07-detail-sub">{{ current.starter.model }}</p>
            <p class="v07-detail-line">{{ current.starter.line }}.</p>
            <p class="v07-ready" :class="`is-${readiness(current.starter.template).tone}`">
              <component
                :is="readyIcon(readiness(current.starter.template))"
                v-if="readiness(current.starter.template).tone !== 'off'"
                :size="13"
              />
              {{ readiness(current.starter.template).label }}
            </p>
          </template>
          <template v-else-if="current.type === 'workflow'">
            <p class="v07-detail-title">{{ current.workflow.name }}</p>
            <p class="v07-detail-sub">
              {{ buildOf(current.workflow)?.name }}, edited
              {{ current.workflow.modified.toLowerCase() }}
            </p>
          </template>
          <template v-else-if="current.type === 'node'">
            <p class="v07-detail-title">{{ NODE_TYPES[current.node].title }}</p>
            <p class="v07-detail-line">{{ NODE_TYPES[current.node].description }}.</p>
          </template>
          <template v-else>
            <p class="v07-detail-title">Blank canvas</p>
            <p class="v07-detail-line">Build it yourself, node by node.</p>
          </template>
          <button type="button" class="v07-go" @click="pick(current)">
            {{
              current.type === 'template'
                ? 'Use template'
                : current.type === 'workflow'
                  ? 'Open workflow'
                  : 'Start'
            }}
            <CornerDownLeft :size="13" class="opacity-60" />
          </button>
        </aside>
      </div>

      <div class="v07-dock-wrap">
        <div class="v07-band">
          <div class="v07-bar">
            <CreateComposer
              v-if="!center"
              ref="composer"
              v-model="query"
              class="v07-composer"
              :mode="createInput.id"
              :navigated
              card-at="above"
              external
              @key="key"
              @ask="onAsk"
            />
            <p v-else class="v07-stuck">Or start from something</p>
            <nav v-if="!dq" class="v07-shelves" aria-label="Dock shows">
              <button
                v-for="t in TABS"
                :key="t.id"
                type="button"
                class="v07-tab"
                :class="shelf === t.id && 'is-on'"
                :aria-pressed="shelf === t.id"
                @click="shelf = t.id"
              >
                {{ t.label }}
              </button>
            </nav>
            <span v-if="pages > 1" class="v07-pager">
              <button
                type="button"
                class="v07-icon-btn"
                aria-label="Previous"
                :disabled="page === 0"
                @click="page--"
              >
                <ChevronLeft :size="15" />
              </button>
              <button
                type="button"
                class="v07-icon-btn"
                aria-label="Next"
                :disabled="page >= pages - 1"
                @click="page++"
              >
                <ChevronRight :size="15" />
              </button>
            </span>
          </div>
          <div class="v07-dock" aria-label="Starting points">
            <template v-for="slot in slots" :key="slot.key">
              <button
                v-if="slot.item"
                type="button"
                class="v07-tile group"
                :class="[
                  slot.index === hover && 'is-at',
                  slot.index === pinned && 'is-on',
                  slot.item.type === 'template' && slot.item.starter.id === recId && 'is-rec',
                  `is-${slot.item.type}`
                ]"
                :aria-pressed="slot.index === pinned"
                :data-v07-at="slot.index"
                @pointerenter="hover = slot.index"
                @pointerleave="hover = -1"
                @focus="hover = slot.index"
                @blur="hover = -1"
                @click="press(slot.index)"
              >
                <span class="v07-tile-pic">
                  <img
                    v-if="slot.item.type === 'template'"
                    :src="slot.item.starter.poster"
                    alt=""
                    loading="lazy"
                  />
                  <template v-else-if="slot.item.type === 'workflow'">
                    <img
                      v-if="lastOutput(slot.item.workflow)"
                      :src="lastOutput(slot.item.workflow)"
                      alt=""
                      loading="lazy"
                    />
                    <WorkflowCover v-else :name="slot.item.workflow.name" />
                  </template>
                  <component
                    :is="NODE_ICONS[slot.item.node]"
                    v-else-if="slot.item.type === 'node'"
                    :size="18"
                  />
                  <Plus v-else :size="18" />
                </span>
                <span class="v07-tile-name">{{ nameOf(slot.item) }}</span>
              </button>
              <span v-else class="v07-tile is-empty" aria-hidden="true">
                <span class="v07-tile-pic" />
              </span>
            </template>
          </div>
        </div>
      </div>
    </div>

    <Transition name="v07-dock">
      <aside v-if="panel" class="v07-agent" aria-label="Agent">
        <header class="v07-agent-head">
          <AgentChat :size="15" />
          <span>Agent</span>
          <button type="button" class="v07-icon-btn" aria-label="Close agent" @click="closePanel">
            <X :size="14" />
          </button>
        </header>
        <div ref="scroller" class="v07-agent-log" aria-live="polite">
          <template v-for="(e, i) in talk" :key="e.id">
            <p class="v07-msg-user">{{ e.prompt }}</p>
            <div class="v07-msg">
              <span class="v07-msg-avatar"><AgentChat :size="13" /></span>
              <div class="v07-msg-body">
                <p>{{ e.reply.slice(0, e.typed) }}</p>
                <template v-if="i === talk.length - 1 && build && e.rec">
                  <ol class="v07-steps">
                    <li
                      v-for="(label, k) in steps"
                      :key="label"
                      :class="k < build.shown ? 'is-done' : k === build.shown ? 'is-active' : ''"
                    >
                      <Check v-if="k < build.shown" :size="12" />
                      <i v-else class="v07-step-dot" />
                      {{ label }}
                    </li>
                  </ol>
                  <div v-if="built" class="v07-result">
                    <p class="v07-result-line">{{ resultLine(e) }}</p>
                    <div class="v07-acts">
                      <button
                        type="button"
                        class="v07-act is-primary"
                        @click="openTemplate(e.rec.template)"
                      >
                        Use this workflow
                      </button>
                      <button type="button" class="v07-act" @click="changeSomething">
                        Change something
                      </button>
                    </div>
                    <div class="v07-choice">
                      <span>{{ questionOf(e).label }}</span>
                      <button
                        v-for="o in questionOf(e).options"
                        :key="o"
                        type="button"
                        :class="choiceOf(e) === o && 'is-on'"
                        :aria-pressed="choiceOf(e) === o"
                        @click="e.choice = o"
                      >
                        {{ o }}
                      </button>
                    </div>
                  </div>
                </template>
                <button
                  v-else-if="!e.rec && e.typed >= e.reply.length"
                  type="button"
                  class="v07-act"
                  @click="startBlank"
                >
                  Start blank
                </button>
              </div>
            </div>
          </template>
        </div>
        <form class="v07-agent-foot" @submit.prevent="refine">
          <input
            ref="panelField"
            v-model="followUp"
            type="text"
            placeholder="Ask for a change…"
            aria-label="Ask the agent for a change"
          />
          <button
            type="submit"
            class="v07-agent-send"
            aria-label="Send"
            :disabled="!followUp.trim()"
          >
            <ArrowUp :size="14" />
          </button>
        </form>
      </aside>
    </Transition>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v07-agent > * {
  min-width: 352px;
}
:root .proto-ui.proto-ui.proto-ui .v07-dock-enter-active,
:root .proto-ui.proto-ui.proto-ui .v07-dock-leave-active {
  overflow: hidden;
  transition: width 280ms var(--ease-out-expo);
}
:root .proto-ui.proto-ui.proto-ui .v07-dock-enter-from,
:root .proto-ui.proto-ui.proto-ui .v07-dock-leave-to {
  width: 0;
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v07-dock-enter-active,
  :root .proto-ui.proto-ui.proto-ui .v07-dock-leave-active {
    transition: none;
  }
}
:root .proto-ui.proto-ui.proto-ui .v07 {
  isolation: isolate;
  overflow: hidden;
}
:root .proto-ui.proto-ui.proto-ui .v07-canvas {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    radial-gradient(ellipse 60% 55% at 50% 45%, transparent, var(--color-content-background) 95%),
    radial-gradient(
        color-mix(in oklch, var(--color-base-foreground) 12%, transparent) 1px,
        transparent 1.4px
      )
      0 0 / 24px 24px,
    var(--color-content-background);
}
:root .proto-ui.proto-ui.proto-ui .v07-icon-btn {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-icon-btn:hover {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 3;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-control);
}
:root .proto-ui.proto-ui.proto-ui .v07-stage-wrap.is-agent {
  padding-right: 48px;
}
:root .proto-ui.proto-ui.proto-ui .v07-composer + .v07-pager {
  margin-left: auto;
}
:root .proto-ui.proto-ui.proto-ui .v07-hero {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 0 32px;
  pointer-events: none;
  transition:
    opacity 260ms ease,
    transform 320ms var(--ease-out-expo);
}
:root .proto-ui.proto-ui.proto-ui .v07-hero > * {
  pointer-events: auto;
}
:root .proto-ui.proto-ui.proto-ui .v07-hero.is-away {
  opacity: 0;
  transform: translateY(-16px);
}
:root .proto-ui.proto-ui.proto-ui .v07-hero.is-away > * {
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v07-hero.is-top {
  justify-content: flex-start;
  padding-top: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v07-hero-field {
  width: min(640px, 100%);
}
:root .proto-ui.proto-ui.proto-ui .v07-hero-drop {
  width: min(860px, 100%);
  max-height: min(460px, 52vh);
  overflow-y: auto;
  padding: 10px;
  border-radius: var(--radius-panel);
  background: color-mix(in oklch, var(--color-card-background) 94%, transparent);
  box-shadow:
    inset 0 0 0 1px var(--color-border-default),
    var(--shadow-popover);
  backdrop-filter: blur(var(--blur-glass));
  scrollbar-width: thin;
}
:root .proto-ui.proto-ui.proto-ui .v07-hero-blank {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border-radius: 999px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v07-hero-blank:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-stuck {
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v07-hero {
    transition: none;
  }
}
:root .proto-ui.proto-ui.proto-ui .v07-main {
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
:root .proto-ui.proto-ui.proto-ui .v07-agent {
  display: flex;
  width: 380px;
  flex: none;
  flex-direction: column;
  border-left: 1px solid var(--color-border-default);
  background: color-mix(
    in oklch,
    var(--color-base-foreground) 2.5%,
    var(--color-content-background)
  );
  overflow: hidden;
}
:root .proto-ui.proto-ui.proto-ui .v07-agent-head {
  display: flex;
  height: 52px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 18px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v07-agent-head > span {
  flex: 1;
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-agent-log {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding: 8px 18px 18px;
  scrollbar-width: thin;
}
:root .proto-ui.proto-ui.proto-ui .v07-msg-user {
  align-self: flex-end;
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 14px 14px 4px 14px;
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  line-height: 19px;
}
:root .proto-ui.proto-ui.proto-ui .v07-msg {
  display: flex;
  gap: 10px;
}
:root .proto-ui.proto-ui.proto-ui .v07-msg-avatar {
  display: grid;
  width: 26px;
  height: 26px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-msg-body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding-top: 3px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  line-height: 20px;
}
:root .proto-ui.proto-ui.proto-ui .v07-steps {
  display: flex;
  align-self: stretch;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v07-steps li {
  display: flex;
  align-items: center;
  gap: 8px;
}
:root .proto-ui.proto-ui.proto-ui .v07-steps li.is-done {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-steps li.is-done svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v07-steps li.is-active {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-step-dot {
  width: 12px;
  height: 12px;
  flex: none;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1.5px currentColor;
  opacity: 0.6;
}
:root .proto-ui.proto-ui.proto-ui .v07-steps li.is-active .v07-step-dot {
  animation: v07-blink 1s ease-in-out infinite;
}
:root .proto-ui.proto-ui.proto-ui .v07-result {
  display: flex;
  align-self: stretch;
  flex-direction: column;
  gap: 12px;
  animation: v07-fade 300ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .v07-result-line {
  color: var(--color-base-foreground);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v07-choice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v07-choice > span {
  margin-right: 4px;
}
:root .proto-ui.proto-ui.proto-ui .v07-choice button {
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v07-choice button.is-on {
  background: var(--color-secondary-background-hover);
  box-shadow: inset 0 0 0 1px var(--color-border-strong);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
:root .proto-ui.proto-ui.proto-ui .v07-act {
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v07-act:hover {
  background: var(--color-secondary-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v07-act.is-primary {
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v07-act.is-primary:hover {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v07-agent-foot {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  margin: 0 14px 16px;
  padding: 0 6px 0 14px;
  height: 44px;
  border-radius: 999px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v07-agent-foot:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v07-agent-foot input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-base-foreground);
  font: inherit;
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v07-agent-foot input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-agent-send {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-agent-send:disabled {
  opacity: 0.3;
}
:root .proto-ui.proto-ui.proto-ui .v07-drop {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0 6px 6px;
  border-radius: 8px;
  outline: 1.5px dashed var(--color-border-strong);
  outline-offset: -1.5px;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v07-out.is-empty {
  display: grid;
  place-items: center;
}
:root .proto-ui.proto-ui.proto-ui .v07-out-empty {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-rec .v07-tile-pic {
  opacity: 1;
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
@keyframes v07-blink {
  50% {
    opacity: 0.2;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v07-agent,
  :root .proto-ui.proto-ui.proto-ui .v07-result,
  :root .proto-ui.proto-ui.proto-ui .v07-steps li.is-active .v07-step-dot {
    animation: none;
  }
}
:root .proto-ui.proto-ui.proto-ui .v07-stage-wrap {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 48px 300px 8px 48px;
}
:root .proto-ui.proto-ui.proto-ui .v07-stage {
  position: relative;
  width: 100%;
  max-width: 900px;
  max-height: 100%;
  aspect-ratio: 1000 / 440;
}
:root .proto-ui.proto-ui.proto-ui .v07-wires {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
:root .proto-ui.proto-ui.proto-ui .v07-wire,
:root .proto-ui.proto-ui.proto-ui .v07-pulse {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
:root .proto-ui.proto-ui.proto-ui .v07-wire {
  stroke: color-mix(in oklch, var(--color-base-foreground) 22%, transparent);
  animation: v07-fade 400ms ease both 120ms;
}
:root .proto-ui.proto-ui.proto-ui .v07-pulse {
  stroke: color-mix(in oklch, var(--color-base-foreground) 70%, transparent);
  stroke-dasharray: 5 95;
  animation: v07-flow 2.6s linear infinite;
}
:root .proto-ui.proto-ui.proto-ui .v07-node {
  position: absolute;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-card-background) 72%, transparent);
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 12%, transparent),
    0 16px 40px -20px oklch(0 0 0 / 0.7);
  backdrop-filter: blur(6px);
  animation: v07-ghost 420ms var(--ease-out-expo) both;
  animation-delay: calc(var(--i, 0) * 60ms);
}
:root .proto-ui.proto-ui.proto-ui .v07-node.is-col2 {
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 22%, transparent),
    0 30px 60px -24px oklch(0 0 0 / 0.8);
}
:root .proto-ui.proto-ui.proto-ui .v07-node-head {
  display: flex;
  height: 30px;
  flex: none;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v07-out {
  position: relative;
  min-height: 0;
  flex: 1;
  margin: 0 6px 6px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v07-out > img,
:root .proto-ui.proto-ui.proto-ui .v07-out > video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v07-in-pic {
  min-height: 0;
  flex: 1;
  margin: 0 6px 6px;
  border-radius: 8px;
  object-fit: cover;
  opacity: 0.8;
}
:root .proto-ui.proto-ui.proto-ui .v07-prompt {
  margin: 0 6px 6px;
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  font-size: 12px;
  line-height: 17px;
}
:root .proto-ui.proto-ui.proto-ui .v07-widgets {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 6px 6px;
}
:root .proto-ui.proto-ui.proto-ui .v07-widgets span {
  display: flex;
  height: 22px;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-radius: 6px;
  background: var(--color-secondary-background);
  font-size: 11px;
}
:root .proto-ui.proto-ui.proto-ui .v07-widgets i {
  color: var(--color-subtle-foreground);
  font-style: normal;
}
:root .proto-ui.proto-ui.proto-ui .v07-widgets b {
  color: var(--color-muted-foreground);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v07-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v07-detail {
  position: absolute;
  top: 50%;
  right: 32px;
  display: flex;
  width: 248px;
  flex-direction: column;
  align-items: flex-start;
  padding: 18px;
  border-radius: var(--radius-panel);
  background: color-mix(in oklch, var(--color-card-background) 86%, transparent);
  box-shadow:
    inset 0 0 0 1px var(--color-border-default),
    var(--shadow-popover);
  backdrop-filter: blur(var(--blur-glass));
  transform: translateY(-50%);
  animation: v07-fade 240ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .v07-detail-title {
  color: var(--color-base-foreground);
  font-size: var(--text-heading);
  font-weight: 600;
  line-height: 22px;
}
:root .proto-ui.proto-ui.proto-ui .v07-detail-sub {
  margin-top: 2px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v07-detail-line {
  margin-top: 10px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  line-height: 19px;
}
:root .proto-ui.proto-ui.proto-ui .v07-ready {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v07-ready.is-ready svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v07-ready.is-off {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-go {
  display: inline-flex;
  height: 36px;
  align-self: stretch;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: var(--text-ui);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v07-go:hover {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v07-composer {
  flex: 0 1 420px;
  --cc-gap: 42px;
}
:root .proto-ui.proto-ui.proto-ui .v07-bar {
  display: flex;
  align-items: center;
  gap: 24px;
}
:root .proto-ui.proto-ui.proto-ui .v07-bar .v07-shelves {
  margin-left: auto;
}
:root .proto-ui.proto-ui.proto-ui .v07-count {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v07-detail-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v07-go.is-quiet {
  margin-top: 8px;
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-go.is-quiet:hover {
  background: var(--color-secondary-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v07-dock-wrap {
  flex: none;
  padding: 14px 32px 18px;
  border-top: 1px solid var(--color-border-default);
  background: color-mix(
    in oklch,
    var(--color-base-foreground) 2.5%,
    var(--color-content-background)
  );
}
:root .proto-ui.proto-ui.proto-ui .v07-band {
  position: relative;
  display: flex;
  max-width: 1280px;
  flex-direction: column;
  gap: 14px;
  margin: 0 auto;
}
:root .proto-ui.proto-ui.proto-ui .v07-pager {
  display: inline-flex;
  flex: none;
  gap: 2px;
}
:root .proto-ui.proto-ui.proto-ui .v07-pager button:disabled {
  opacity: 0.35;
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .v07-shelves {
  display: flex;
  max-width: 100%;
  gap: 18px;
  overflow-x: auto;
  scrollbar-width: none;
}
:root .proto-ui.proto-ui.proto-ui .v07-tab {
  flex: none;
  padding: 3px 0;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-weight: 500;
  transition: color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v07-tab:hover,
:root .proto-ui.proto-ui.proto-ui .v07-tab.is-on {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-tab.is-on {
  box-shadow: inset 0 -2px 0 var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-dock {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v07-tile {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v07-tile-pic {
  display: grid;
  width: 100%;
  aspect-ratio: 16 / 10;
  place-items: center;
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  opacity: 0.7;
  transition:
    opacity 160ms ease,
    transform 220ms var(--ease-out-expo),
    box-shadow 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-at .v07-tile-pic,
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-on .v07-tile-pic,
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-blank .v07-tile-pic {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-at .v07-tile-pic {
  transform: translateY(-3px);
}
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-on .v07-tile-pic {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-tile:focus-visible .v07-tile-pic {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-blank .v07-tile-pic {
  background:
    radial-gradient(
        color-mix(in oklch, var(--color-base-foreground) 16%, transparent) 1px,
        transparent 1.4px
      )
      0 0 / 10px 10px,
    var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-tile-pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v07-tile-name {
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-at .v07-tile-name,
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-on .v07-tile-name {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v07-tile.is-empty .v07-tile-pic {
  background: transparent;
  outline: 1px dashed var(--color-border-default);
  outline-offset: -1px;
}
:root .proto-ui.proto-ui.proto-ui .v07-empty.is-hint {
  animation: v07-fade 400ms ease both;
}
@keyframes v07-ghost {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
}
@keyframes v07-fade {
  from {
    opacity: 0;
  }
}
@keyframes v07-flow {
  from {
    stroke-dashoffset: 100;
  }
  to {
    stroke-dashoffset: 0;
  }
}
@media (max-width: 1100px) {
  :root .proto-ui.proto-ui.proto-ui .v07-stage-wrap {
    padding-right: 48px;
  }
  :root .proto-ui.proto-ui.proto-ui .v07-detail {
    top: 12px;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v07-node,
  :root .proto-ui.proto-ui.proto-ui .v07-wire,
  :root .proto-ui.proto-ui.proto-ui .v07-detail,
  :root .proto-ui.proto-ui.proto-ui .v07-pulse {
    animation: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v07-pulse {
    display: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v07-tile-pic,
  :root .proto-ui.proto-ui.proto-ui .v07-tile-name {
    transition: none;
  }
}
</style>
