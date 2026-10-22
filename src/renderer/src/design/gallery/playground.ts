import { reactive } from 'vue'

/**
 * Component playground: per component, the props the tweak panel can edit,
 * and their current values. Sections render a live specimen from `state`;
 * the panel renders controls from `CONTROLS`. Option lists mirror the
 * component's cva variants.
 */
export type Control =
  | { key: string; label: string; type: 'select' | 'segment'; options: string[] }
  | { key: string; label: string; type: 'toggle' }
  | { key: string; label: string; type: 'text' }

export const CONTROLS = {
  button: [
    {
      key: 'variant',
      label: 'Variant',
      type: 'select',
      options: ['primary', 'secondary', 'ghost', 'subtle', 'overlay', 'link', 'destructive']
    },
    { key: 'size', label: 'Size', type: 'segment', options: ['sm', 'md', 'lg'] },
    { key: 'label', label: 'Label', type: 'text' },
    { key: 'icon', label: 'Leading icon', type: 'toggle' },
    { key: 'disabled', label: 'Disabled', type: 'toggle' },
    { key: 'block', label: 'Full width', type: 'toggle' }
  ],
  badge: [
    {
      key: 'variant',
      label: 'Variant',
      type: 'segment',
      options: ['default', 'outline', 'overlay', 'solid']
    },
    { key: 'size', label: 'Size', type: 'segment', options: ['sm', 'md', 'tag'] },
    { key: 'label', label: 'Label', type: 'text' }
  ],
  card: [
    {
      key: 'variant',
      label: 'Variant',
      type: 'segment',
      options: ['elevated', 'glass', 'dashed', 'inset']
    },
    { key: 'padding', label: 'Padding', type: 'segment', options: ['xs', 'sm', 'md', 'lg'] },
    { key: 'interactive', label: 'Interactive', type: 'toggle' }
  ],
  field: [
    { key: 'kind', label: 'Control', type: 'segment', options: ['input', 'search', 'select'] },
    { key: 'size', label: 'Size', type: 'segment', options: ['sm', 'md', 'lg'] },
    { key: 'placeholder', label: 'Placeholder', type: 'text' },
    { key: 'mono', label: 'Monospace', type: 'toggle' }
  ],
  segmented: [
    { key: 'variant', label: 'Variant', type: 'segment', options: ['plain', 'contained'] },
    { key: 'size', label: 'Size', type: 'segment', options: ['sm', 'md'] },
    { key: 'icons', label: 'Icons', type: 'toggle' },
    { key: 'counts', label: 'Counts', type: 'toggle' }
  ],
  avatar: [
    { key: 'size', label: 'Size', type: 'segment', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
    { key: 'tone', label: 'Tone', type: 'segment', options: ['default', 'solid'] }
  ],
  empty: [
    { key: 'layout', label: 'Layout', type: 'segment', options: ['stack', 'inline'] },
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'action', label: 'Action', type: 'toggle' }
  ]
} satisfies Record<string, Control[]>

export type PlaygroundKey = keyof typeof CONTROLS

export const state = reactive({
  button: {
    variant: 'primary',
    size: 'md',
    label: 'Open ComfyUI',
    icon: true,
    disabled: false,
    block: false
  },
  badge: { variant: 'default', size: 'sm', label: 'Running' },
  card: { variant: 'elevated', padding: 'md', interactive: true },
  field: { kind: 'input', size: 'md', placeholder: 'Name your workflow', mono: false },
  segmented: { variant: 'contained', size: 'md', icons: true, counts: true },
  avatar: { size: 'lg', tone: 'default' },
  empty: {
    layout: 'stack',
    title: 'No workflows yet',
    description: 'Describe what you want and the agent wires up the nodes.',
    action: true
  }
} as Record<PlaygroundKey, Record<string, string | boolean>>)

export const LABELS: Record<PlaygroundKey, string> = {
  button: 'Button',
  badge: 'Badge',
  card: 'Card',
  field: 'Fields',
  segmented: 'Segmented control',
  avatar: 'Avatar',
  empty: 'Empty state'
}
