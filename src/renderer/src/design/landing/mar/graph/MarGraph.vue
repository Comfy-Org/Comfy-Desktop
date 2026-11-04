<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
  type Component
} from 'vue'
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Copy,
  Group as GroupIcon,
  Hand,
  History,
  Images,
  Keyboard,
  Lock,
  LockOpen,
  Map as MapIcon,
  Maximize,
  Minus,
  PanelRight,
  PanelsTopLeft,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Redo2,
  Search,
  Settings,
  CircleSlash,
  EyeOff,
  Trash2,
  Undo2,
  X
} from 'lucide-vue-next'
import {
  ComfyAssets,
  ComfyModel,
  ComfyNode,
  ComfyTemplate,
  ComfyWorkflow
} from '../icons/comfyIcons'
import { onCloud } from '../shell/surface'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import Tooltip from '../../ui/Tooltip.vue'
import { proto } from '../../useProto'
import { graphStyle } from './graphStyle'
import { brandMotif } from '../brand/brandMotif'
import MarTrio from '../brand/MarTrio.vue'
import CanvasNode from './CanvasNode.vue'
import AssetsPanel from './AssetsPanel.vue'
import JobsPanel from './panels/JobsPanel.vue'
import NodesPanel from './panels/NodesPanel.vue'
import ModelsPanel from './panels/ModelsPanel.vue'
import ModelBrowser from './panels/ModelBrowser.vue'
import WorkflowsPanel from './panels/WorkflowsPanel.vue'
import ShortcutsPanel from './panels/ShortcutsPanel.vue'
import TemplatesDialog from './panels/TemplatesDialog.vue'
import SettingsDialog from './panels/SettingsDialog.vue'
import NodeSearch from './NodeSearch.vue'
import MediaViewer from './MediaViewer.vue'
import AgentPanel from './AgentPanel.vue'
import {
  CANVAS_GEOMETRY,
  SOCKETS,
  canvasNodeHeight,
  nodeWidth,
  settingsOpen,
  createCanvas,
  createNode,
  uid,
  socketY,
  type Group,
  type Link,
  type NodeKind,
  type Recipe,
  type SNode,
  type SocketType
} from './canvasData'
import { createMockEngine, type RunEngine, type RunGraph, type RunJob } from './runEngine'
import { savedAssets } from './savedAssets'

/**
 * ComfyUI's graph editor as a mock, in Mar's proposal (a build's tab): a
 * simpler layer over ComfyUI (Node Banana's approach: few nodes, results on
 * the nodes, workflows as nodes). Two looks: Glass, the Home's language
 * (translucent borderless nodes on a calm dot grid), and Current, ComfyUI
 * as it looks today (frontend v1) in the same new structure.
 *
 * It works as an editor: the canvas pans (drag the background) and zooms
 * (wheel, the zoom pill); nodes move by their title; a double-click, "/" or
 * the rail's Nodes adds one; sockets wire by dragging (dropped on empty
 * canvas, the link offers the nodes that take it); shift-drag selects
 * several, to group, run, duplicate or delete; a locked group is skipped
 * by runs; undo and redo cover every edit; the agent builds workflows from
 * words; assets drop in as Image nodes.
 */
const { workflow = 'portrait-sun' } = defineProps<{ workflow?: string }>()

const current = computed(() => graphStyle.id === 'current')
const cg = computed(() => CANVAS_GEOMETRY[graphStyle.id])
const start = createCanvas()
const sNodes = reactive<SNode[]>(start.nodes)
const links = reactive<Link[]>(start.links)
const groups = reactive<Group[]>(start.groups)
const sById = computed(() => Object.fromEntries(sNodes.map((n) => [n.id, n])))
const selection = ref<string[]>([])
const selectedLink = ref('')
const isSel = (id: string): boolean => selection.value.includes(id)

/** Every node's box: the world and the minimap. */
const boxes = computed(() => sNodes.map((n) => ({ node: n, h: canvasNodeHeight(n, cg.value) })))

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(50, Math.abs(x2 - x1) * 0.45)
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
}

const paths = computed(() =>
  links.flatMap((l) => {
    const from = sById.value[l.from]
    const to = sById.value[l.to]
    const out = from?.outs[l.out]
    if (!from || !to || !out) return []
    const x1 = from.x + nodeWidth(from)
    const y1 = socketY(from, l.out, cg.value)
    const x2 = to.x
    const y2 = socketY(to, l.in, cg.value)
    return [
      {
        id: l.id,
        d: curve(x1, y1, x2, y2),
        mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
        color: SOCKETS[out.type],
        // The link into what is running carries the run.
        live: to.state === 'running' || to.state === 'paused'
      }
    ]
  })
)

/** The graph's extent, for framing it and the minimap. */
const bounds = computed(() => {
  if (!boxes.value.length) return { x: 0, y: 0, w: 900, h: 560 }
  const x0 = Math.min(...boxes.value.map((b) => b.node.x)) - 40
  const y0 = Math.min(...boxes.value.map((b) => b.node.y)) - 40
  const x1 = Math.max(...boxes.value.map((b) => b.node.x + b.node.w)) + 40
  const y1 = Math.max(...boxes.value.map((b) => b.node.y + b.h)) + 40
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
})
// The world the links are drawn in: from the origin to the far corner.
const world = computed(() => ({
  w: Math.max(1, bounds.value.x + bounds.value.w),
  h: Math.max(1, bounds.value.y + bounds.value.h)
}))

// The view: pan (x, y) and zoom (k), in the canvas's CSS pixels.
const view = reactive({ x: 0, y: 0, k: 0.9 })
const host = ref<HTMLElement>()
const canvas = ref<HTMLElement>()
const size = reactive({ w: 0, h: 0 })
/** How much of the tab sits under what is drawn above it (the title bar,
 *  or the browser's bar on Comfy Cloud), so nothing hides there. */
const top = ref(0)
/** The screen simulator scales the whole app; pointer maths undoes it. */
let screenScale = 1

function measure(): void {
  const el = host.value
  const cv = canvas.value
  if (!el || !cv) return
  const r = el.getBoundingClientRect()
  screenScale = r.height / (el.offsetHeight || 1) || 1
  let under = 0
  for (const bar of document.querySelectorAll('.proto-ui > .glass-titlebar, .mar-cloud-bar')) {
    const b = bar.getBoundingClientRect()
    if (b.height) under = Math.max(under, (b.bottom - r.top) / screenScale)
  }
  top.value = Math.round(under)
  size.w = cv.offsetWidth
  size.h = cv.offsetHeight
}

/** Frames the graph: as large as fits, never tiny; if it can't fit, the
 *  start of the graph (its inputs) stays in view. */
function fit(): void {
  measure()
  const pad = current.value
    ? { l: 24, t: 64, r: 24, b: 64 }
    : { l: 84, t: top.value + 80, r: 32, b: 72 }
  // Leave room under the run block while its job rows are open.
  if (jobsOpen.value) pad.t += current.value ? 200 : 220
  const b = bounds.value
  const aw = size.w - pad.l - pad.r
  const ah = size.h - pad.t - pad.b
  const k = Math.min(1, Math.max(0.5, Math.min(aw / b.w, ah / b.h)))
  view.k = k
  view.x = pad.l + Math.max(0, (aw - b.w * k) / 2) - b.x * k
  view.y = pad.t + Math.max(0, (ah - b.h * k) / 2) - b.y * k
}

function zoomAt(k: number, cx = size.w / 2, cy = size.h / 2): void {
  const nk = Math.min(2, Math.max(0.3, k))
  view.x = cx - ((cx - view.x) * nk) / view.k
  view.y = cy - ((cy - view.y) * nk) / view.k
  view.k = nk
}

function local(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = canvas.value!.getBoundingClientRect()
  return { x: (e.clientX - r.left) / screenScale, y: (e.clientY - r.top) / screenScale }
}
const toWorld = (p: { x: number; y: number }): { x: number; y: number } => ({
  x: (p.x - view.x) / view.k,
  y: (p.y - view.y) / view.k
})

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  const p = local(e)
  zoomAt(view.k * Math.exp(-e.deltaY * 0.0015), p.x, p.y)
}

// ── History: every edit can be undone. A snapshot of the graph, without
// what runs leave on it. ──
const past: string[] = []
const future: string[] = []
const canUndo = ref(false)
const canRedo = ref(false)
const freeze = (): string =>
  JSON.stringify({
    nodes: sNodes.map((n) => ({ ...n, state: undefined, step: undefined, steps: undefined })),
    links,
    groups
  })
let last = freeze()
let textTimer: ReturnType<typeof setTimeout> | undefined
function commit(): void {
  const now = freeze()
  if (now === last) return
  past.push(last)
  if (past.length > 80) past.shift()
  future.length = 0
  last = now
  canUndo.value = true
  canRedo.value = false
}
function restore(snap: string): void {
  const s = JSON.parse(snap) as { nodes: SNode[]; links: Link[]; groups: Group[] }
  const runState = new Map(sNodes.map((n) => [n.id, n.state]))
  sNodes.splice(0, sNodes.length, ...s.nodes.map((n) => ({ ...n, state: runState.get(n.id) })))
  links.splice(0, links.length, ...s.links)
  groups.splice(0, groups.length, ...s.groups)
  selection.value = selection.value.filter((id) => sById.value[id])
  last = snap
}
function undo(): void {
  const snap = past.pop()
  if (!snap) return
  future.push(freeze())
  restore(snap)
  canUndo.value = past.length > 0
  canRedo.value = true
}
function redo(): void {
  const snap = future.pop()
  if (!snap) return
  past.push(freeze())
  restore(snap)
  canUndo.value = true
  canRedo.value = future.length > 0
}

// ── Pointer: pan, move, wire, select. ──
const tool = ref<'select' | 'hand'>('select')
interface Wire {
  node: string
  side: 'in' | 'out'
  index: number
  type: SocketType
}
type Drag =
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'nodes'; x: number; y: number; moved: boolean }
  | { kind: 'group'; id: string; nodes: string[]; x: number; y: number; moved: boolean }
  | { kind: 'wire'; wire: Wire }
  | { kind: 'marquee'; x0: number; y0: number }
let drag: Drag | undefined
/** Nodes being moved: the selection's toolbox steps aside meanwhile. */
const moving = ref(false)
/** The link being drawn, its loose end in world coordinates. */
const wiring = ref<Wire & { x: number; y: number }>()
const marquee = ref<{ x: number; y: number; w: number; h: number }>()

const wirePath = computed(() => {
  const w = wiring.value
  if (!w) return ''
  const n = sById.value[w.node]!
  const sy = socketY(n, w.index, cg.value)
  return w.side === 'out' ? curve(n.x + nodeWidth(n), sy, w.x, w.y) : curve(w.x, w.y, n.x, sy)
})

