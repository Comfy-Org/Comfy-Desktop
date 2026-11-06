/**
 * Motion · every animation in the default view (pages/MotionPage.vue),
 * as read from the code. `src` points at the rule that animates it (file
 * from `landing/` and a string in it); the page shows that rule as it is
 * now, so a change in the code shows up there.
 */
export interface Motion {
  id: string
  name: string
  trigger: string
  duration: string
  easing: string
  props: string
  reduced: string
  src: [file: string, needle: string][]
  /** Something the code does that the rules say otherwise. */
  flag?: string
}

/** Mar's two curves (mar/motion/motion.css). */
export const EASES = [
  { name: '--mar-ease', value: 'cubic-bezier(0.16, 1, 0.3, 1)', use: 'Out-expo: things arriving.' },
  {
    name: '--mar-ease-io',
    value: 'cubic-bezier(0.645, 0.045, 0.355, 1)',
    use: 'In-out: one move on screen (sidebar, breathing).'
  },
  {
    name: '--mar-ease-page',
    value: 'cubic-bezier(0.22, 1, 0.36, 1)',
    use: 'Out-quint: a page coming in. Softer than out-expo, so a short rise reads.'
  },
  {
    name: '--ease-out-expo',
    value: 'cubic-bezier(0.16, 1, 0.3, 1)',
    use: 'Pablo’s token, the same curve (ui/tokens.css).'
  }
]

