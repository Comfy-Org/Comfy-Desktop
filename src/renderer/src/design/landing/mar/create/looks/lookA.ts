import { computed, onBeforeUnmount, onMounted, ref, watch, type Component, type Ref } from 'vue'
import { Plus, Search } from 'lucide-vue-next'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { activeInstance, instanceById, instances, proto, requireLogin } from '../../../useProto'
import { thumb, type Template } from '../../../mock'
import { NODE_TYPES, type NodeKind } from '../../graph/canvasData'
import { NODE_ICONS } from '../../graph/nodeIcons'
import { recentsCover } from '../../cover'
import { HUB_WORKFLOWS, type HubWorkflow } from '../../explore/hubWorkflows'
import { fmtGb, targetFor, totalGb } from '../../templateModal/templateData'
import { closeCreate, openTemplate, openWorkflow, startBlank, startWithNode } from '../createScreen'
import { readiness, searchStarters, SHELVES, starterOf, type Starter } from '../createStarters'

export type Hit =
  | { id: string; type: 'workflow'; workflow: ProjectWorkflow }
  | { id: string; type: 'template'; starter: Starter }
  | { id: string; type: 'node'; node: NodeKind }
  | { id: string; type: 'blank' }

const KINDS = Object.keys(NODE_TYPES) as NodeKind[]
export const BLANK_HIT: Hit = { id: 'blank', type: 'blank' }

export const workflowHit = (workflow: ProjectWorkflow): Hit => ({
  id: `workflow:${workflow.id}`,
  type: 'workflow',
  workflow
})
export const templateHit = (starter: Starter): Hit => ({
  id: `template:${starter.id}`,
  type: 'template',
  starter
})

export const sortedWorkflows = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age))

export function pickHit(hit: Hit): void {
  if (hit.type === 'workflow') openWorkflow(hit.workflow)
  else if (hit.type === 'template') openTemplate(hit.starter.template)
  else if (hit.type === 'node') startWithNode(hit.node)
  else startBlank()
}

export const buildOf = (w: ProjectWorkflow) => (w.envId ? instanceById(w.envId) : undefined)
export const hueOf = (w: ProjectWorkflow): string => `--h: ${buildOf(w)?.hue ?? 250}`
export const workflowPicture = (w: ProjectWorkflow): string | undefined =>
  recentsCover.id === 'image' ? thumb(w.thumbId) : undefined

export function hitTitle(hit: Hit): string {
  if (hit.type === 'workflow') return hit.workflow.name
  if (hit.type === 'template') return hit.starter.makes
  if (hit.type === 'node') return NODE_TYPES[hit.node].title
  return 'Blank canvas'
}

export function hitMeta(hit: Hit): string {
  if (hit.type === 'workflow') return buildOf(hit.workflow)?.name ?? ''
  if (hit.type === 'template') return hit.starter.model
  if (hit.type === 'node') return NODE_TYPES[hit.node].description
  return `Empty canvas on ${activeInstance.value.name}`
}

export const hitIcon = (hit: Hit): Component =>
  hit.type === 'node' ? NODE_ICONS[hit.node] : hit.type === 'blank' ? Plus : Search