function select(id: string, add: boolean): void {
  selectedLink.value = ''
  if (add)
    selection.value = isSel(id) ? selection.value.filter((x) => x !== id) : [...selection.value, id]
  else if (!isSel(id)) selection.value = [id]
}

function onDown(e: PointerEvent): void {
  if (e.button !== 0) return
  menu.value = undefined
  runMenu.value = false
  const t = e.target as HTMLElement
  const p = local(e)
  const free = tool.value === 'select'
  const socket = free ? t.closest<HTMLElement>('[data-socket]') : null
  if (socket) {
    const id = socket.dataset.socketNode!
    const side = socket.dataset.socket as 'in' | 'out'
    const index = Number(socket.dataset.socketIndex)
    const n = sById.value[id]!
    let wire: Wire = { node: id, side, index, type: (side === 'in' ? n.ins : n.outs)[index]!.type }
    // Grabbing a wired input picks its link back up, from its source.
    const held = side === 'in' && links.find((l) => l.to === id && l.in === index)
    if (held) {
      links.splice(links.indexOf(held), 1)
      const src = sById.value[held.from]!
      wire = { node: held.from, side: 'out', index: held.out, type: src.outs[held.out]!.type }
    }
    const w = toWorld(p)
    wiring.value = { ...wire, ...w }
    drag = { kind: 'wire', wire }
    canvas.value!.setPointerCapture(e.pointerId)
    return
  }
  const groupHead = free ? t.closest<HTMLElement>('[data-group-head]') : null
  if (groupHead) {
    if (t.closest('button, input')) return
    const g = groups.find((x) => x.id === groupHead.dataset.groupHead)!
    drag = { kind: 'group', id: g.id, nodes: inGroup(g), ...p, moved: false }
    canvas.value!.setPointerCapture(e.pointerId)
    return
  }
  const node = free ? t.closest<HTMLElement>('[data-node]') : null
  if (node) {
    select(node.dataset.node!, e.shiftKey || e.metaKey)
    if (!t.closest('[data-node-head]') || t.closest('button')) return
    drag = { kind: 'nodes', ...p, moved: false }
    canvas.value!.setPointerCapture(e.pointerId)
    return
  }
  if (t.closest('[data-link]')) return
  selectedLink.value = ''
  if (free && e.shiftKey) {
    drag = { kind: 'marquee', x0: p.x, y0: p.y }
    marquee.value = { x: p.x, y: p.y, w: 0, h: 0 }
  } else {
    selection.value = []
    drag = { kind: 'pan', ...p }
  }
  canvas.value!.setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent): void {
  if (!drag) return
  const p = local(e)
  if (drag.kind === 'wire') {
    Object.assign(wiring.value!, toWorld(p))
    return
  }
  if (drag.kind === 'marquee') {
    marquee.value = {
      x: Math.min(drag.x0, p.x),
      y: Math.min(drag.y0, p.y),
      w: Math.abs(p.x - drag.x0),
      h: Math.abs(p.y - drag.y0)
    }
    return
  }
  const dx = p.x - drag.x
  const dy = p.y - drag.y
  drag.x = p.x
  drag.y = p.y
  if (drag.kind === 'pan') {
    view.x += dx
    view.y += dy
  } else if (drag.kind === 'nodes') {
    drag.moved = true
    moving.value = true
    for (const id of selection.value) {
      const n = sById.value[id]!
      n.x += dx / view.k
      n.y += dy / view.k
    }
  } else {
    drag.moved = true
    const g = groups.find((x) => x.id === (drag as { id: string }).id)!
    g.x += dx / view.k
    g.y += dy / view.k
    for (const id of drag.nodes) {
      const n = sById.value[id]!
      n.x += dx / view.k
      n.y += dy / view.k
    }
  }
}

function onUp(e: PointerEvent): void {
  const d = drag
  drag = undefined
  moving.value = false
  if (!d) return
  if (d.kind === 'wire') {
    const w = wiring.value!
    wiring.value = undefined
    const hit = (
      document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    )?.closest<HTMLElement>('[data-socket]')
    if (hit) {
      connect(d.wire, {
        node: hit.dataset.socketNode!,
        side: hit.dataset.socket as 'in' | 'out',
        index: Number(hit.dataset.socketIndex)
      })
      commit()
    } else {
      // Dropped on empty canvas: offer the nodes that take it.
      pending = d.wire
      openMenu(local(e), { type: d.wire.type, side: d.wire.side }, { x: w.x, y: w.y })
      commit()
    }
    return
  }
  if (d.kind === 'marquee') {
    const m = marquee.value!
    marquee.value = undefined
    const a = toWorld({ x: m.x, y: m.y })
    const b = toWorld({ x: m.x + m.w, y: m.y + m.h })
    const hit = boxes.value
      .filter(({ node: n, h }) => n.x < b.x && n.x + n.w > a.x && n.y < b.y && n.y + h > a.y)
      .map(({ node: n }) => n.id)
    selection.value = [...new Set([...selection.value, ...hit])]
    return
  }
  if ((d.kind === 'nodes' || d.kind === 'group') && d.moved) commit()
}

function onDouble(e: MouseEvent): void {
  const t = e.target as HTMLElement
  if (t.closest('[data-node], [data-group-head], [data-link]')) return
  const p = local(e)
  pending = undefined
  openMenu(p, undefined, toWorld(p))
}

// ── Wiring. ──
/** Every node upstream of a node: what feeds it, and what feeds those. */
function upstream(id: string): string[] {
  const out: string[] = []
  const walk = (to: string): void => {
    for (const l of links)
      if (l.to === to && !out.includes(l.from)) {
        out.push(l.from)
        walk(l.from)
      }
  }
  walk(id)
  return out
}
function downstream(id: string): string[] {
  const out: string[] = []
  const walk = (from: string): void => {
    for (const l of links)
      if (l.from === from && !out.includes(l.to)) {
        out.push(l.to)
        walk(l.to)
      }
  }
  walk(id)
  return out
}

/** Wires an output to an input of the same type; an input takes one link. */
function connect(a: Wire, b: { node: string; side: 'in' | 'out'; index: number }): boolean {
  if (a.side === b.side || a.node === b.node) return false
  const from = a.side === 'out' ? a : b
  const to = a.side === 'out' ? b : a
  const src = sById.value[from.node]!
  const dst = sById.value[to.node]!
  if (src.outs[from.index]?.type !== dst.ins[to.index]?.type) return false
  // No loops: what it feeds can't feed it.
  if (upstream(from.node).includes(to.node)) return false
  const old = links.findIndex((l) => l.to === to.node && l.in === to.index)
  if (old >= 0) links.splice(old, 1)
  links.push({ id: uid('link'), from: from.node, out: from.index, to: to.node, in: to.index })
  edited(dst)
  return true
}

function removeLink(id: string): void {
  const l = links.find((x) => x.id === id)
  if (!l) return
  links.splice(links.indexOf(l), 1)
  selectedLink.value = ''
  edited(sById.value[l.to]!)
  commit()
}

// ── Adding nodes: the search menu. ──
const menu = ref<{
  x: number
  y: number
  fit?: { type: SocketType; side: 'in' | 'out' }
  at: { x: number; y: number }
}>()
/** A link dropped on empty canvas, waiting for the node it will wire to. */
let pending: Wire | undefined
function openMenu(
  p: { x: number; y: number },
  fitTo: { type: SocketType; side: 'in' | 'out' } | undefined,
  at: { x: number; y: number }
): void {
  menu.value = {
    x: Math.max(8, Math.min(p.x, size.w - 310)),
    y: Math.max(8, Math.min(p.y, size.h - 430)),
    fit: fitTo,
    at
  }
}
function openMenuAtCentre(): void {
  pending = undefined
  const p = { x: size.w / 2 - 150, y: Math.max(top.value + 80, size.h / 2 - 200) }
  openMenu(p, undefined, toWorld({ x: size.w / 2, y: size.h / 2 }))
}

function add(kind: NodeKind): void {
  const at = menu.value!.at
  menu.value = undefined
  const g = cg.value
  // A node from a dropped link sits with its socket under the drop.
  const n = createNode(kind, at.x, at.y - g.head - g.gap - g.slot / 2)
  if (pending?.side === 'in') n.x = at.x - n.w
  sNodes.push(n)
  if (pending) {
    const list = pending.side === 'out' ? n.ins : n.outs
    const index = list.findIndex((s) => s.type === pending!.type)
    if (index >= 0)
      connect(pending, { node: n.id, side: pending.side === 'out' ? 'in' : 'out', index })
  }
  pending = undefined
  selection.value = [n.id]
  commit()
}

/** The agent's workflow, placed below what is already there. */
function build(recipe: Recipe): void {
  const b = bounds.value
  const x0 = sNodes.length ? b.x + 40 : 40
  const y0 = sNodes.length ? b.y + b.h + 60 : 60
  const ids: Record<string, string> = {}
  for (const r of recipe.nodes) {
    const n = createNode(r.kind, x0 + r.dx, y0 + r.dy)
    if (r.text !== undefined) n.text = r.text
    ids[r.key] = n.id
    sNodes.push(n)
  }
  for (const [a, ai, b2, bi] of recipe.links)
    links.push({ id: uid('link'), from: ids[a]!, out: ai, to: ids[b2]!, in: bi })
  selection.value = Object.values(ids)
  commit()
  nextTick(() => frame(selection.value))
}

/** Brings some nodes into view. */
function frame(ids: string[]): void {
  const bs = boxes.value.filter((b) => ids.includes(b.node.id))
  if (!bs.length) return
  const x0 = Math.min(...bs.map((b) => b.node.x))
  const y0 = Math.min(...bs.map((b) => b.node.y))
  const x1 = Math.max(...bs.map((b) => b.node.x + b.node.w))
  const y1 = Math.max(...bs.map((b) => b.node.y + b.h))
  const k = Math.min(
    1,
    Math.max(0.5, Math.min((size.w - 160) / (x1 - x0), (size.h - top.value - 200) / (y1 - y0)))
  )
  view.k = k
  view.x = size.w / 2 - ((x0 + x1) / 2) * k
  view.y = top.value + (size.h - top.value) / 2 - ((y0 + y1) / 2) * k
}

// ── Selection actions. ──
function remove(ids: string[]): void {
  if (!ids.length) return
  for (const id of ids) {
    for (const d of downstream(id)) edited(sById.value[d]!)
    const i = sNodes.findIndex((n) => n.id === id)
    if (i >= 0) sNodes.splice(i, 1)
  }
  for (let i = links.length - 1; i >= 0; i--)
    if (ids.includes(links[i]!.from) || ids.includes(links[i]!.to)) links.splice(i, 1)
  selection.value = []
  commit()
}

