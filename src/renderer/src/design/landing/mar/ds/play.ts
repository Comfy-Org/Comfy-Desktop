/**
 * The Playground's components (pages/PlaygroundPage.vue, kit/PlayFrame.vue):
 * what each one takes, as controls. Only data here, so the page can list
 * and edit them without loading the app; the frame renders them.
 */
export type Value = string | boolean

export interface Control {
  name: string
  kind: 'text' | 'select' | 'bool'
  options?: string[]
  default: Value
  /** Not a prop: what the frame turns into one (a picture, the label). */
  role?: 'slot' | 'picture' | 'options'
  /** The component's own default, when it has one: usage leaves it out. */
  cd?: Value
  /** A required prop: usage always writes it. */
  required?: boolean
  /** Its inspector group, when the kind doesn't say (kit/PlayFrame.vue). */
  group?: Group
}

export interface PlaySpec {
  id: string
  name: string
  /** Where it lives, from `landing/`. */
  from: string
  note: string
  controls: Control[]
  /** Props the snippet always shows (set by the frame, not a control). */
  fixed?: string
}

const STATUSES = [
  'executing',
  'completed',
  'failed',
  'queued',
  'draft',
  'running',
  'launching',
  'live',
  'paused',
  'stopped',
  'shared',
  'update',
  'changes'
]

export const SPECS: PlaySpec[] = [
  {
    id: 'button',
    name: 'Button',
    from: 'ui/Button.vue',
    note: 'One primary per surface; ghost for rows and icons.',
    controls: [
      { name: 'label', kind: 'text', default: 'Create', role: 'slot' },
      {
        name: 'variant',
        kind: 'select',
        options: ['primary', 'secondary', 'ghost', 'subtle', 'overlay', 'link', 'destructive'],
        default: 'primary',
        cd: 'secondary'
      },
      { name: 'size', kind: 'select', options: ['sm', 'md', 'lg'], default: 'md', cd: 'md' },
      { name: 'disabled', kind: 'bool', default: false }
    ]
  },
  {
    id: 'status',
    name: 'Status chip',
    from: 'mar/pages/MarStatus.vue',
    note: 'The state of a run, build or item. On a picture: dark glass in both themes.',
    controls: [
      { name: 'status', kind: 'select', options: STATUSES, default: 'executing', required: true },
      { name: 'label', kind: 'text', default: '' },
      { name: 'on-media', kind: 'bool', default: false, group: 'Appearance' }
    ]
  },
  {
    id: 'item',
    name: 'Item (card or row)',
    from: 'mar/pages/MarItem.vue',
    note: 'One thing in a library page. Hover it, select it, double-click its name.',
    fixed: ':icon="ComfyWorkflow" :lines="lines"',
    controls: [
      { name: 'name', kind: 'text', default: 'Product shots', required: true },
      { name: 'meta', kind: 'text', default: 'Local · 2h ago' },
      { name: 'layout', kind: 'select', options: ['grid', 'list'], default: 'grid', cd: 'grid' },
      { name: 'status', kind: 'select', options: ['', ...STATUSES], default: '' },
      { name: 'picture', kind: 'bool', default: true, role: 'picture' },
      { name: 'selecting', kind: 'bool', default: false },
      { name: 'selected', kind: 'bool', default: false },
      { name: 'renaming', kind: 'bool', default: false }
    ]
  },
  {
    id: 'empty',
    name: 'Empty state',
    from: 'mar/pages/MarEmpty.vue',
    note: 'Every place with nothing in it, no results or an error.',
    fixed: ':icon="ComfyWorkflow"',
    controls: [
      { name: 'title', kind: 'text', default: 'No workflows yet', required: true },
      {
        name: 'text',
        kind: 'text',
        default: 'Start from a template, or open ComfyUI and save what you make.',
        required: true
      },
      { name: 'action', kind: 'text', default: 'Browse templates' },
      { name: 'second', kind: 'text', default: '' },
      { name: 'pictures', kind: 'bool', default: true, role: 'picture' },
      { name: 'compact', kind: 'bool', default: false, group: 'Appearance' },
      { name: 'tone', kind: 'select', options: ['', 'error'], default: '' }
    ]
  },
  {
    id: 'tabs',
    name: 'Tabs',
    from: 'mar/pages/MarSeg.vue',
    note: 'A page’s scopes; the indicator slides to the pick. Click a tab.',
    fixed: 'v-model="tab"',
    controls: [
      { name: 'tabs', kind: 'text', default: 'All, Mine, Shared with me', role: 'options' },
      { name: 'label', kind: 'text', default: 'Scope', required: true }
    ]
  },
  {
    id: 'card',
    name: 'Card',
    from: 'mar/WorkflowCard.vue',
    note: 'Home’s recent work: the picture, the name, where it ran and when.',
    controls: [
      { name: 'title', kind: 'text', default: 'hero-shot-v4', required: true },
      { name: 'meta', kind: 'text', default: 'My Local 1', required: true },
      { name: 'right', kind: 'text', default: '12 min ago' }
    ],
    fixed: ':src="picture"'
  },
  {
    id: 'tooltip',
    name: 'Tooltip',
    from: 'ui/Tooltip.vue',
    note: 'Names an icon-only control. Hover the button.',
    controls: [
      { name: 'content', kind: 'text', default: 'Notifications', required: true },
      {
        name: 'side',
        kind: 'select',
        options: ['top', 'bottom', 'left', 'right'],
        default: 'bottom',
        cd: 'top'
      }
    ]
  },
  {
    id: 'banner',
    name: 'What’s new banner',
    from: 'mar/LaunchBanner.vue',
    note: 'One launch at a time on Home; the dots step through them.',
    controls: []
  }
]

