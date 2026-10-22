/**
 * Tailwind v4 theme namespaces: which `--prefix-*` variables belong
 * together, which utilities use them, and how the gallery previews them.
 * Generic to any Tailwind v4 codebase; namespaces not listed here still
 * show up (grouped by their first segment, previewed as values).
 * https://tailwindcss.com/docs/theme#theme-variable-namespaces
 */
export type Preview =
  | 'color'
  | 'font'
  | 'text'
  | 'weight'
  | 'tracking'
  | 'leading'
  | 'radius'
  | 'shadow'
  | 'blur'
  | 'ease'
  | 'animate'
  | 'size'
  | 'aspect'
  | 'spacing'
  | 'value'

export interface Namespace {
  id: string
  label: string
  /** Variable prefix without the leading `--`, e.g. `color-`. */
  prefix: string
  /** Utility prefixes that take a token of this namespace (regex parts). */
  utilities: string[]
  preview: Preview
  description: string
  /** Sizes that should sit on the 4px grid. */
  grid?: boolean
}

export const NAMESPACES: Namespace[] = [
  {
    id: 'color',
    label: 'Color',
    prefix: 'color-',
    utilities: [
      'bg',
      'text',
      'border(?:-[xytrbl]|-[se])?',
      'ring(?:-offset)?',
      'outline',
      'fill',
      'stroke',
      'divide',
      'placeholder',
      'from',
      'via',
      'to',
      'decoration',
      'caret',
      'accent',
      'shadow',
      'inset-shadow',
      'drop-shadow'
    ],
    preview: 'color',
    description:
      'Semantic roles, not values. Pick a token by what the color does (text, border, surface), never because it looks right.'
  },
  {
    id: 'font',
    label: 'Font family',
    prefix: 'font-',
    utilities: ['font'],
    preview: 'font',
    description: 'Typefaces. One for interface text, one for code at most.'
  },
  {
    id: 'text',
    label: 'Type',
    prefix: 'text-',
    utilities: ['text'],
    preview: 'text',
    description: 'Font sizes. Each can carry its own line-height, weight and letter spacing.'
  },
  {
    id: 'font-weight',
    label: 'Font weight',
    prefix: 'font-weight-',
    utilities: ['font'],
    preview: 'weight',
    description: 'Weights for hierarchy. Fewer is calmer.'
  },
  {
    id: 'tracking',
    label: 'Letter spacing',
    prefix: 'tracking-',
    utilities: ['tracking'],
    preview: 'tracking',
    description: 'Letter spacing, including the spacing carried by type sizes.'
  },
  {
    id: 'leading',
    label: 'Line height',
    prefix: 'leading-',
    utilities: ['leading'],
    preview: 'leading',
    grid: true,
    description: 'Line heights, including the ones carried by type sizes. They sit on the 4px grid.'
  },
  {
    id: 'radius',
    label: 'Radius',
    prefix: 'radius-',
    utilities: ['rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee))?'],
    preview: 'radius',
    grid: true,
    description:
      'Inner radius = outer radius − padding between them. A 12 card with 4 padding holds an 8 control.'
  },
  {
    id: 'shadow',
    label: 'Elevation',
    prefix: 'shadow-',
    utilities: ['shadow'],
    preview: 'shadow',
    description: 'Shadows by role: one per elevation level.'
  },
  {
    id: 'inset-shadow',
    label: 'Inset shadow',
    prefix: 'inset-shadow-',
    utilities: ['inset-shadow'],
    preview: 'shadow',
    description: 'Shadows drawn inside an element.'
  },
  {
    id: 'drop-shadow',
    label: 'Drop shadow',
    prefix: 'drop-shadow-',
    utilities: ['drop-shadow'],
    preview: 'value',
    description: 'Filter shadows that follow an element’s shape.'
  },
  {
    id: 'text-shadow',
    label: 'Text shadow',
    prefix: 'text-shadow-',
    utilities: ['text-shadow'],
    preview: 'value',
    description: 'Shadows behind text.'
  },
  {
    id: 'blur',
    label: 'Blur',
    prefix: 'blur-',
    utilities: ['blur', 'backdrop-blur'],
    preview: 'blur',
    grid: true,
    description: 'Blur radii for frosted surfaces and filters.'
  },
  {
    id: 'ease',
    label: 'Easing',
    prefix: 'ease-',
    utilities: ['ease'],
    preview: 'ease',
    description: 'Timing curves. Hover a curve to see it move.'
  },
  {
    id: 'animate',
    label: 'Animation',
    prefix: 'animate-',
    utilities: ['animate'],
    preview: 'animate',
    description: 'Named animations with their keyframes. Play one to see it.'
  },
  {
    id: 'aspect',
    label: 'Aspect ratio',
    prefix: 'aspect-',
    utilities: ['aspect'],
    preview: 'aspect',
    description: 'Shapes for media and frames.'
  },
  {
    id: 'perspective',
    label: 'Perspective',
    prefix: 'perspective-',
    utilities: ['perspective'],
    preview: 'value',
    description: 'Depth for 3D transforms.'
  },
  {
    id: 'breakpoint',
    label: 'Breakpoints',
    prefix: 'breakpoint-',
    utilities: [],
    preview: 'size',
    description: 'Viewport widths for responsive variants (`md:` …).'
  },
  {
    id: 'container',
    label: 'Containers',
    prefix: 'container-',
    utilities: ['max-w', 'min-w', 'w', '@'],
    preview: 'size',
    description: 'Widths for containers and container queries.'
  },
  {
    id: 'spacing',
    label: 'Spacing',
    prefix: 'spacing',
    utilities: [],
    preview: 'spacing',
    description: 'The spacing step behind p-*, m-*, gap-*, w-* … Use whole steps.'
  }
]

/** Sub-properties a token can carry (`--text-ui--line-height`) and the
 *  namespace they belong to. */
export const SUB_NAMESPACE: Record<string, string> = {
  'line-height': 'leading',
  'letter-spacing': 'tracking',
  'font-weight': 'font-weight'
}

// Longest prefix first, so `font-weight-` wins over `font-`.
const BY_PREFIX = [...NAMESPACES].sort((a, b) => b.prefix.length - a.prefix.length)

const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ')

/** The namespace of a variable name (without `--`); unknown ones are
 *  grouped by their first segment. */
export function namespaceOf(name: string): Namespace {
  const known = BY_PREFIX.find((n) =>
    n.id === 'spacing'
      ? name === 'spacing' || name.startsWith('spacing-')
      : name.startsWith(n.prefix)
  )
  if (known) return known
  const first = name.split('-')[0]!
  return {
    id: first,
    label: titleCase(first),
    prefix: `${first}-`,
    utilities: [],
    preview: 'value',
    description: `Custom \`--${first}-*\` variables. Used through var().`
  }
}

export const namespaceById = (id: string): Namespace | undefined =>
  NAMESPACES.find((n) => n.id === id)
export const NAMESPACE_ORDER = NAMESPACES.map((n) => n.id)