/** Copies nodes, and the links between them, a step down and right. */
function duplicate(ids: string[]): void {
  const map: Record<string, string> = {}
  for (const id of ids) {
    const n = sById.value[id]
    if (!n) continue
    const copy: SNode = JSON.parse(JSON.stringify(n))
    copy.id = uid(n.kind)
    copy.x += 40
    copy.y += 40
    copy.state = undefined
    map[id] = copy.id
    sNodes.push(copy)
  }
  for (const l of [...links])
    if (map[l.from] && map[l.to])
      links.push({ ...l, id: uid('link'), from: map[l.from]!, to: map[l.to]! })
  selection.value = Object.values(map)
  commit()
}

let clipboard: string[] = []

/** Groups the selection in a frame. */
function groupSelection(): void {
  const bs = boxes.value.filter((b) => isSel(b.node.id))
  if (!bs.length) return
  const x0 = Math.min(...bs.map((b) => b.node.x)) - 28
  const y0 = Math.min(...bs.map((b) => b.node.y)) - 52
  const x1 = Math.max(...bs.map((b) => b.node.x + b.node.w)) + 28
  const y1 = Math.max(...bs.map((b) => b.node.y + b.h)) + 28
  groups.push({
    id: uid('group'),
    title: `Group ${groups.length + 1}`,
    x: x0,
    y: y0,
    w: x1 - x0,
    h: y1 - y0,
    locked: false
  })
  selection.value = []
  commit()
}
/** The nodes whose middle sits inside a group. */
function inGroup(g: Group): string[] {
  return boxes.value
    .filter(({ node: n, h }) => {
      const cx = n.x + n.w / 2
      const cy = n.y + h / 2
      return cx > g.x && cx < g.x + g.w && cy > g.y && cy < g.y + g.h
    })
    .map(({ node: n }) => n.id)
}
const lockedIds = computed(() => new Set(groups.filter((g) => g.locked).flatMap(inGroup)))
function toggleLock(g: Group): void {
  g.locked = !g.locked
  commit()
}
function ungroup(g: Group): void {
  groups.splice(groups.indexOf(g), 1)
  commit()
}

/** Where the selection's toolbar floats: above it, in canvas pixels. */
const selectionBar = computed(() => {
  if (!selection.value.length || moving.value) return undefined
  const bs = boxes.value.filter((b) => isSel(b.node.id))
  if (!bs.length) return undefined
  const x0 = Math.min(...bs.map((b) => b.node.x))
  const x1 = Math.max(...bs.map((b) => b.node.x + b.node.w))
  const y0 = Math.min(...bs.map((b) => b.node.y))
  // It rides above the nodes, and leaves with them when they scroll
  // under the top of the canvas, as ComfyUI's toolbox does.
  const y = view.y + y0 * view.k - 52
  if (y < top.value + 8) return undefined
  return { x: view.x + ((x0 + x1) / 2) * view.k, y }
})

// ── Keyboard, while the graph is in front and nothing is being typed. ──
function onKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement
  if (t.closest('input, textarea, [contenteditable="true"]')) return
  if (!host.value?.isConnected) return
  const mod = e.metaKey || e.ctrlKey
  const k = e.key.toLowerCase()
  if (mod && k === 'z') (e.shiftKey ? redo : undo)()
  else if (mod && k === 'y') redo()
  else if (mod && k === 'a') selection.value = sNodes.map((n) => n.id)
  else if (mod && k === 'd') duplicate(selection.value)
  else if (mod && k === 'c') clipboard = [...selection.value]
  else if (mod && k === 'v') duplicate(clipboard.filter((id) => sById.value[id]))
  else if (mod && k === 'g') groupSelection()
  else if (mod && k === 'enter') run()
  else if (mod && k === 'b') setMode(selection.value, 'bypass')
  else if (mod && k === 'm') setMode(selection.value, 'mute')
  else if (e.altKey && e.code === 'KeyC') collapse(selection.value)
  else if (k === 'backspace' || k === 'delete') {
    if (selectedLink.value) removeLink(selectedLink.value)
    else remove(selection.value)
  } else if (k === '/') openMenuAtCentre()
  else if (mod && e.shiftKey && k === 'k') shortcuts.value = !shortcuts.value
  else if (mod && k === ',') openSettings()
  else if (!mod && !e.altKey && k === 'n') onRail('nodes')
  else if (!mod && !e.altKey && k === 'm') onRail('models')
  else if (!mod && !e.altKey && k === 'w') onRail('workflows')
  else if (!mod && !e.altKey && k === 'a') onRail('assets')
  else if (k === 'escape') {
    if (panel.value || shortcuts.value) {
      panel.value = ''
      shortcuts.value = false
    }
    menu.value = undefined
    selection.value = []
    selectedLink.value = ''
  } else return
  e.preventDefault()
}

// ── Files and assets dropped on the canvas become Image nodes. ──
// While one is over the canvas, `dropping` lights the target (brand motif).
const dropping = ref(false)
function onDragOver(e: DragEvent): void {
  const types = e.dataTransfer?.types ?? []
  dropping.value = types.includes('Files') || types.includes('text/x-mg-asset')
}
function onDragLeave(e: DragEvent): void {
  if (!canvas.value?.contains(e.relatedTarget as Node | null)) dropping.value = false
}
function onDrop(e: DragEvent): void {
  dropping.value = false
  const dt = e.dataTransfer
  if (!dt) return
  const at = toWorld(local(e))
  // A node dragged from the Nodes panel lands where it is dropped.
  const kind = dt.getData('text/x-mg-node') as NodeKind
  if (kind) {
    e.preventDefault()
    pending = undefined
    menu.value = { x: 0, y: 0, at }
    add(kind)
    return
  }
  const asset = dt.getData('text/x-mg-asset')
  const file = [...dt.files].find((f) => f.type.startsWith('image/'))
  const src = asset || (file ? URL.createObjectURL(file) : '')
  if (!src) return
  e.preventDefault()
  const n = createNode('image', at.x - 125, at.y - 140)
  n.image = src
  n.chip = dt.getData('text/x-mg-name') || file?.name || 'image'
  sNodes.push(n)
  selection.value = [n.id]
  commit()
}

// Minimap: the whole graph, with the part in view framed. A click there
// centres the view on that spot.
const MAP_W = 196
const showMap = ref(true)
const mapView = computed(() => ({
  x: -view.x / view.k,
  y: -view.y / view.k,
  w: size.w / view.k,
  h: size.h / view.k
}))
function onMap(e: MouseEvent): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const wx = bounds.value.x + ((e.clientX - r.left) / r.width) * bounds.value.w
  const wy = bounds.value.y + ((e.clientY - r.top) / r.height) * bounds.value.h
  view.x = size.w / 2 - wx * view.k
  view.y = size.h / 2 - wy * view.k
}

let ro: ResizeObserver | undefined
onMounted(async () => {
  // The browser's bar on Cloud mounts beside the graph: measure after it.
  await nextTick()
  fit()
  // On a narrow window the minimap would sit over the graph: start closed.
  showMap.value = size.w >= 1200
  ro = new ResizeObserver(() => {
    const was = size.w
    measure()
    if (Math.abs(was - size.w) > 40) fit()
  })
  ro.observe(host.value!)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('keydown', onKey)
})

// Switching look changes the geometry and the layout; switching surface
// adds or drops the browser's bar: frame it again.
watch(
  () => [graphStyle.id, onCloud.value],
  () => nextTick(fit)
)
// ── The rail's panels (ComfyUI's sidebar tabs): one open at a time
// beside the rail; Templates, Settings and Cloud's Model Library open as
// dialogs; Shortcuts as a panel along the bottom. ──
type RailPanelId = '' | 'queue' | 'assets' | 'nodes' | 'models' | 'workflows' | 'apps'
const panel = ref<RailPanelId>('')
const dialog = ref<'' | 'templates' | 'settings' | 'models'>('')
const settingsAt = ref<string>()
const shortcuts = ref(false)
const assets = computed({
  get: () => panel.value === 'assets',
  set: (on: boolean) => {
    if (on) panel.value = 'assets'
    else if (panel.value === 'assets') panel.value = ''
  }
})
/** The workflow on show: the tab's, or one opened from Workflows. */
const shownWorkflow = ref(workflow)
const agent = ref(false)
// The Agent and a rail panel share the left edge: one at a time.
watch(panel, (id) => id && (agent.value = false))
watch(agent, (on) => on && (panel.value = ''))
const viewing = ref<string>()

// ── Running. The UI only talks to the engine (runEngine.ts): today a mock
// on timers, later ComfyUI's queue. The graph opens idle: nothing runs and
// nothing waits until Run is pressed. ──
const engine: RunEngine = createMockEngine()
/** The runs in the queue, the running one first, as the engine reports. */
const jobs = ref<RunJob[]>([])
/** Runs per press of Run (the action bar's stepper). */
const batch = ref(1)
/** Runs finished this session (Results in the job rows). */
const results = ref(0)
/** The graph opens with the job rows folded; the pill opens them. */
const jobsOpen = ref(false)
const runMenu = ref(false)

const activeJob = computed(() =>
  jobs.value.find((j) => j.status === 'running' || j.status === 'paused')
)
const waiting = computed(() => jobs.value.filter((j) => j.status === 'queued'))

/** What a run is given: the nodes' values as they are now, without the
 *  ones in locked groups (and only `only`, when given). */
function snapshot(only?: string[]): RunGraph {
  const keep = sNodes.filter(
    (n) => !lockedIds.value.has(n.id) && !n.mode && (!only || only.includes(n.id))
  )
  const ids = new Set(keep.map((n) => n.id))
  return {
    title: workflow,
    nodes: keep.map((n) => {
      const params: Record<string, string> = {}
      for (const c of n.controls) if (c.kind !== 'button') params[c.key] = String(c.value)
      if (n.text !== undefined) params.text = n.text
      if (n.image) params.image = n.image
      if (n.video) params.video = n.video
      if (n.chip) params.chip = n.chip
      return { id: n.id, kind: n.kind, title: n.title, ins: n.ins.map((s) => s.name), params }
    }),
    links: passThrough().filter((l) => ids.has(l.from) && ids.has(l.to))
  }
}

/** The links a run follows: a bypassed node hands its first input of the
 *  output's type straight on, as ComfyUI does; a muted one stops there. */