/** The controls' values, defaults filled in. */
export function filled(spec: PlaySpec, values: Record<string, Value>): Record<string, Value> {
  return Object.fromEntries(spec.controls.map((c) => [c.name, values[c.name] ?? c.default]))
}

const TAGS: Record<string, string> = {
  button: 'Button',
  status: 'MarStatus',
  item: 'MarItem',
  empty: 'MarEmpty',
  tabs: 'MarSeg',
  card: 'WorkflowCard',
  tooltip: 'Tooltip',
  banner: 'LaunchBanner'
}

/** The Vue template for these values: only what differs from the default. */
export function usage(spec: PlaySpec, values: Record<string, Value>): string {
  const tag = TAGS[spec.id]!
  const v = filled(spec, values)
  const attrs: string[] = spec.fixed ? [spec.fixed] : []
  let slot = ''
  for (const c of spec.controls) {
    const x = v[c.name]
    if (c.role === 'slot') slot = String(x)
    else if (c.role === 'picture') {
      if (x) attrs.push(spec.id === 'item' ? ':thumb="thumb(id)"' : ':pics="EMPTY_PICS.workflows"')
    } else if (c.role === 'options') {
      const opts = String(x)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((l) => `{ value: '${l.toLowerCase().replace(/\W+/g, '-')}', label: '${l}' }`)
      attrs.push(`:options="[${opts.join(', ')}]"`)
    } else if (!c.required && (x === '' || x === false || x === c.cd)) continue
    else if (typeof x === 'boolean') attrs.push(x ? c.name : `:${c.name}="false"`)
    else attrs.push(`${c.name}="${x}"`)
  }
  const open = `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}`
  if (spec.id === 'tooltip')
    return `${open}>\n  <Button variant="ghost" size="icon-sm" aria-label="${v.content}"><Bell :size="15" /></Button>\n</${tag}>`
  return slot ? `${open}>${slot}</${tag}>` : `${open} />`
}

export const importLine = (spec: PlaySpec): string =>
  `import ${TAGS[spec.id]} from '@renderer/design/landing/${spec.from}'`

/** The inspector's groups, in order. */
export const GROUPS = ['Content', 'Appearance', 'State'] as const
export type Group = (typeof GROUPS)[number]

/** Text is content, choices are appearance, switches are state. */
export function groupOf(c: Control): Group {
  if (c.group) return c.group
  if (c.kind === 'text' || c.role === 'picture') return 'Content'
  if (c.kind === 'select') return 'Appearance'
  return 'State'
}

/** “on-media” → “On media”. */
export const labelOf = (c: Control): string => {
  const words = c.name.replace(/-/g, ' ')
  return words[0]!.toUpperCase() + words.slice(1)
}

const esc = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A light highlight for usage, in one pass: keywords, tags, attributes,
 *  strings. */
export function highlight(code: string): string {
  const span = (cls: string, t: string): string => `<span class="${cls}">${t}</span>`
  return esc(code).replace(
    /\b(import|from)\b|(&lt;\/?)([A-Z]\w*)|(\s)(:?[a-z][\w-]*)(?==)|("[^"]*"|'[^']*')/g,
    (m, kw, open, tag, sp, attr, str) =>
      kw
        ? span('t-kw', kw)
        : tag
          ? open + span('t-tag', tag)
          : attr
            ? sp + span('t-attr', attr)
            : str
              ? span('t-str', str)
              : m
  )
}