export function useCreateSearch(query: Ref<string>) {
  const at = ref(0)
  const q = computed(() => query.value.trim().toLowerCase())
  const matches = (text: string): boolean => text.toLowerCase().includes(q.value)

  const sections = computed<{ title: string; hits: Hit[] }[]>(() => {
    if (!q.value) return []
    return [
      {
        title: 'Workflows',
        hits: sortedWorkflows.value
          .filter((w) => matches(w.name))
          .slice(0, 5)
          .map(workflowHit)
      },
      { title: 'Templates', hits: searchStarters(q.value, 5).map(templateHit) },
      {
        title: 'Nodes',
        hits: KINDS.filter((k) => matches(`${NODE_TYPES[k].title} ${NODE_TYPES[k].description}`))
          .slice(0, 4)
          .map((node): Hit => ({ id: `node:${node}`, type: 'node', node }))
      },
      { title: '', hits: [BLANK_HIT] }
    ].filter((s) => s.hits.length)
  })

  const flat = computed(() => sections.value.flatMap((s) => s.hits))
  const found = computed(() => flat.value.some((h) => h.type !== 'blank'))
  const current = computed(() => flat.value[at.value])
  const indexOf = (hit: Hit): number => flat.value.findIndex((h) => h.id === hit.id)
  watch(q, () => (at.value = 0))

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') at.value = Math.min(flat.value.length - 1, at.value + 1)
    else if (e.key === 'ArrowUp') at.value = Math.max(0, at.value - 1)
    else if (e.key === 'Enter' && q.value && current.value) pickHit(current.value)
    else if (e.key === 'Escape') {
      if (query.value) query.value = ''
      else closeCreate()
    } else return
    e.preventDefault()
  }

  const point = (hit: Hit): void => {
    at.value = indexOf(hit)
  }

  return { q, at, sections, flat, found, current, indexOf, point, onKey }
}

export type CreateSearch = ReturnType<typeof useCreateSearch>

export function useCreateEscape(field: Ref<HTMLInputElement | undefined>, focus = true): void {
  function onWindowKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && document.activeElement !== field.value) closeCreate()
  }
  onMounted(() => {
    if (focus) field.value?.focus({ preventScroll: true })
    window.addEventListener('keydown', onWindowKey)
  })
  onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKey))
}

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function playIn(el: EventTarget | Element | null | undefined): void {
  if (reducedMotion()) return
  const video = (el as Element | null)?.querySelector?.('video')
  if (video) void video.play().catch(() => undefined)
}

export function stopIn(el: EventTarget | Element | null | undefined): void {
  const video = (el as Element | null)?.querySelector?.('video')
  if (!video) return
  video.pause()
  video.currentTime = 0
}

export const prefersReducedMotion = reducedMotion

export const shelfStarters = (id: string, max = 7): Starter[] =>
  (SHELVES.find((s) => s.id === id) ?? SHELVES[0]!).starters().slice(0, max)

export const hubStarters = (filter: (w: HubWorkflow) => boolean, max: number): Starter[] =>
  HUB_WORKFLOWS.filter(filter)
    .sort((a, b) => b.usage - a.usage)
    .slice(0, max)
    .map((w) => starterOf(w))

export const cloudInstance = computed(() => instances.value.find((i) => i.kind === 'cloud'))

export interface Cost {
  local: { tone: 'ready' | 'fetch' | 'off'; label: string; gb: number; minutes: number }
  cloud?: { label: string; credits: string; signIn: boolean }
}

export function costOf(t: Template): Cost {
  const r = readiness(t)
  const gb = totalGb(t)
  const minutes = Math.max(1, Math.round(gb / 5))
  const local = {
    tone: r.tone,
    label:
      r.tone === 'ready'
        ? 'Ready'
        : r.tone === 'fetch'
          ? `${fmtGb(gb)} · ~${minutes} min`
          : r.label,
    gb,
    minutes
  }
  const cloud = cloudInstance.value
  if (!cloud || activeInstance.value.kind === 'cloud') return { local }
  const target = targetFor(t, cloud, proto.signedIn)
  if (target.state === 'cloud')
    return { local, cloud: { label: 'Run on Cloud now', credits: target.cost, signIn: false } }
  if (target.state === 'login')
    return { local, cloud: { label: 'Run on Cloud now', credits: 'Free credits', signIn: true } }
  return { local }
}

export function runOnCloud(t: Template): void {
  const cloud = cloudInstance.value
  if (!cloud) return
  if (!proto.signedIn) {
    requireLogin()
    return
  }
  proto.activeInstanceId = cloud.id
  openTemplate(t)
}

export const runsThisWeek = (usage: number): string => {
  const n = Math.round(usage / 9)
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`
}