function passThrough(): Link[] {
  const source = (
    from: string,
    out: number,
    seen = new Set<string>()
  ): Link['from'] | undefined => {
    const n = sById.value[from]
    if (!n || n.mode !== 'bypass') return from
    if (seen.has(from)) return undefined
    seen.add(from)
    const type = n.outs[out]?.type
    const inLink = links.find((l) => l.to === from && n.ins[l.in]?.type === type)
    return inLink ? source(inLink.from, inLink.out, seen) : undefined
  }
  const outOf = (from: string, out: number): number => {
    const n = sById.value[from]
    if (!n || n.mode !== 'bypass') return out
    const type = n.outs[out]?.type
    const inLink = links.find((l) => l.to === from && n.ins[l.in]?.type === type)
    return inLink ? outOf(inLink.from, inLink.out) : out
  }
  return links.flatMap((l) => {
    const from = source(l.from, l.out)
    return from ? [{ ...l, from, out: outOf(l.from, l.out) }] : []
  })
}

/** A job row's second line: where it is, or its place in the queue. */
function jobSub(job: RunJob): string {
  if (job.status === 'paused') return 'Paused · waiting for you'
  if (job.status === 'running') {
    const at = job.nodeId ? sById.value[job.nodeId]?.title : undefined
    return `${at ? `${at} · ` : ''}${Math.round(job.progress * 100)}%`
  }
  const place = waiting.value.indexOf(job)
  return place === 0 ? 'Queued · next up' : `Queued · #${place + 1}`
}

function run(): void {
  runMenu.value = false
  if (sNodes.length) engine.queue(snapshot(), batch.value)
}
/** Runs some nodes and what they need. */
function runOnly(ids: string[]): void {
  runMenu.value = false
  if (!ids.length) return
  engine.queue(snapshot([...new Set([...ids, ...ids.flatMap(upstream)])]), batch.value)
}

/** What a run costs, roughly, in credits (Node Banana's cost indicator). */
const COST: Partial<Record<NodeKind, number>> = {
  generate: 4,
  generateVideo: 30,
  generateAudio: 2,
  llm: 1,
  removeBg: 1,
  upscale: 2,
  workflow: 6
}
const cost = computed(
  () =>
    sNodes.filter((n) => !lockedIds.value.has(n.id)).reduce((s, n) => s + (COST[n.kind] ?? 0), 0) *
    batch.value
)

function param(n: SNode, key: string): string {
  const c = n.controls.find((x) => x.key === key)
  return c && c.kind !== 'button' ? String(c.value) : ''
}

/** Shows one of a node's results. */
function pick(n: SNode, i: number): void {
  const r = n.history[i]
  if (!r) return
  n.pick = i
  if (r.src) n.image = r.src
  if (r.text !== undefined && n.kind !== 'promptConstructor') n.text = r.text
}

/** Inputs and the Pause hand on what they hold: no results of their own. */
const INPUTS = new Set<NodeKind>(['prompt', 'image', 'video', 'audio', 'pause'])
let settle: ReturnType<typeof setTimeout> | undefined
const offEngine = engine.on((e) => {
  if (e.type === 'job') {
    const i = jobs.value.findIndex((j) => j.id === e.job.id)
    if (i < 0) jobs.value.push(e.job)
    else jobs.value[i] = e.job
    if (e.job.status === 'done') results.value++
    clearTimeout(settle)
  } else if (e.type === 'removed') {
    jobs.value = jobs.value.filter((j) => j.id !== e.jobId)
    // Back to idle: the Done marks fade after a moment.
    if (!jobs.value.length)
      settle = setTimeout(() => {
        for (const n of sNodes) if (n.state === 'done') n.state = undefined
      }, 4000)
  } else if (e.type === 'node') {
    const n = sById.value[e.nodeId]
    if (!n) return
    n.state = e.state === 'idle' ? undefined : e.state
    n.step = e.step
    n.steps = e.steps
    n.error = e.error
  } else {
    const n = sById.value[e.nodeId]
    if (!n || INPUTS.has(n.kind)) return
    const v = e.value
    n.stale = false
    if (n.kind === 'compare') {
      if (v.pair) n.pair = v.pair
      return
    }
    n.history.push({ src: v.src, text: v.text, run: e.run })
    n.pick = n.history.length - 1
    if (v.src) n.image = v.src
    if (n.kind === 'generateVideo') n.video = undefined
    if (v.text !== undefined && n.kind !== 'promptConstructor') n.text = v.text
    n.cutout = v.cutout
    if (n.kind === 'generate') n.chip = `${param(n, 'aspect')} · ${param(n, 'resolution')}`
    if (n.kind === 'output') n.chip = `Run ${e.run}`
  }
})
watch(
  () => jobs.value.length,
  (len) => !len && (jobsOpen.value = false)
)

// ── Editing. Values are the graph's own; changing one makes the results
// that depend on it out of date until the next run. ──
const HOLDS_RESULT = new Set<NodeKind>([
  'generate',
  'generateVideo',
  'generateAudio',
  'llm',
  'removeBg',
  'upscale',
  'workflow',
  'compare',
  'gallery',
  'output'
])
/** Settings that change how a result is kept or where it runs, not what it is. */
const NO_STALE = new Set(['format', 'runsOn'])

function edited(n: SNode, key?: string): void {
  if (key && NO_STALE.has(key)) return
  for (const id of [n.id, ...downstream(n.id)]) {
    const d = sById.value[id]
    if (!d) continue
    if (d.state === 'error') d.state = undefined
    const made = d.history.length > 0 || (d.image && d.kind !== 'image')
    if (HOLDS_RESULT.has(d.kind) && made && d.state !== 'running' && d.state !== 'queued')
      d.stale = true
  }
}

function setControl(n: SNode, key: string, value: string | number): void {
  const c = n.controls.find((x) => x.key === key)
  if (!c || c.kind === 'button' || c.value === value) return
  ;(c as { value: string | number }).value = value
  edited(n, key)
  commit()
}

function setText(n: SNode, text: string): void {
  n.text = text
  edited(n)
  clearTimeout(textTimer)
  textTimer = setTimeout(commit, 600)
}

function act(n: SNode, key: string): void {
  if (key === 'save') save(n)
  else if (key === 'collapse') collapse([n.id])
  else if (key === 'settings') {
    // Remembered per node: once you open or fold them, they stay so.
    n.settings = !settingsOpen(n)
    commit()
  } else if (key === 'run') runOnly([n.id])
  else if (key === 'duplicate') duplicate([n.id])
  else if (key === 'delete') remove([n.id])
}

// Bypass (Ctrl+B), mute (Ctrl+M) and collapse (Alt+C), as in ComfyUI: on
// the selection, and back off when every node already has it.
function setMode(ids: string[], mode: 'bypass' | 'mute'): void {
  const ns = ids.map((id) => sById.value[id]).filter((n): n is SNode => !!n)
  if (!ns.length) return
  const off = ns.every((n) => n.mode === mode)
  for (const n of ns) n.mode = off ? undefined : mode
  commit()
}
function collapse(ids: string[]): void {
  const ns = ids.map((id) => sById.value[id]).filter((n): n is SNode => !!n)
  if (!ns.length) return
  const open = ns.every((n) => n.collapsed)
  for (const n of ns) n.collapsed = !open
  commit()
}
const allBypassed = computed(
  () =>
    !!selection.value.length && selection.value.every((id) => sById.value[id]?.mode === 'bypass')
)

// Save to Assets: the picture joins the assets, with a toast.
const toast = ref<{ text: string; image?: string }>()
let toastTimer: ReturnType<typeof setTimeout> | undefined
let saves = 0
function save(n: SNode): void {
  if (!n.image) return
  savedAssets.unshift({ name: `${workflow}-${++saves}`, src: n.image })
  toast.value = { text: 'Saved to Assets', image: n.image }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = undefined), 3200)
}

// Another workflow in this tab: a fresh graph, nothing running.
watch(
  () => workflow,
  () => {
    engine.cancelAll()
    const fresh = createCanvas()
    sNodes.splice(0, sNodes.length, ...fresh.nodes)
    links.splice(0, links.length, ...fresh.links)
    groups.splice(0, groups.length, ...fresh.groups)
    past.length = 0
    future.length = 0
    last = freeze()
    canUndo.value = canRedo.value = false
    nextTick(fit)
  }
)
onBeforeUnmount(() => {
  offEngine()
  engine.dispose()
  clearTimeout(settle)
  clearTimeout(toastTimer)
  clearTimeout(textTimer)
})

// The rail as ComfyUI's SideToolbar orders it; shortcuts are its defaults
// (platform/keybindings/defaults.ts).
const RAIL: {
  id: Exclude<RailPanelId, ''> | 'templates'
  icon: Component
  label: string
  keys?: string
}[] = [
  { id: 'queue', icon: History, label: 'Job History' },
  { id: 'assets', icon: ComfyAssets, label: 'Assets', keys: 'A' },
  { id: 'nodes', icon: ComfyNode, label: 'Nodes', keys: 'N' },
  { id: 'models', icon: ComfyModel, label: 'Models', keys: 'M' },
  { id: 'workflows', icon: ComfyWorkflow, label: 'Workflows', keys: 'W' },
  { id: 'apps', icon: PanelsTopLeft, label: 'Apps' },
  { id: 'templates', icon: ComfyTemplate, label: 'Templates' }
]
const tip = (label: string, keys?: string): string => (keys ? `${label} (${keys})` : label)
/** Out of the graph, back to the app's Home: the Comfy logo, as at the
 *  top of ComfyUI's sidebar. */
function goHome(): void {
  proto.activeTab = 'home'
}
function onRail(id: (typeof RAIL)[number]['id']): void {
  menu.value = undefined
  if (id === 'templates') dialog.value = 'templates'
  // Comfy Cloud opens its Model Library as the Asset Browser dialog.
  else if (id === 'models' && onCloud.value) dialog.value = 'models'
  else panel.value = panel.value === id ? '' : id
}
const railOn = (id: string): boolean =>
  panel.value === id ||
  (id === 'templates' && dialog.value === 'templates') ||
  (id === 'models' && dialog.value === 'models')
function openSettings(at?: string): void {
  settingsAt.value = at
  dialog.value = 'settings'
}
/** A node from the Nodes panel: in the middle of the view. */
function addFromPanel(kind: NodeKind): void {
  pending = undefined
  menu.value = { x: 0, y: 0, at: toWorld({ x: size.w / 2, y: size.h / 2 }) }
  add(kind)
}
</script>

