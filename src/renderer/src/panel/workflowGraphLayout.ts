const TITLE_HEIGHT = 26
const SLOT_HEIGHT = 20
const SLOT_TOP = 12
const WIDGET_HEIGHT = 18
const WIDGET_GAP = 4
const MAX_WIDGETS = 4
const MAX_NODES = 500
const MIN_NODE_WIDTH = 140
const MAX_VALUE_LENGTH = 28

export interface GraphSlot {
  name: string
  type: string
  x: number
  y: number
}

export interface GraphNode {
  id: string
  title: string
  x: number
  y: number
  width: number
  height: number
  inputs: GraphSlot[]
  outputs: GraphSlot[]
  widgets: { label: string; value: string; y: number }[]
  muted: boolean
}

export interface GraphLink {
  id: string
  type: string
  path: string
}

export interface GraphGroup {
  title: string
  x: number
  y: number
  width: number
  height: number
  color: string
}

export interface GraphLayout {
  nodes: GraphNode[]
  links: GraphLink[]
  groups: GraphGroup[]
  bounds: { x: number; y: number; width: number; height: number }
}

type Json = Record<string, unknown>

function record(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
}

function pair(value: unknown): [number, number] | null {
  if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') {
    return [value[0], value[1]]
  }
  const object = record(value)
  if (object && typeof object['0'] === 'number' && typeof object['1'] === 'number') {
    return [object['0'], object['1']]
  }
  return null
}

function label(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function shown(value: unknown): string | null {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value !== 'string') return null
  const flat = value.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > MAX_VALUE_LENGTH ? `${flat.slice(0, MAX_VALUE_LENGTH - 1)}…` : flat
}

function subgraphNames(graph: Json): Map<string, string> {
  const names = new Map<string, string>()
  const subgraphs = record(graph.definitions)?.subgraphs
  if (!Array.isArray(subgraphs)) return names
  for (const subgraph of subgraphs) {
    const entry = record(subgraph)
    if (entry && typeof entry.id === 'string') names.set(entry.id, label(entry.name, entry.id))
  }
  return names
}

interface RawSlot {
  name: string
  type: string
  widget: string | null
  linked: boolean
}

function isLinkSlot(slot: RawSlot): boolean {
  return slot.widget === null || slot.linked
}

function slotsOf(value: unknown): RawSlot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((slot) => {
    const entry = record(slot)
    if (!entry) return []
    const widget = record(entry.widget)
    return [
      {
        name: label(entry.label ?? entry.localized_name ?? entry.name, ''),
        type: typeof entry.type === 'string' ? entry.type : '*',
        widget: widget && typeof widget.name === 'string' ? widget.name : null,
        linked: entry.link !== null && entry.link !== undefined
      }
    ]
  })
}

function widgetsOf(node: Json, widgetNames: string[]): { label: string; value: string }[] {
  const values = Array.isArray(node.widgets_values) ? node.widgets_values : []
  const rows: { label: string; value: string }[] = []
  let nameIndex = 0
  for (const value of values) {
    const text = shown(value)
    if (text === null) continue
    rows.push({ label: widgetNames[nameIndex] ?? '', value: text })
    nameIndex += 1
    if (rows.length >= MAX_WIDGETS) break
  }
  return rows
}

function layOutNode(node: Json, names: Map<string, string>): GraphNode | null {
  const position = pair(node.pos)
  if (!position || node.id === undefined || node.id === null) return null
  const type = label(node.type, 'Node')
  if (type === 'MarkdownNote' || type === 'Note') return null
  const size = pair(node.size) ?? [MIN_NODE_WIDTH, 60]
  const inputs = slotsOf(node.inputs)
  const outputs = slotsOf(node.outputs)
  const linkedInputs = inputs.filter(isLinkSlot)
  const widgetNames = inputs.flatMap((slot) => (slot.widget ? [slot.widget] : []))
  const widgets = widgetsOf(node, widgetNames)
  const [x, y] = position
  const width = Math.max(size[0], MIN_NODE_WIDTH)
  const slotRows = Math.max(linkedInputs.length, outputs.length)
  const widgetTop = y + SLOT_TOP + slotRows * SLOT_HEIGHT
  const height = Math.max(
    size[1],
    SLOT_TOP + slotRows * SLOT_HEIGHT + widgets.length * (WIDGET_HEIGHT + WIDGET_GAP) + 8
  )
  return {
    id: String(node.id),
    title: label(node.title, names.get(type) ?? type),
    x,
    y,
    width,
    height,
    muted: node.mode === 2 || node.mode === 4,
    inputs: linkedInputs.map((slot, index) => ({
      name: slot.name,
      type: slot.type,
      x,
      y: y + SLOT_TOP + index * SLOT_HEIGHT
    })),
    outputs: outputs.map((slot, index) => ({
      name: slot.name,
      type: slot.type,
      x: x + width,
      y: y + SLOT_TOP + index * SLOT_HEIGHT
    })),
    widgets: widgets.map((widget, index) => ({
      ...widget,
      y: widgetTop + index * (WIDGET_HEIGHT + WIDGET_GAP)
    }))
  }
}