export const MOTIONS: Motion[] = [
  {
    id: 'tab-pill',
    name: 'Sliding tab pill',
    trigger:
      'Picking an option in any tab group: tabs, segmented rows, Create / Build, Grid / List. Global, no opt-in.',
    duration: '280ms (label colour 200ms)',
    easing: 'var(--mar-ease)',
    props: 'transform, width',
    reduced: 'Jumps (transition: none).',
    src: [
      ['mar/motion/motion.css', '.mar-tab-pill {'],
      ['mar/motion/tabSlide.ts', 'const GROUPS']
    ]
  },
  {
    id: 'menu',
    name: 'Menu and popover enter',
    trigger: 'A menu, select or popover opens; it grows from its trigger.',
    duration: '180ms',
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    props: 'opacity, transform: scale(0.96) → 1, from the trigger’s transform-origin',
    reduced: 'Fades only (animation-name: fade-in).',
    src: [
      ['mar/shell/marShell.css', ")[data-state='open'] {"],
      ['mar/motion/motion.css', "[role='menu'] {"]
    ],
    flag: '@keyframes mar-menu-in is defined twice: scale(0.96) in marShell.css, scale(0.96) translateY(-4px) in motion.css. The last one loaded wins.'
  },
  {
    id: 'tooltip',
    name: 'Tooltip',
    trigger: 'Pointer rests on a control (300ms delay in the DS).',
    duration: '160ms',
    easing: 'ease-out',
    props: 'opacity',
    reduced: 'No change: a fade is already the reduced form.',
    src: [
      ['ui/Tooltip.vue', 'animate-fade-in'],
      ['ui/tokens.css', '--animate-fade-in']
    ]
  },
  {
    id: 'toast',
    name: 'Toast',
    trigger: 'A confirmation (“Saved to Assets”). Leaves after 2.6s.',
    duration: '200ms opacity, 260ms transform (in and out)',
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    props: 'opacity, transform: translateX(12px) → none',
    reduced: 'Fades, no movement.',
    src: [['mar/pages/MarUndoToast.vue', '.mar-undo-enter-active,']]
  },
  {
    id: 'undo',
    name: 'Undo toast',
    trigger: 'Delete, move or archive on a library page. Stays 6s with Undo, 2.6s without.',
    duration: '200ms opacity, 260ms transform (in and out)',
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    props: 'opacity, transform: translateX(12px) → none',
    reduced: 'Fades, no movement.',
    src: [['mar/pages/MarUndoToast.vue', '.mar-undo-enter-active,']]
  },
  {
    id: 'modal',
    name: 'Modal and scrim',
    trigger: 'Opening a template, Deploy as API.',
    duration: 'modal 220ms, scrim 200ms',
    easing: 'modal cubic-bezier(0.16, 1, 0.3, 1); scrim ease-out',
    props:
      'modal: opacity, transform translate(-50%, -48.5%) scale(0.98) → centred; scrim: opacity',
    reduced: 'No animation.',
    src: [
      ['mar/templateModal/templateModal.css', ".mar-tpl[data-state='open'] {"],
      ['mar/templateModal/templateModal.css', ".mar-tpl-scrim[data-state='open'] {"]
    ]
  },
  {
    id: 'palette',
    name: '⌘K palette open',
    trigger: '⌘K, or the sidebar’s Search row.',
    duration: 'in: scrim 160ms, palette 200ms transform + 160ms opacity; out: 110ms',
    easing: 'transform cubic-bezier(0.16, 1, 0.3, 1); opacity ease',
    props: 'scrim opacity; palette opacity and transform translateY(-6px) scale(0.985) → none',
    reduced: 'Fades only (transform: none).',
    src: [['mar/search/search.css', '.mar-search-enter-active,']]
  },
  {
    id: 'sidebar',
    name: 'Sidebar collapse',
    trigger: 'The sidebar toggle (Classic, the default).',
    duration: '320ms width, margin, padding; 200ms opacity',
    easing: 'cubic-bezier(0.645, 0.045, 0.355, 1); opacity ease',
    props: 'width, margin, padding, opacity (the content fades faster than the width)',
    reduced: 'Fades only (opacity 200ms).',
    src: [['variants/VariantModes.vue', '.sidebar-slide {']]
  },
  {
    id: 'prompt',
    name: 'Prompt opens while typing',
    trigger: 'Focus in Home’s prompt.',
    duration: '320ms',
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    props: 'min-height: 1 line → 3 lines (over the content, not pushing it)',
    reduced: 'Jumps (transition: none).',
    src: [['mar/shell/marShell.css', '.mar-prompt textarea {']]
  },
  {
    id: 'page',
    name: 'Page transition',
    trigger:
      'A page opens from the sidebar, a breadcrumb, a back link or ⌘K. Fade and rise. In only: the old page goes at once; the sidebar, title bar and panels stay still; the new page starts at the top; a click mid-way cancels it.',
    duration:
      'Fade --mar-page-fade 160ms; Rise --mar-page-in 240ms; Stagger 240ms each, --mar-page-step 40ms apart, 5 beats at most (400ms)',
    easing: 'Fade ease-out; Rise and Stagger var(--mar-ease-page)',
    props:
      'opacity; Rise and Stagger also transform translateY(--mar-page-rise 6px, Stagger 8px) → none',
    reduced: 'Every option fades only, 120ms.',
    src: [
      ['mar/motion/motion.css', '--mar-page-in:'],
      ['mar/motion/pageIn.ts', 'export function playPageIn('],
      ['mar/motion/pageTransition.ts', '  onView,']
    ]
  },
  {
    id: 'home-rise',
    name: 'Home entry',
    trigger: 'Home opens: its blocks rise in, one after another.',
    duration: '520ms, each next block 60ms later',
    easing: 'var(--mar-ease)',
    props: 'opacity, transform translateY(10px) → 0',
    reduced: 'No animation.',
    src: [['mar/motion/motion.css', '.mar-home > section,']]
  },
  {
    id: 'banner',
    name: 'What’s new banner',
    trigger: 'Always on Home: slides advance every 7s; the active dot fills; hover pauses.',
    duration: 'dot 300ms width; picture swap 500ms; photo drift 14s, pan 18s',
    easing: 'dot and swap: Tailwind default; drift cubic-bezier(0.37, 0, 0.63, 1); pan ease-in-out',
    props: 'dot width and colour, picture opacity, photo transform',
    reduced:
      'No drift or pan; slides don’t advance (read once at load, so this preview can’t show it).',
    src: [
      ['mar/LaunchBanner.vue', 'const INTERVAL'],
      ['mar/LaunchBanner.vue', 'animation: banner-drift']
    ]
  },
  {
    id: 'card-hover',
    name: 'Card hover and the state chip',
    trigger: 'Pointer over a library card.',
    duration: 'surface 160ms; chip 160ms; star and ⋯ 140ms',
    easing: 'ease',
    props: 'background-color, box-shadow (no size change); the chip steps 26px right for the check',
    reduced: 'Not handled (colour only, so nothing moves far).',
    src: [
      ['mar/pages/MarItem.vue', 'background-color 160ms ease,'],
      ['mar/pages/MarItem.vue', '.mar-item-status {']
    ],
    flag: 'motion.css still lifts `.mar-surface` 2px on hover (translateY(-2px)), against “cards never grow on hover”.'
  },
  {
    id: 'press',
    name: 'Button press',
    trigger: 'Pressing any button.',
    duration: '150ms',
    easing: 'Tailwind default',
    props: 'background-color, color, box-shadow, transform: scale(0.98) while pressed',
    reduced: 'Not handled.',
    src: [['ui/button.variants.ts', 'active:scale-[0.98]']]
  },
  {
    id: 'progress',
    name: 'Progress on a cover',
    trigger: 'A run in flight: the cover’s bottom edge fills.',
    duration: '400ms per step',
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    props: 'width',
    reduced: 'Not handled.',
    src: [['mar/pages/MarAssetsPage.vue', '.mar-asset-progress i {']]
  },
  {
    id: 'running',
    name: 'Running',
    trigger: 'A run executing (spinner) or a build running (the dot breathes).',
    duration: 'spinner 1s per turn (Tailwind spin); dot 1.6s',
    easing: 'spinner linear; dot ease-in-out',
    props: 'spinner rotate; dot opacity',
    reduced: 'Both stop (motion-safe spinner; the dot’s animation: none).',
    src: [
      ['mar/pages/MarStatus.vue', 'motion-safe:animate-spin'],
      ['mar/pages/MarStatus.vue', 'animation: mar-breathe 1.6s']
    ]
  },
  {
    id: 'graph',
    name: 'Graph run states',
    trigger: 'Running a workflow in the graph editor.',
    duration: 'progress 0.2s; working preview 0.4s; breathing 1.6s (audio 1.2s); spinner 0.9s',
    easing: 'progress linear; preview ease; breathing ease-in-out; spinner linear',
    props: 'progress width; preview filter blur(6px) and scale(1.06) until it lands; opacity',
    reduced: 'No transitions or breathing; the spinner slows to 2.4s.',
    src: [
      ['mar/graph/CanvasNode.vue', '.sg-progress i {'],
      ['mar/graph/CanvasNode.vue', '.sg-img.is-working {'],
      ['mar/graph/MarGraph.vue', '.mg-spin {']
    ]
  },
  {
    id: 'glow',
    name: 'Home glow',
    trigger: 'Behind Home (Spotlight, the default).',
    duration: 'Still',
    easing: '—',
    props: 'None: the Spotlight doesn’t move. The Aurora and Bloom backdrops (other knobs) drift.',
    reduced: 'Aurora and Bloom stop.',
    src: [['mar/shell/marShell.css', '.mar-backdrop.is-spotlight .mar-bg {']]
  }
]