<template>
  <div
    ref="host"
    class="mg"
    :class="[`is-${graphStyle.id}`, (panel || agent) && 'has-panel']"
    :style="{ '--mg-top': `${top}px` }"
  >
    <!-- Current: ComfyUI's top bar, its menu and its workflow tabs. -->
    <div v-if="current" class="mg-topbar">
      <Tooltip content="Home" side="bottom">
        <button type="button" class="mg-logo" aria-label="Home" @click="goHome">
          <ComfyCLogo class="mg-logo-mark" />
        </button>
      </Tooltip>
      <span class="mg-tab is-on">{{ shownWorkflow }}<X :size="12" /></span>
      <span class="mg-tab">Untitled<X :size="12" /></span>
      <Plus :size="14" class="mg-tab-add" />
    </div>

    <!-- ComfyUI's rail: its own panels, not the app's navigation. -->
    <nav class="mg-rail" aria-label="ComfyUI panels">
      <!-- Glass: the way home heads the rail (Current has it in its top bar). -->
      <template v-if="!current">
        <Tooltip content="Home" side="right">
          <button type="button" class="mg-rail-btn is-home" aria-label="Home" @click="goHome">
            <ComfyCLogo class="mg-logo-mark" />
          </button>
        </Tooltip>
        <span class="mg-rail-gap" />
      </template>
      <Tooltip
        v-for="r in RAIL"
        :key="r.id"
        :content="tip(r.label, r.keys)"
        side="right"
        :disabled="current && !r.keys"
      >
        <button
          type="button"
          class="mg-rail-btn"
          :class="railOn(r.id) && 'is-on'"
          :aria-label="r.label"
          :aria-keyshortcuts="r.keys"
          :aria-expanded="railOn(r.id)"
          @click="onRail(r.id)"
        >
          <component :is="r.icon" :size="current ? 18 : 17" :stroke-width="1.75" />
          <span v-if="current" class="mg-rail-label">{{ r.label }}</span>
        </button>
      </Tooltip>
      <span class="mg-rail-gap" />
      <Tooltip :content="tip('Shortcuts', '⌘⇧K')" side="right">
        <button
          type="button"
          class="mg-rail-btn"
          :class="shortcuts && 'is-on'"
          aria-label="Shortcuts"
          aria-keyshortcuts="Control+Shift+K"
          :aria-expanded="shortcuts"
          @click="shortcuts = !shortcuts"
        >
          <Keyboard :size="17" :stroke-width="1.75" />
        </button>
      </Tooltip>
      <Tooltip :content="tip('Settings', '⌘,')" side="right">
        <button
          type="button"
          class="mg-rail-btn"
          :class="dialog === 'settings' && 'is-on'"
          aria-label="Settings"
          aria-keyshortcuts="Control+Comma"
          @click="openSettings()"
        >
          <Settings :size="17" :stroke-width="1.75" />
        </button>
      </Tooltip>
    </nav>

    <!-- The canvas: its grid moves with the view. -->
    <div
      ref="canvas"
      class="mg-canvas"
      :class="[tool === 'hand' && 'is-hand', wiring && 'is-wiring']"
      :style="{
        '--mg-gx': `${view.x}px`,
        '--mg-gy': `${view.y}px`,
        '--mg-gs': `${(current ? 20 : 24) * view.k}px`
      }"
      @wheel="onWheel"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @dblclick="onDouble"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <!-- Brand motif on: a file over the canvas lights it like the slot. -->
      <div v-if="dropping && brandMotif.id === 'trio'" class="mg-drop mar-trio-host">
        <MarTrio :u="20" :icon="Plus" :icon-size="10" />
        <span>Drop to add as an Image node</span>
      </div>
      <div
        class="mg-world"
        :style="{
          width: `${world.w}px`,
          height: `${world.h}px`,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`
        }"
      >
        <!-- Groups, behind the nodes. -->
        <div
          v-for="gr in groups"
          :key="gr.id"
          class="mg-group"
          :class="gr.locked && 'is-locked'"
          :style="{ left: `${gr.x}px`, top: `${gr.y}px`, width: `${gr.w}px`, height: `${gr.h}px` }"
        >
          <div class="mg-group-head" :data-group-head="gr.id">
            <input
              v-model="gr.title"
              class="mg-group-title"
              aria-label="Group name"
              @change="commit()"
            />
            <span v-if="gr.locked" class="mg-group-note">Skipped when the graph runs</span>
            <button
              type="button"
              class="mg-group-btn"
              :aria-label="gr.locked ? 'Unlock group' : 'Lock group'"
              :title="gr.locked ? 'Unlock: runs again' : 'Lock: skip when running'"
              @click="toggleLock(gr)"
            >
              <Lock v-if="gr.locked" :size="12" /><LockOpen v-else :size="12" />
            </button>
            <button
              type="button"
              class="mg-group-btn"
              aria-label="Ungroup"
              title="Ungroup"
              @click="ungroup(gr)"
            >
              <X :size="12" />
            </button>
          </div>
        </div>

        <svg class="mg-links" :viewBox="`0 0 ${world.w} ${world.h}`" aria-hidden="true">
          <path v-for="l in paths" :key="`s${l.id}`" :d="l.d" class="mg-link-shade" />
          <path
            v-for="l in paths"
            :key="l.id"
            :d="l.d"
            :stroke="l.color"
            class="mg-link"
            :class="[l.live && 'is-live', selectedLink === l.id && 'is-on']"
          />
          <!-- A wider, invisible stroke to click a link by. -->
          <path
            v-for="l in paths"
            :key="`h${l.id}`"
            :d="l.d"
            class="mg-link-hit"
            data-link
            @pointerdown.stop="((selectedLink = l.id), (selection = []))"
          />
          <path
            v-if="wiring"
            :d="wirePath"
            :stroke="SOCKETS[wiring.type]"
            class="mg-link is-wire"
          />
        </svg>

        <template v-for="l in paths" :key="`x${l.id}`">
          <button
            v-if="selectedLink === l.id"
            type="button"
            class="mg-link-del"
            data-link
            aria-label="Remove link"
            :style="{ left: `${l.mid.x}px`, top: `${l.mid.y}px` }"
            @pointerdown.stop
            @click="removeLink(l.id)"
          >
            <X :size="12" />
          </button>
        </template>

        <CanvasNode
          v-for="n in sNodes"
          :key="n.id"
          :node="n"
          :g="cg"
          :selected="isSel(n.id)"
          :wiring="wiring"
          :locked="lockedIds.has(n.id)"
          @set="(key, value) => setControl(n, key, value)"
          @text="(text) => setText(n, text)"
          @resume="activeJob && engine.resume(activeJob.id)"
          @action="(key) => act(n, key)"
          @pick="(index) => pick(n, index)"
          @view="viewing = n.id"
        />
      </div>

      <div
        v-if="marquee"
        class="mg-marquee"
        :style="{
          left: `${marquee.x}px`,
          top: `${marquee.y}px`,
          width: `${marquee.w}px`,
          height: `${marquee.h}px`
        }"
      />

      <!-- Several selected: what can be done to all of them. -->
      <div
        v-if="selectionBar"
        class="mg-selbar"
        :style="{ left: `${selectionBar.x}px`, top: `${selectionBar.y}px` }"
        @pointerdown.stop
      >
        <span v-if="selection.length > 1" class="mg-selbar-count"
          >{{ selection.length }} nodes</span
        >
        <button
          type="button"
          class="mg-selbar-btn"
          :title="selection.length > 1 ? 'Run these nodes' : 'Run up to here'"
          @click="runOnly(selection)"
        >
          <Play :size="12" fill="currentColor" />Run
        </button>
        <button
          type="button"
          class="mg-selbar-btn is-icon"
          :class="allBypassed && 'is-on'"
          aria-label="Bypass"
          title="Bypass (Ctrl+B)"
          @click="setMode(selection, 'bypass')"
        >
          <CircleSlash :size="13" />
        </button>
        <button
          type="button"
          class="mg-selbar-btn is-icon"
          aria-label="Mute"
          title="Mute (Ctrl+M)"
          @click="setMode(selection, 'mute')"
        >
          <EyeOff :size="13" />
        </button>
        <button
          v-if="selection.length > 1"
          type="button"
          class="mg-selbar-btn"
          @click="groupSelection"
        >
          <GroupIcon :size="13" />Group
        </button>
        <button
          type="button"
          class="mg-selbar-btn is-icon"
          aria-label="Duplicate"
          @click="duplicate(selection)"
        >
          <Copy :size="13" />
        </button>
        <button
          type="button"
          class="mg-selbar-btn is-icon"
          aria-label="Delete"
          @click="remove(selection)"
        >
          <Trash2 :size="13" />
        </button>
      </div>

      <p v-if="!sNodes.length" class="mg-empty">
        Double-click to add a node, or ask the agent to build a workflow
      </p>

      <NodeSearch
        v-if="menu"
        :x="menu.x"
        :y="menu.y"
        :fit="menu.fit"
        @pick="add"
        @close="menu = undefined"
      />
    </div>

    <!-- The rail's panels, one at a time beside it. -->
    <JobsPanel
      v-if="panel === 'queue'"
      :jobs="jobs"
      :cloud="onCloud"
      @close="panel = ''"
      @cancel="(id) => engine.cancel(id)"
      @clear-queue="engine.clearQueue()"
      @view="panel = 'assets'"
    />
    <AssetsPanel v-else-if="panel === 'assets'" :cloud="onCloud" @close="panel = ''" />
    <NodesPanel
      v-else-if="panel === 'nodes'"
      :cloud="onCloud"
      @close="panel = ''"
      @add="addFromPanel"
    />
    <ModelsPanel v-else-if="panel === 'models'" @close="panel = ''" />
    <WorkflowsPanel
      v-else-if="panel === 'workflows' || panel === 'apps'"
      :key="panel"
      :kind="panel"
      :active="shownWorkflow"
      @close="panel = ''"
      @open="(name) => (shownWorkflow = name)"
    />
    <ShortcutsPanel
      v-if="shortcuts"
      @close="shortcuts = false"
      @manage="((shortcuts = false), openSettings('Keybinding'))"
    />
    <TemplatesDialog v-if="dialog === 'templates'" @close="dialog = ''" @pick="dialog = ''" />
    <ModelBrowser v-else-if="dialog === 'models'" @close="dialog = ''" />
    <SettingsDialog
      v-else-if="dialog === 'settings'"
      :cloud="onCloud"
      :start="settingsAt"
      @close="dialog = ''"
    />
    <AgentPanel v-if="agent" @build="build" @close="agent = false" />
    <button v-else type="button" class="mg-agent-btn" @click="agent = true">
      <Bot :size="15" />Agent
    </button>

    <!-- Run and what is running, as designed in ComfyUI_frontend#17679:
         the action bar (batch count, the inverted split Run, the panel
         toggle) and under it the status pill with its job rows. -->
    <div class="mg-runblock">
      <div class="mg-actionbar">
        <span class="mg-grip" aria-hidden="true" />
        <span class="mg-batch">
          <span class="mg-batch-n" aria-label="Runs per press">{{ batch }}</span>
          <span class="mg-batch-step">
            <button
              type="button"
              aria-label="More runs per press"
              :disabled="batch >= 9"
              @click="batch++"
            >
              <ChevronUp :size="12" />
            </button>
            <button
              type="button"
              aria-label="Fewer runs per press"
              :disabled="batch <= 1"
              @click="batch--"
            >
              <ChevronDown :size="12" />
            </button>
          </span>
        </span>
        <span class="mg-run-group">
          <button type="button" class="mg-run" @click="run"><Play :size="15" />Run</button>
          <button
            type="button"
            class="mg-run-more"
            aria-label="Run options"
            :aria-expanded="runMenu"
            @click="runMenu = !runMenu"
          >
            <ChevronDown :size="15" />
          </button>
        </span>
        <button type="button" class="mg-panel-btn" aria-label="Toggle the right panel">
          <PanelRight :size="17" />
        </button>
      </div>
      <div v-if="runMenu" class="mg-runmenu" role="menu">
        <button type="button" class="mg-runmenu-item" role="menuitem" @click="run">
          <span>Run the graph</span><kbd>⌘↵</kbd>
        </button>
        <button
          type="button"
          class="mg-runmenu-item"
          role="menuitem"
          :disabled="!selection.length"
          @click="runOnly(selection)"
        >
          <span>Run selected nodes</span>
        </button>
        <p class="mg-runmenu-cost">
          About {{ cost }} credits{{ batch > 1 ? ` for ${batch} runs` : ' a run' }}
        </p>
      </div>
      <!-- Only while something runs or waits: the graph opens idle. -->
      <div v-if="jobs.length" class="mg-status">
        <button
          type="button"
          class="mg-pill"
          :aria-expanded="jobsOpen"
          @click="jobsOpen = !jobsOpen"
        >
          <span v-if="activeJob?.status === 'paused'" class="mg-paused" aria-hidden="true">
            <Pause :size="9" fill="currentColor" />
          </span>
          <i v-else class="mg-spin" aria-hidden="true" />
          <span>{{ activeJob?.status === 'paused' ? 'Paused' : 'Running' }}</span>
          <span v-if="waiting.length" class="mg-badge">Queued {{ waiting.length }}</span>
          <span class="mg-hairline" :style="{ width: `${(activeJob?.progress ?? 0) * 100}%` }" />
        </button>
        <template v-if="jobsOpen">
          <div v-for="job in jobs" :key="job.id" class="mg-job">
            <span v-if="job.status === 'paused'" class="mg-paused is-small" aria-hidden="true">
              <Pause :size="8" fill="currentColor" />
            </span>
            <i v-else-if="job.status === 'running'" class="mg-spin is-small" aria-hidden="true" />
            <i v-else class="mg-job-dot" aria-hidden="true" />
            <span class="mg-job-text">
              <span class="mg-job-title">{{ job.title }}</span>
              <span class="mg-job-sub">{{ jobSub(job) }}</span>
            </span>
            <button
              type="button"
              class="mg-job-stop"
              :aria-label="`Stop this run ${job.title}`"
              @click="engine.cancel(job.id)"
            >
              <i />
            </button>
            <span
              v-if="job.status !== 'queued'"
              class="mg-hairline"
              :style="{ width: `${job.progress * 100}%` }"
            />
          </div>
          <div class="mg-job-foot">
            <button type="button" class="mg-foot-btn" @click="assets = true">
              <Images :size="12" />Results ({{ results }})<ChevronDown :size="12" />
            </button>
            <span class="mg-foot-group">
              <button
                type="button"
                class="mg-foot-btn"
                :disabled="!waiting.length"
                @click="engine.clearQueue()"
              >
                Clear queue
              </button>
              <span class="mg-foot-sep" />
              <button type="button" class="mg-foot-btn" @click="engine.cancelAll()">
                <i class="mg-foot-square" />Cancel all
              </button>
            </span>
          </div>
        </template>
      </div>
    </div>
    <button
      v-if="current && !panel"
      type="button"
      class="mg-search"
      aria-label="Search nodes"
      @click="openMenuAtCentre()"
    >
      <Search :size="14" />
    </button>

    <!-- What Save to Assets says. -->
    <Transition name="mg-toast">
      <div v-if="toast" class="mg-toast" role="status">
        <img v-if="toast.image" :src="toast.image" alt="" />
        <span>{{ toast.text }}</span>
        <button type="button" class="mg-toast-btn" @click="assets = true">View</button>
      </div>
    </Transition>

    <!-- Canvas controls and minimap. -->
    <div class="mg-corner">
      <div
        v-if="showMap"
        class="mg-map"
        :style="{
          width: `${MAP_W}px`,
          height: `${Math.min(160, (bounds.h / bounds.w) * MAP_W)}px`
        }"
        aria-hidden="true"
        @click="onMap"
      >
        <svg
          :viewBox="`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`"
          preserveAspectRatio="none"
        >
          <path v-for="l in paths" :key="l.id" :d="l.d" :stroke="l.color" class="mg-map-link" />
          <rect
            v-for="b in boxes"
            :key="b.node.id"
            class="mg-map-node"
            :class="[isSel(b.node.id) && 'is-on', b.node.state === 'running' && 'is-running']"
            :x="b.node.x"
            :y="b.node.y"
            :width="nodeWidth(b.node)"
            :height="b.h"
            rx="12"
          />
          <rect
            class="mg-map-view"
            :x="mapView.x"
            :y="mapView.y"
            :width="mapView.w"
            :height="mapView.h"
          />
        </svg>
      </div>
      <div class="mg-tools">
        <button
          type="button"
          class="mg-tool"
          :class="tool === 'select' && 'is-on'"
          aria-label="Select"
          @click="tool = 'select'"
        >
          <MousePointer2 :size="14" />
        </button>
        <button
          type="button"
          class="mg-tool"
          :class="tool === 'hand' && 'is-on'"
          aria-label="Pan"
          @click="tool = 'hand'"
        >
          <Hand :size="14" />
        </button>
        <span class="mg-tools-sep" />
        <button type="button" class="mg-tool" aria-label="Undo" :disabled="!canUndo" @click="undo">
          <Undo2 :size="14" />
        </button>
        <button type="button" class="mg-tool" aria-label="Redo" :disabled="!canRedo" @click="redo">
          <Redo2 :size="14" />
        </button>
        <span class="mg-tools-sep" />
        <button type="button" class="mg-tool" aria-label="Zoom out" @click="zoomAt(view.k / 1.2)">
          <Minus :size="14" />
        </button>
        <span class="mg-zoom">{{ Math.round(view.k * 100) }}%</span>
        <button type="button" class="mg-tool" aria-label="Zoom in" @click="zoomAt(view.k * 1.2)">
          <Plus :size="14" />
        </button>
        <span class="mg-tools-sep" />
        <button type="button" class="mg-tool" aria-label="Fit view" @click="fit">
          <Maximize :size="14" />
        </button>
        <button
          type="button"
          class="mg-tool"
          :class="showMap && 'is-on'"
          aria-label="Minimap"
          @click="showMap = !showMap"
        >
          <MapIcon :size="14" />
        </button>
      </div>
    </div>
    <MediaViewer
      v-if="viewing && sById[viewing]"
      :node="sById[viewing]!"
      @close="viewing = undefined"
      @pick="(index) => pick(sById[viewing!]!, index)"
      @save="save(sById[viewing!]!)"
    />
  </div>
</template>

<!-- Unscoped: Pablo's button reset beats scoped rules, so buttons here go
     through `:root .proto-ui.proto-ui.proto-ui`. Every class is `mg-`. -->
<style>
/* ── Tokens. Glass reads the Void palette; Current uses ComfyUI's own. ── */
.mg {
  --mg-canvas: var(--color-content-background);
  --mg-dot: color-mix(in oklch, var(--color-base-foreground) 11%, transparent);
  --mg-node: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  --mg-node-on: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  --mg-well: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  --mg-float: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  --mg-hover: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  --mg-text: var(--color-base-foreground);
  --mg-muted: var(--color-muted-foreground);
  --mg-dim: var(--color-subtle-foreground);
  --mg-ring: var(--color-content-background);
  --mg-radius: var(--radius-card);
  --mg-radius-in: var(--mar-tab-item-radius);
  --mg-run: var(--color-inverted-background);
  --mg-run-text: var(--color-inverted-foreground);
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background: var(--mg-canvas);
  color: var(--mg-text);
  font-family: Inter, var(--font-sans, system-ui), sans-serif;
  font-size: 13px;
  user-select: none;
}
:root[data-ds-theme='light'] .mg {
  --mg-canvas: oklch(0.955 0.003 285);
  --mg-dot: oklch(0 0 0 / 0.13);
  --mg-node: oklch(1 0 0 / 0.72);
  --mg-node-on: oklch(1 0 0 / 0.92);
  --mg-well: oklch(0 0 0 / 0.04);
  --mg-float: oklch(1 0 0 / 0.72);
  --mg-hover: oklch(0 0 0 / 0.05);
  --mg-ring: oklch(0.955 0.003 285);
}

/* ── Canvas. ── */
.mg-canvas {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
  background: radial-gradient(circle at 1px 1px, var(--mg-dot) 1px, transparent 1.4px) var(--mg-gx)
    var(--mg-gy) / var(--mg-gs) var(--mg-gs);
}
.mg-drop {
  position: absolute;
  inset: 10px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-radius: var(--radius-panel, 16px);
  background: linear-gradient(
    180deg,
    color-mix(in oklch, var(--color-base-foreground) 5%, transparent),
    transparent 60%
  );
  box-shadow: inset 0 0 0 1.25px var(--color-base-foreground);
  color: var(--color-muted-foreground);
  font-size: 12px;
  pointer-events: none;
}
.mg-canvas.is-hand {
  cursor: grab;
}
.mg-world {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}
.mg-links {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}
.mg-link {
  fill: none;
  stroke-width: 3;
  stroke-linecap: round;
}
.mg-link.is-on {
  stroke-width: 4.5;
}
.mg-link.is-wire {
  opacity: 0.9;
  stroke-dasharray: 6 5;
}
.mg-link-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 14;
  pointer-events: stroke;
  cursor: pointer;
}
.mg-canvas.is-wiring {
  cursor: crosshair;
}
:root .proto-ui.proto-ui.proto-ui .mg-link-del {
  position: absolute;
  z-index: 4;
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  background: var(--mg-run);
  color: var(--mg-run-text);
  translate: -50% -50%;
}

/* Groups: a quiet frame behind their nodes, its name above. */
.mg-group {
  position: absolute;
  border-radius: var(--mar-tab-radius);
  background: color-mix(in oklch, var(--color-base-foreground) 3.5%, transparent);
}
.mg-group.is-locked {
  background: repeating-linear-gradient(
    135deg,
    color-mix(in oklch, var(--color-base-foreground) 4%, transparent) 0 10px,
    transparent 10px 20px
  );
}
.mg-group-head {
  display: flex;
  height: 40px;
  align-items: center;
  gap: 4px;
  padding: 0 8px 0 14px;
  cursor: grab;
}
:root .proto-ui.proto-ui.proto-ui .mg-group-title {
  height: auto;
  padding: 0;
  box-shadow: none;
  min-width: 0;
  width: 160px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--mg-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
}
.mg-group-note {
  flex: 1;
  color: var(--mg-dim);
  font-size: 11.5px;
}
:root .proto-ui.proto-ui.proto-ui .mg-group-btn {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  padding: 0;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-muted);
}
:root .proto-ui.proto-ui.proto-ui .mg-group-btn + .mg-group-btn {
  margin-left: 0;
}
:root .proto-ui.proto-ui.proto-ui .mg-group-btn:hover {
  background: var(--mg-hover);
  color: var(--mg-text);
}

.mg-marquee {
  position: absolute;
  z-index: 3;
  border-radius: var(--mar-tab-item-radius);
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 35%, transparent);
  pointer-events: none;
}
.mg-selbar {
  position: absolute;
  z-index: 5;
  display: flex;
  height: 38px;
  align-items: center;
  gap: 2px;
  padding: 0 4px 0 12px;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-float);
  backdrop-filter: blur(24px) saturate(1.2);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.22);
  translate: -50% 0;
}
.mg-selbar-count {
  margin-right: 6px;
  color: var(--mg-dim);
  font-size: 12px;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .mg-selbar-btn {
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-text);
  font-size: 12.5px;
}
:root .proto-ui.proto-ui.proto-ui .mg-selbar-btn.is-icon {
  width: 30px;
  justify-content: center;
  padding: 0;
  color: var(--mg-muted);
}
:root .proto-ui.proto-ui.proto-ui .mg-selbar-btn:hover {
  background: var(--mg-hover);
  color: var(--mg-text);
}
.mg-empty {
  position: absolute;
  top: 50%;
  left: 50%;
  margin: 0;
  color: var(--mg-dim);
  font-size: 13px;
  pointer-events: none;
  translate: -50% -50%;
}
:root .proto-ui.proto-ui.proto-ui .mg-agent-btn {
  position: absolute;
  bottom: 16px;
  left: 16px;
  z-index: 4;
  display: inline-flex;
  height: 36px;
  align-items: center;
  gap: 8px;
  padding: 0 14px 0 12px;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-float);
  backdrop-filter: blur(24px) saturate(1.2);
  color: var(--mg-text);
  font-size: 13px;
}
:root .proto-ui.proto-ui.proto-ui .mg-agent-btn:hover {
  background: var(--mg-node-on);
}
.mg-runmenu {
  display: flex;
  width: 240px;
  flex-direction: column;
  padding: 4px;
  border-radius: var(--mar-tab-radius);
  background: color-mix(in oklch, var(--color-content-background) 84%, transparent);
  backdrop-filter: blur(24px) saturate(1.2);
  box-shadow: 0 12px 34px rgb(0 0 0 / 0.28);
}
:root .proto-ui.proto-ui.proto-ui .mg-runmenu-item {
  display: flex;
  height: 32px;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-text);
  font-size: 13px;
}
:root .proto-ui.proto-ui.proto-ui .mg-runmenu-item:hover:not(:disabled) {
  background: var(--mg-hover);
}
:root .proto-ui.proto-ui.proto-ui .mg-runmenu-item:disabled {
  opacity: 0.4;
}
.mg-runmenu-item kbd {
  color: var(--mg-dim);
  font: inherit;
  font-size: 11.5px;
}
.mg-runmenu-cost {
  margin: 4px 0 0;
  padding: 8px 10px 6px;
  box-shadow: inset 0 1px 0 color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--mg-dim);
  font-size: 11.5px;
}
:root .proto-ui.proto-ui.proto-ui .mg-tool:disabled {
  opacity: 0.35;
  pointer-events: none;
}
.is-current :is(.mg-selbar, .mg-runmenu) {
  border-radius: var(--mar-tab-radius);
  background: var(--mg-chrome-2);
  box-shadow:
    0 0 0 1px var(--mg-chrome-line),
    0 8px 20px rgb(0 0 0 / 0.3);
  backdrop-filter: none;
}
.is-current .mg-group {
  border-radius: var(--mar-tab-radius);
  background: color-mix(in oklch, #8a8af0 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, #8a8af0 30%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .is-current .mg-agent-btn {
  left: 68px;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-chrome-2);
  box-shadow: 0 0 0 1px var(--mg-chrome-line);
  backdrop-filter: none;
}

/* ── Floating chrome (Glass): rail, Run bar, controls. ── */
.mg-rail {
  position: absolute;
  top: calc(var(--mg-top) + 16px);
  left: 16px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-float);
  backdrop-filter: blur(24px) saturate(1.2);
}
.mg-rail-gap {
  height: 1px;
  margin: 6px 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mg-rail-btn {
  display: inline-flex;
  width: 36px;
  height: 36px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 0;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-muted);
}
:root .proto-ui.proto-ui.proto-ui .mg-rail-btn.is-on,
:root .proto-ui.proto-ui.proto-ui .mg-rail-btn:hover {
  background: var(--mg-hover);
  color: var(--mg-text);
}
.mg-tools-sep {
  width: 1px;
  height: 16px;
  flex: none;
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}

/* ── Run block (ComfyUI_frontend#17679), in the Home's language: the
   action bar, then the status pill and its job rows, all borderless
   translucent surfaces. ── */
.mg-runblock {
  position: absolute;
  top: calc(var(--mg-top) + 16px);
  right: 16px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.mg-actionbar {
  display: flex;
  height: 44px;
  align-items: center;
  gap: 6px;
  padding: 0 6px 0 4px;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-float);
  backdrop-filter: blur(24px) saturate(1.2);
  color: var(--mg-muted);
}
.mg-grip {
  width: 8px;
  height: 16px;
  margin: 0 2px 0 4px;
  background: radial-gradient(circle, currentColor 1px, transparent 1.4px) 0 0 / 4px 4px;
  opacity: 0.6;
}
.mg-batch {
  display: inline-flex;
  height: 32px;
  align-items: stretch;
  overflow: hidden;
  border-radius: var(--mar-tab-item-radius);
  background: var(--mg-well);
  color: var(--mg-text);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.mg-batch-n {
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
}
.mg-batch-step {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 6px;
  box-shadow: inset 1px 0 0 color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  color: var(--mg-dim);
}
:root .proto-ui.proto-ui.proto-ui .mg-batch-step button {
  display: flex;
  height: 12px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-dim);
}
:root .proto-ui.proto-ui.proto-ui .mg-batch-step button:hover:not(:disabled) {
  color: var(--mg-text);
}
:root .proto-ui.proto-ui.proto-ui .mg-batch-step button:disabled {
  opacity: 0.35;
}
.mg-run-group {
  display: inline-flex;
  height: 32px;
  overflow: hidden;
  border-radius: var(--mar-tab-item-radius);
  background: var(--mg-run);
}
:root .proto-ui.proto-ui.proto-ui .mg-run,
:root .proto-ui.proto-ui.proto-ui .mg-run-more {
  display: inline-flex;
  height: 32px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 16px;
  border-radius: 0;
  background: transparent;
  color: var(--mg-run-text);
  font-size: 14px;
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .mg-run {
  min-width: 88px;
}
:root .proto-ui.proto-ui.proto-ui .mg-run-more {
  width: 28px;
  padding: 0;
  box-shadow: inset 1px 0 0 color-mix(in oklch, var(--mg-run-text) 25%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mg-panel-btn {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-muted);
}
:root .proto-ui.proto-ui.proto-ui .mg-panel-btn:hover {
  background: var(--mg-hover);
  color: var(--mg-text);
}

.mg-status {
  display: flex;
  width: 320px;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
:root .proto-ui.proto-ui.proto-ui .mg-pill {
  position: relative;
  display: inline-flex;
  height: 36px;
  min-width: 176px;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 10px;
  overflow: hidden;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-float);
  backdrop-filter: blur(24px) saturate(1.2);
  color: var(--mg-text);
  font-size: 14px;
}
.mg-badge {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--mg-muted);
  font-size: 12px;
  font-weight: 500;
}
.mg-hairline {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  background: color-mix(in oklch, var(--color-base-foreground) 70%, transparent);
  transition: width 0.2s linear;
}
.mg-paused {
  display: inline-flex;
  width: 15px;
  height: 15px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
  color: var(--mg-text);
}
.mg-paused.is-small {
  width: 13px;
  height: 13px;
  margin: 0 1.5px;
}
:root .proto-ui.proto-ui.proto-ui .mg-foot-btn:disabled {
  opacity: 0.4;
  pointer-events: none;
}

/* Save to Assets' toast: bottom centre, over the canvas. */
.mg-toast {
  position: absolute;
  bottom: 16px;
  left: 50%;
  z-index: 5;
  display: flex;
  height: 44px;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-float);
  backdrop-filter: blur(24px) saturate(1.2);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.22);
  color: var(--mg-text);
  font-size: 13px;
  translate: -50% 0;
}
.mg-toast img {
  width: 32px;
  height: 32px;
  border-radius: var(--mar-tab-item-radius);
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .mg-toast-btn {
  height: 30px;
  padding: 0 12px;
  border-radius: var(--mar-tab-item-radius);
  background: var(--mg-hover);
  color: var(--mg-text);
  font-size: 12px;
  font-weight: 500;
}
.is-current .mg-toast {
  border-radius: var(--mar-tab-radius);
  background: var(--mg-chrome-2);
  box-shadow:
    0 0 0 1px var(--mg-chrome-line),
    0 8px 20px rgb(0 0 0 / 0.3);
  backdrop-filter: none;
}
.mg-toast-enter-active,
.mg-toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.mg-toast-enter-from,
.mg-toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
@media (prefers-reduced-motion: reduce) {
  .mg-hairline,
  .mg-toast-enter-active,
  .mg-toast-leave-active {
    transition: none;
  }
  .mg-spin {
    animation-duration: 2.4s;
  }
}
.mg-spin {
  width: 15px;
  height: 15px;
  flex: none;
  border: 2px solid color-mix(in oklch, var(--color-base-foreground) 20%, transparent);
  border-top-color: color-mix(in oklch, var(--color-base-foreground) 80%, transparent);
  border-radius: 999px;
  animation: mg-spin 0.9s linear infinite;
}
.mg-spin.is-small {
  width: 13px;
  height: 13px;
  margin: 0 1.5px;
}
@keyframes mg-spin {
  to {
    transform: rotate(360deg);
  }
}
.mg-job {
  position: relative;
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 4px 6px 4px 12px;
  overflow: hidden;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-float);
  backdrop-filter: blur(24px) saturate(1.2);
}
.mg-job-dot {
  width: 6px;
  height: 6px;
  flex: none;
  margin: 0 5px;
  border-radius: 999px;
  background: var(--mg-muted);
}
.mg-job-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.mg-job-title {
  overflow: hidden;
  color: var(--mg-text);
  font-size: 14px;
  line-height: 20px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.mg-job-sub {
  color: var(--mg-muted);
  font-size: 12px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}
:root .proto-ui.proto-ui.proto-ui .mg-job-stop {
  display: inline-flex;
  width: 32px;
  height: 32px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-muted);
}
:root .proto-ui.proto-ui.proto-ui .mg-job-stop:hover {
  background: var(--mg-hover);
  color: var(--mg-text);
}
.mg-job-stop i,
.mg-foot-square {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background: currentColor;
}
.mg-foot-square {
  width: 10px;
  height: 10px;
}
.mg-job-foot {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  padding: 4px;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-float);
  backdrop-filter: blur(24px) saturate(1.2);
}
.mg-foot-group {
  display: flex;
  align-items: center;
  gap: 2px;
}
.mg-foot-sep {
  width: 1px;
  height: 16px;
  margin: 0 2px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mg-foot-btn {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-muted);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .mg-foot-btn:hover {
  background: var(--mg-hover);
  color: var(--mg-text);
}
.mg-corner {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.mg-map {
  overflow: hidden;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-float);
  backdrop-filter: blur(24px);
  cursor: pointer;
}
.mg-map svg {
  display: block;
  width: 100%;
  height: 100%;
}
/* The minimap draws the graph as ComfyUI's does: the links in their
   type's colour under the nodes' bodies; the selected and the running
   nodes stand out. */
.mg-map-link {
  fill: none;
  stroke-width: 1.5;
  opacity: 0.8;
  vector-effect: non-scaling-stroke;
}
.mg-map-node {
  fill: color-mix(in oklch, var(--color-base-foreground) 24%, var(--mg-canvas));
}
:root[data-ds-theme='light'] .mg-map-node {
  fill: color-mix(in oklch, var(--color-base-foreground) 12%, var(--mg-canvas));
}
.mg-map-node.is-on {
  fill: color-mix(in oklch, var(--color-base-foreground) 45%, var(--mg-canvas));
}
.mg-map-node.is-running {
  fill: #0b8ce9;
}
.mg-map .mg-map-view {
  fill: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  stroke: color-mix(in oklch, var(--color-base-foreground) 45%, transparent);
  stroke-width: 1.25;
  vector-effect: non-scaling-stroke;
}
.mg-tools {
  display: flex;
  height: 36px;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-float);
  backdrop-filter: blur(24px) saturate(1.2);
}
:root .proto-ui.proto-ui.proto-ui .mg-tool {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-muted);
}
:root .proto-ui.proto-ui.proto-ui .mg-tool:hover,
:root .proto-ui.proto-ui.proto-ui .mg-tool.is-on {
  background: var(--mg-hover);
  color: var(--mg-text);
}
.mg-tools-sep {
  margin: 0 4px;
}
.mg-zoom {
  min-width: 38px;
  color: var(--mg-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

/* ── Current: ComfyUI as it looks today (frontend v1), in the same
   structure. Flat grey nodes with a darker title, pill widgets with
   arrows, thick outlined links on a lined grid, the blue Run. ── */
.mg.is-current {
  --mg-canvas: #202020;
  --mg-dot: rgb(255 255 255 / 0.045);
  --mg-node: #353535;
  --mg-node-on: #353535;
  --mg-head-bg: #2b2b2b;
  --mg-well: #222;
  --mg-well-line: #666;
  --mg-text: #ddd;
  --mg-muted: #aaa;
  --mg-dim: #999;
  --mg-title: #c4c4c4;
  --mg-ring: transparent;
  --mg-hover: rgb(255 255 255 / 0.08);
  --mg-chrome: #171718;
  --mg-chrome-2: #262729;
  --mg-chrome-line: #0a0a0a;
  --mg-radius: var(--radius-card);
  --mg-radius-in: var(--mar-tab-item-radius);
  --mg-run: #f2f2f2;
  --mg-run-text: #111;
  display: grid;
  grid-template-rows: 38px 1fr;
  grid-template-columns: 52px 1fr;
  padding-top: var(--mg-top);
  background: var(--mg-canvas);
  font-family: Inter, Arial, sans-serif;
  font-size: 12px;
}
:root[data-ds-theme='light'] .mg.is-current {
  --mg-canvas: #e4e4e4;
  --mg-dot: rgb(0 0 0 / 0.06);
  --mg-node: #f2f2f2;
  --mg-node-on: #f2f2f2;
  --mg-head-bg: #e2e2e2;
  --mg-well: #fff;
  --mg-well-line: #bbb;
  --mg-text: #222;
  --mg-muted: #444;
  --mg-dim: #777;
  --mg-title: #222;
  --mg-chrome: #f4f4f5;
  --mg-chrome-2: #e7e7e9;
  --mg-chrome-line: #d4d4d8;
  --mg-hover: rgb(0 0 0 / 0.06);
  --mg-run: #222;
  --mg-run-text: #fff;
}
.is-current .mg-canvas {
  position: relative;
  inset: auto;
  grid-row: 2;
  grid-column: 2;
  background:
    linear-gradient(var(--mg-dot) 1px, transparent 1px) var(--mg-gx) var(--mg-gy) / var(--mg-gs)
      var(--mg-gs),
    linear-gradient(90deg, var(--mg-dot) 1px, transparent 1px) var(--mg-gx) var(--mg-gy) /
      var(--mg-gs) var(--mg-gs);
}
.mg-topbar {
  z-index: 4;
  display: flex;
  grid-row: 1;
  grid-column: 1 / -1;
  align-items: flex-end;
  gap: 2px;
  padding-right: 8px;
  background: var(--mg-chrome);
  box-shadow: inset 0 -1px 0 var(--mg-chrome-line);
  color: var(--mg-muted);
}
:root .proto-ui.proto-ui.proto-ui .mg-logo {
  display: inline-flex;
  width: 52px;
  height: 38px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 0;
  background: transparent;
  color: #f0ff41;
}
:root .proto-ui.proto-ui.proto-ui .mg-logo:hover {
  background: var(--mg-hover);
}
.mg-logo-mark {
  width: 18px;
  height: 18px;
}
:root .proto-ui.proto-ui.proto-ui .mg-rail-btn.is-home {
  color: var(--mg-text);
}
:root[data-ds-theme='light'] .proto-ui.proto-ui.proto-ui .mg-logo {
  color: #1a1a1a;
}
.mg-tab {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 10px;
  padding: 0 10px 0 12px;
  border-radius: var(--mar-tab-item-radius) var(--mar-tab-item-radius) 0 0;
  font-size: 12px;
}
.mg-tab svg {
  opacity: 0.6;
}
.mg-tab.is-on {
  background: var(--mg-chrome-2);
  color: var(--mg-text);
}
.mg-tab-add {
  margin: 0 0 9px 6px;
}
.is-current .mg-rail {
  position: relative;
  top: auto;
  left: auto;
  grid-row: 2;
  grid-column: 1;
  gap: 4px;
  padding: 8px 4px;
  border-radius: 0;
  background: var(--mg-chrome);
  box-shadow: inset -1px 0 0 var(--mg-chrome-line);
  backdrop-filter: none;
}
:root .proto-ui.proto-ui.proto-ui .is-current .mg-rail-btn {
  width: 44px;
  height: 46px;
  border-radius: var(--mar-tab-item-radius);
}
.mg-rail-label {
  font-size: 9.5px;
  line-height: 1;
}
.is-current .mg-rail-gap {
  flex: 1;
  background: none;
}
.mg-link-shade {
  fill: none;
  stroke: rgb(0 0 0 / 0.5);
  stroke-width: 5.5;
}
:root[data-ds-theme='light'] .mg-link-shade {
  stroke: rgb(0 0 0 / 0.22);
}

/* Current: the same run block on ComfyUI's chrome, with its hairline
   borders, under the top bar. */
.is-current .mg-runblock {
  top: calc(var(--mg-top) + 38px + 12px);
}
.is-current :is(.mg-actionbar, .mg-job, .mg-job-foot) {
  border-radius: var(--mar-tab-radius);
  background: var(--mg-chrome-2);
  box-shadow: 0 0 0 1px var(--mg-chrome-line);
  backdrop-filter: none;
}
:root .proto-ui.proto-ui.proto-ui .is-current .mg-pill {
  border-radius: var(--mar-tab-radius);
  background: var(--mg-chrome-2);
  box-shadow: 0 0 0 1px var(--mg-chrome-line);
  backdrop-filter: none;
}
.is-current :is(.mg-batch, .mg-run-group) {
  border-radius: var(--mar-tab-item-radius);
}
:root .proto-ui.proto-ui.proto-ui .is-current .mg-panel-btn {
  border-radius: var(--mar-tab-item-radius);
}
:root .proto-ui.proto-ui.proto-ui .mg-search {
  position: absolute;
  top: calc(var(--mg-top) + 38px + 12px);
  left: 64px;
  z-index: 4;
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-chrome-2);
  box-shadow: 0 0 0 1px var(--mg-chrome-line);
  color: var(--mg-muted);
}
.is-current .mg-corner {
  gap: 6px;
}
.is-current :is(.mg-map, .mg-tools) {
  border-radius: var(--mar-tab-radius);
  background: var(--mg-chrome-2);
  box-shadow: 0 0 0 1px var(--mg-chrome-line);
  backdrop-filter: none;
}
.is-current .mg-tools {
  height: 34px;
}
.is-current .mg-map-node:not(.is-on, .is-running) {
  fill: #313235;
}
:root[data-ds-theme='light'] .is-current .mg-map-node:not(.is-on, .is-running) {
  fill: #d9d9d9;
}
:root .proto-ui.proto-ui.proto-ui .is-current .mg-tool {
  border-radius: var(--mar-tab-item-radius);
}
</style>