function linkParts(value: unknown): [string, number, string, number, string] | null {
  if (Array.isArray(value) && value.length >= 6) {
    const [id, origin, originSlot, target, targetSlot, type] = value
    if (typeof originSlot === 'number' && typeof targetSlot === 'number') {
      return [String(origin), originSlot, String(target), targetSlot, String(type ?? id)]
    }
  }
  const entry = record(value)
  if (entry && typeof entry.origin_slot === 'number' && typeof entry.target_slot === 'number') {
    return [
      String(entry.origin_id),
      entry.origin_slot,
      String(entry.target_id),
      entry.target_slot,
      String(entry.type ?? '*')
    ]
  }
  return null
}

function curve(from: GraphSlot, to: GraphSlot): string {
  const reach = Math.max(40, Math.abs(to.x - from.x) / 2)
  return `M${from.x},${from.y} C${from.x + reach},${from.y} ${to.x - reach},${to.y} ${to.x},${to.y}`
}

function shownInputIndex(node: Json, slot: number): number {
  const inputs = slotsOf(node.inputs)
  if (slot >= inputs.length || !isLinkSlot(inputs[slot]!)) return -1
  return inputs.slice(0, slot).filter(isLinkSlot).length
}

export function layOutGraph(graph: Record<string, unknown> | null): GraphLayout | null {
  if (!graph || !Array.isArray(graph.nodes)) return null
  const names = subgraphNames(graph)
  const rawById = new Map<string, Json>()
  const nodes: GraphNode[] = []
  for (const raw of graph.nodes.slice(0, MAX_NODES)) {
    const node = record(raw)
    if (!node) continue
    const placed = layOutNode(node, names)
    if (!placed) continue
    nodes.push(placed)
    rawById.set(placed.id, node)
  }
  if (nodes.length === 0) return null
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const links: GraphLink[] = []
  for (const [index, raw] of (Array.isArray(graph.links) ? graph.links : []).entries()) {
    const parts = linkParts(raw)
    if (!parts) continue
    const [originId, originSlot, targetId, targetSlot, type] = parts
    const origin = byId.get(originId)?.outputs[originSlot]
    const targetNode = byId.get(targetId)
    const rawTarget = rawById.get(targetId)
    const target =
      targetNode && rawTarget
        ? targetNode.inputs[shownInputIndex(rawTarget, targetSlot)]
        : undefined
    if (origin && target) links.push({ id: String(index), type, path: curve(origin, target) })
  }
  const groups: GraphGroup[] = (Array.isArray(graph.groups) ? graph.groups : []).flatMap((raw) => {
    const group = record(raw)
    const bounding = Array.isArray(group?.bounding) ? group.bounding : null
    if (
      !group ||
      !bounding ||
      bounding.length < 4 ||
      !bounding.every((n) => typeof n === 'number')
    ) {
      return []
    }
    const [x, y, width, height] = bounding as number[]
    return [
      {
        title: label(group.title, ''),
        x: x!,
        y: y!,
        width: width!,
        height: height!,
        color:
          typeof group.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(group.color)
            ? group.color
            : '#3f789e'
      }
    ]
  })
  const boxes = [
    ...nodes.map((node) => ({
      x: node.x,
      y: node.y - TITLE_HEIGHT,
      width: node.width,
      height: node.height + TITLE_HEIGHT
    })),
    ...groups
  ]
  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const bottom = Math.max(...boxes.map((box) => box.y + box.height))
  return {
    nodes,
    links,
    groups,
    bounds: { x: left, y: top, width: right - left, height: bottom - top }
  }
}

export const GRAPH_TITLE_HEIGHT = TITLE_HEIGHT
export const GRAPH_WIDGET_HEIGHT = WIDGET_HEIGHT

const LINK_COLORS: Record<string, string> = {
  MODEL: '#b39ddb',
  CLIP: '#ffd500',
  VAE: '#ff6e6e',
  CONDITIONING: '#ffa931',
  LATENT: '#ff9cf9',
  IMAGE: '#64b5f6',
  MASK: '#81c784',
  VIDEO: '#4dd0e1',
  AUDIO: '#f48fb1',
  INT: '#a5d6a7',
  FLOAT: '#a5d6a7',
  STRING: '#a5d6a7'
}

export function linkColor(type: string): string {
  return LINK_COLORS[type.toUpperCase()] ?? '#9e9e9e'
}
