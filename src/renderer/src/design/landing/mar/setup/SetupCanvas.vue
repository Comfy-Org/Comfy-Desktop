<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import AuditScreen, { type AuditScreenId } from './AuditScreen.vue'
import FirstOption from './FirstOption.vue'
import SetupOption from './SetupOption.vue'
import StarterOption from './StarterOption.vue'
import TemplatePlaceOption from './TemplatePlaceOption.vue'
import { canvas } from './setupFlow'
import Button from '../../ui/Button.vue'
import './canvas.css'

/**
 * The local setup canvas (`?canvas=first`, or UI Playground › Local setup ›
 * Compare cards), one page at a time. Options pages lay takes side by
 * side; audit pages set each screen today next to the proposal, with the
 * changes listed to approve one by one. Every frame is the real 1440×900
 * screen scaled down, so proportions hold.
 */
interface Note {
  id: string
  text: string
}
interface Page {
  id: string
  group: 'Options' | 'Audit'
  label: string
  title: string
  lead: string
  /** Audit pages: the frames to compare, each with its caption. */
  frames?: { caption: string; screen?: AuditScreenId; proposed?: boolean; setup?: number }[]
  small?: boolean
  notes?: Note[]
}

const FIRST_OPTIONS = [
  ['Centred group', 'One block in the middle; the pick is a ring and a lifted surface.'],
  ['Radio in the card', 'An inline radio leads each card, no icon.'],
  ['Footer bar', 'Larger choice; consent and Continue in a bar along the bottom.'],
  ['Split', 'Question and consent left, the choice and Continue right.'],
  ['One list', 'Both ways in one grouped list with radios, as Set up.'],
  ['Segmented', 'Cloud | Local as a segmented control, details below.'],
  ['Edge bar', 'Compact rows; the pick marked by a bar on its edge.'],
  ['Underline', 'The pick marked by a line along its foot.'],
  ['Dim the other', 'The pick at full strength, the other recedes.'],
  ['Tiles', 'Square tiles, a large icon and a corner radio.']
]
const STARTER_OPTIONS = [
  ['Row', "Four tall pictures side by side, as the Home's examples."],
  ['Bento', 'The recommended one big, the other three beside it.'],
  ['Feature', 'Small pictures to pick from, the pick large with what it downloads.'],
  ['Mixed, no tabs', 'The recommended one of each type, as the Home mixes its examples.'],
  ['Text filters', "The tabs as the Home's quiet text filters, on the title line."],
  ['Mixed bento', 'The recommended one of each type, the first one big.']
]
const SETUP_OPTIONS = [
  ['Spec line', 'The machine as one line with its own Change; two rows below.'],
  ['One list', 'Machine, Location and Version in one list, each with its own Change.'],
  ['Edit in place', 'Change opens the row where it is (Location shown open).'],
  ['Drawn machine', 'A compact card with a drawn laptop instead of the gradient.'],
  ['With totals', 'The list ends on the download, the space it takes and what is free.'],
  ['Workflow as a row', 'The starter workflow joins the list: None · Choose.'],
  ['Checked', 'What the checks found, as a checklist, each line changeable.'],
  ['Stat tiles', 'Memory, free space and download as three numbers.'],
  ['Two columns', 'Question and machine on the left, the list on the right.'],
  ['One sentence', 'The setup as a sentence; each value is the control that changes it.']
]
const TEMPLATE_PLACES = [
  [
    'A row of Set up',
    'Workflow joins the summary; Choose opens the picker. Three steps stay. Easy to miss.'
  ],
  [
    'Its own step, as today',
    "Today's picker between Set up and Install, with Skip & Install. Nothing new; one more step."
  ],
  [
    'While it installs',
    'The picker takes the showcase panel; its models join as a last step. The space check moves after Install.'
  ],
  [
    'On Builds, after the install',
    'A shelf under the new build; picking downloads the models, then opens. Adds a section to M1 Builds.'
  ],
  [
    'A closing screen',
    'The install ends on a choice: open empty or with a workflow. One more screen; models download after the wait.'
  ]
]

const PAGES: Page[] = [
  {
    id: 'first-options',
    group: 'Options',
    label: 'First screen',
    title: 'First screen · 10 options',
    lead: 'Proportions, how the pick is marked, where consent and Continue sit.'
  },
  {
    id: 'setup-options',
    group: 'Options',
    label: 'Set up',
    title: 'Set up · 10 options',
    lead: 'In place of the gradient machine card and the two rows below it.'
  },
  {
    id: 'starter-options',
    group: 'Options',
    label: 'Starter workflow',
    title: 'Starter workflow · in the Home’s style',
    lead: 'The Home’s example cards: the picture is the card, the name on it. Click to pick.'
  },
  {
    id: 'template-places',
    group: 'Options',
    label: 'Templates in M1',
    title: 'Templates in M1 · where they go',
    lead: 'M1 has no Home, so the starter workflow needs a place. Every take keeps today’s behaviour: picking one brings its models.'
  },
  {
    id: 'frame',
    group: 'Audit',
    label: 'All screens',
    title: 'All screens · one frame',
    lead: 'Today on top, proposed below. The line marks where the actions sit.',
    small: true,
    frames: [
      { caption: 'Today · First screen', screen: 'first' },
      { caption: 'Today · Set up', screen: 'setup' },
      { caption: 'Today · Starter workflow', screen: 'workflow' },
      { caption: 'Today · Install', screen: 'install' },
      { caption: 'Proposed · First screen', screen: 'first', proposed: true },
      { caption: 'Proposed · Set up', screen: 'setup', proposed: true },
      { caption: 'Proposed · Starter workflow', screen: 'workflow', proposed: true },
      { caption: 'Proposed · Install', screen: 'install', proposed: true }
    ],
    notes: [
      {
        id: 'frame-center',
        text: 'Content centred between the steps and the actions, instead of above centre with the bottom 40% empty.'
      },
      { id: 'frame-steps', text: 'A step indicator on top: Run on, Set up, Workflow, Install.' },
      {
        id: 'frame-bar',
        text: 'One action bar, in the same place on every screen. Today Continue, Install and Return to Dashboard each sit at a different height.'
      }
    ]
  },
  {
    id: 'first',
    group: 'Audit',
    label: 'First screen',
    title: 'First screen',
    lead: 'Continue that explains itself, and copy that matches the default.',
    frames: [
      { caption: 'Today', screen: 'first' },
      { caption: 'Proposed', screen: 'first', proposed: true }
    ],
    notes: [
      {
        id: 'first-continue',
        text: "Continue stays enabled. Clicked without the terms, the terms check is ringed and reads 'Agree to continue.'"
      },
      {
        id: 'first-terms',
        text: 'The terms check sits next to Continue, in the action bar. Usage data and beta stay on the page, on by default as today.'
      },
      {
        id: 'first-copy',
        text: "Copy: Cloud's 'Best for most users who want…' becomes 'Best for powerful GPUs and…', so it no longer contradicts Local being preselected."
      }
    ]
  },
  {
    id: 'setup',
    group: 'Audit',
    label: 'Set up',
    title: 'Set up',
    lead: 'Each line changes itself. The card itself is picked on the Set up options page.',
    frames: [
      { caption: 'Today', screen: 'setup' },
      { caption: 'Proposed', screen: 'setup', proposed: true }
    ],
    notes: [
      {
        id: 'setup-card',
        text: 'The gradient machine card becomes a Machine row, the first of the list.'
      },
      {
        id: 'setup-change',
        text: 'Every row has its own Change, instead of one Change on the machine card that edits everything.'
      },
      {
        id: 'setup-inplace',
        text: 'Change opens the row in place (Location shown open, with Browse…). Today the rows look tappable and are not.'
      }
    ]
  },
  {
    id: 'change',
    group: 'Audit',
    label: 'Change setup',
    title: 'Change setup',
    lead: 'Plain words, one option style, and a Back that says what it does.',
    frames: [
      { caption: 'Today', screen: 'change' },
      { caption: 'Proposed', screen: 'change', proposed: true }
    ],
    notes: [
      {
        id: 'change-words',
        text: "Copy: 'Install method · Public Builds / Managed Builds' becomes 'Get ComfyUI from · Official release / Your team's builds'."
      },
      {
        id: 'change-remote',
        text: "Remote Connection leaves the switch, since it isn't an install and swaps the whole form: a link under it, 'Connect to a server instead'."
      },
      {
        id: 'change-hardware',
        text: 'Hardware draws both choices the same way: a radio card each, Detected as a badge.'
      },
      {
        id: 'change-back',
        text: "Back becomes 'Discard changes' and Done becomes 'Save changes'."
      }
    ]
  },
  {
    id: 'workflow',
    group: 'Audit',
    label: 'Starter workflow',
    title: 'Starter workflow',
    lead: 'A light default, the size on the button, and the pick off the photo.',
    frames: [
      { caption: 'Today', screen: 'workflow' },
      { caption: 'Proposed', screen: 'workflow', proposed: true },
      { caption: 'Alternative · folded into Set up', setup: 6 }
    ],
    notes: [
      {
        id: 'wf-default',
        text: 'No heavy default: the lightest (SDXL Turbo, 6.9 GB) or none starts picked, not Z-Image-Turbo (20.8 GB).'
      },
      {
        id: 'wf-total',
        text: "Install shows the total download: 'Install · 8.1 GB' (ComfyUI plus the picked workflow). Skip & Install becomes 'Skip workflow'."
      },
      { id: 'wf-tabs', text: 'The tab bar spans the width of the grid.' },
      {
        id: 'wf-check',
        text: "The pick is a radio in the card's foot, not a small check on the photo."
      },
      { id: 'wf-cloud', text: "Seedream gets a 'Runs on Cloud' tag next to 'No download'." },
      {
        id: 'wf-dupe',
        text: 'One model per card: today the same model shows in 2 of the 4 cards. Needs the curated list fixed.'
      },
      {
        id: 'wf-fold',
        text: 'Alternative: no workflow step; the workflow is a row of Set up, None · Choose.'
      }
    ]
  },
  {
    id: 'install',
    group: 'Audit',
    label: 'Install',
    title: 'Install',
    lead: 'Status first, named for what it installs, one way out.',
    frames: [
      { caption: 'Today', screen: 'install' },
      { caption: 'Proposed', screen: 'install', proposed: true }
    ],
    notes: [
      { id: 'in-status', text: 'Status first: the title and the steps lead, nothing above them.' },
      {
        id: 'in-models',
        text: "A 'Download models' step with its size, so the workflow's models aren't a surprise."
      },
      {
        id: 'in-named',
        text: "Named for the workflow: 'Getting Z-Image-Turbo ready', with its image, instead of generic clips."
      },
      { id: 'in-pitch', text: 'The Cloud pitch is one line in the action bar.' },
      {
        id: 'in-cancel',
        text: "'Return to Dashboard' becomes 'Cancel install' on a first install, when there is no dashboard yet."
      }
    ]
  },
  {
    id: 'two',
    group: 'Audit',
    label: 'Two columns',
    title: 'Alternative · two columns',
    lead: 'The decision on the left, a live summary on the right that becomes the progress.',
    frames: [
      { caption: 'Starter workflow', screen: 'two-workflow', proposed: true },
      { caption: 'Install', screen: 'two-install', proposed: true }
    ],
    notes: [
      {
        id: 'two-summary',
        text: 'The summary (machine, location, version, workflow, total) stays on the right from Set up on.'
      },
      {
        id: 'two-progress',
        text: 'During the install the same summary turns into the progress, row by row.'
      },
      {
        id: 'two-time',
        text: 'The total shows size only: a time needs a measured download speed, which Set up does not have yet.'
      }
    ]
  }
]

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* private window: the canvas still works, it just forgets */
  }
}

const pageId = ref(read('comfy.design.mar.canvasPage', 'first-options'))
const page = computed<Page>(() => PAGES.find((p) => p.id === pageId.value) ?? (PAGES[0] as Page))
const prev = computed(() => PAGES[PAGES.indexOf(page.value) - 1])
const next = computed(() => PAGES[PAGES.indexOf(page.value) + 1])
const scroller = ref<HTMLElement>()
function go(id: string): void {
  pageId.value = id
  scroller.value?.scrollTo({ top: 0 })
}
watch(pageId, (v) => write('comfy.design.mar.canvasPage', v))

type Verdict = 'yes' | 'no'
const verdicts = reactive<Record<string, Verdict>>(read('comfy.design.mar.auditVerdicts', {}))
function judge(id: string, v: Verdict): void {
  if (verdicts[id] === v) delete verdicts[id]
  else verdicts[id] = v
  write('comfy.design.mar.auditVerdicts', verdicts)
}
const approved = (p: Page): number => (p.notes ?? []).filter((n) => verdicts[n.id] === 'yes').length
</script>

<template>
  <div ref="scroller" class="proto-ui mss-canvas">
    <header class="mss-canvas-head">
      <nav class="mss-canvas-nav" aria-label="Canvas pages">
        <template v-for="g in ['Options', 'Audit'] as const" :key="g">
          <span class="mss-canvas-group">{{ g }}</span>
          <Button
            v-for="p in PAGES.filter((x) => x.group === g)"
            :key="p.id"
            size="sm"
            :variant="p.id === page.id ? 'secondary' : 'ghost'"
            @click="go(p.id)"
            >{{ p.label
            }}<span v-if="p.notes" class="mss-canvas-count"
              >{{ approved(p) }}/{{ p.notes.length }}</span
            ></Button
          >
        </template>
      </nav>
      <Button variant="secondary" size="sm" @click="canvas = false">Close</Button>
    </header>

    <div class="mss-canvas-title">
      <h1>{{ page.title }}</h1>
      <p>{{ page.lead }}</p>
    </div>

    <!-- Options pages: ten takes, two by two. -->
    <div v-if="page.id === 'first-options'" class="mss-canvas-grid">
      <figure v-for="(o, i) in FIRST_OPTIONS" :key="o[0]" class="mss-canvas-item">
        <figcaption>
          <b>{{ i + 1 }} · {{ o[0] }}</b> <span>{{ o[1] }}</span>
        </figcaption>
        <div class="mss-canvas-frame"><FirstOption :option="i + 1" /></div>
      </figure>
    </div>
    <div v-else-if="page.id === 'setup-options'" class="mss-canvas-grid">
      <figure v-for="(o, i) in SETUP_OPTIONS" :key="o[0]" class="mss-canvas-item">
        <figcaption>
          <b>{{ i + 1 }} · {{ o[0] }}</b> <span>{{ o[1] }}</span>
        </figcaption>
        <div class="mss-canvas-frame"><SetupOption :option="i + 1" /></div>
      </figure>
    </div>
    <div v-else-if="page.id === 'starter-options'" class="mss-canvas-grid">
      <figure v-for="(o, i) in STARTER_OPTIONS" :key="o[0]" class="mss-canvas-item">
        <figcaption>
          <b>{{ i + 1 }} · {{ o[0] }}</b> <span>{{ o[1] }}</span>
        </figcaption>
        <div class="mss-canvas-frame"><StarterOption :option="i + 1" /></div>
      </figure>
    </div>

    <div v-else-if="page.id === 'template-places'" class="mss-canvas-grid">
      <figure v-for="(o, i) in TEMPLATE_PLACES" :key="o[0]" class="mss-canvas-item">
        <figcaption>
          <b>{{ i + 1 }} · {{ o[0] }}</b> <span>{{ o[1] }}</span>
        </figcaption>
        <div class="mss-canvas-frame"><TemplatePlaceOption :option="i + 1" /></div>
      </figure>
    </div>

    <!-- Audit pages: today next to the proposal, then the changes. -->
    <template v-else>
      <div class="mss-canvas-grid" :class="page.small && 'is-small'">
        <figure v-for="f in page.frames" :key="f.caption" class="mss-canvas-item">
          <figcaption>
            <b>{{ f.caption }}</b>
          </figcaption>
          <div class="mss-canvas-frame" :class="page.small && 'is-small'">
            <SetupOption v-if="f.setup" :option="f.setup" />
            <AuditScreen v-else-if="f.screen" :screen="f.screen" :proposed="f.proposed" />
            <span v-if="page.small" class="mss-canvas-guide" aria-hidden="true"></span>
          </div>
        </figure>
      </div>
      <ol class="mss-canvas-notes">
        <li
          v-for="(n, i) in page.notes"
          :key="n.id"
          :class="verdicts[n.id] && `is-${verdicts[n.id]}`"
        >
          <span class="mss-canvas-n">{{ i + 1 }}</span>
          <span class="mss-canvas-note">{{ n.text }}</span>
          <Button
            size="sm"
            :variant="verdicts[n.id] === 'yes' ? 'primary' : 'secondary'"
            @click="judge(n.id, 'yes')"
            >Approve</Button
          >
          <Button
            size="sm"
            :variant="verdicts[n.id] === 'no' ? 'secondary' : 'ghost'"
            @click="judge(n.id, 'no')"
            >Not this</Button
          >
        </li>
      </ol>
    </template>

    <footer class="mss-canvas-pager">
      <Button v-if="prev" variant="ghost" size="sm" @click="go(prev.id)">← {{ prev.label }}</Button>
      <span class="flex-1"></span>
      <Button v-if="next" variant="secondary" size="sm" @click="go(next.id)"
        >Next: {{ next.group === 'Audit' ? 'Audit · ' : '' }}{{ next.label }} →</Button
      >
    </footer>
  </div>
</template>

<style>
.mss-canvas {
  position: fixed;
  inset: 0;
  z-index: 90;
  overflow: auto;
  padding: 24px 40px 40px;
  background: oklch(0.16 0.003 285);
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
.mss-canvas-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.mss-canvas-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.mss-canvas-group {
  margin: 0 6px 0 14px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.mss-canvas-group:first-child {
  margin-left: 0;
}
.mss-canvas-count {
  margin-left: 6px;
  color: var(--color-subtle-foreground);
  font-variant-numeric: tabular-nums;
}
.mss-canvas-title {
  margin-top: 28px;
}
.mss-canvas-title h1 {
  color: var(--color-base-foreground);
  font-size: var(--text-title, 24px);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.mss-canvas-title p {
  margin-top: 6px;
}
.mss-canvas-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 648px);
  gap: 40px 32px;
  margin-top: 24px;
}
.mss-canvas-grid.is-small {
  grid-template-columns: repeat(4, 317px);
  gap: 28px 16px;
}
.mss-canvas-item figcaption {
  margin-bottom: 10px;
}
.mss-canvas-item figcaption b {
  margin-right: 6px;
  color: var(--color-base-foreground);
  font-weight: 600;
}
/* The real screen at 1440×900, scaled to 648×405 (0.45), or 317×198. */
.mss-canvas-frame {
  position: relative;
  width: 648px;
  height: 405px;
  overflow: hidden;
  border-radius: 12px;
  box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.08);
}
.mss-canvas-frame > .fo {
  transform: scale(0.45);
  transform-origin: 0 0;
}
.mss-canvas-frame.is-small {
  width: 317px;
  height: 198px;
  border-radius: 8px;
}
.mss-canvas-frame.is-small > .fo {
  transform: scale(0.22);
}
/* Where the proposed action bar sits, drawn over every frame. */
.mss-canvas-guide {
  position: absolute;
  right: 0;
  bottom: calc(42px * 0.22);
  left: 0;
  border-top: 1px dashed oklch(1 0 0 / 0.35);
}
.mss-canvas-notes {
  display: grid;
  max-width: 1328px;
  margin-top: 32px;
  overflow: hidden;
  border-radius: 14px;
  background: oklch(1 0 0 / 0.03);
  box-shadow: inset 0 0 0 1px oklch(1 0 0 / 0.08);
}
.mss-canvas-notes li {
  display: grid;
  grid-template-columns: 24px 1fr auto auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px 12px 16px;
}
.mss-canvas-notes li + li {
  box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.08);
}
.mss-canvas-note {
  color: var(--color-base-foreground);
  text-wrap: pretty;
}
.mss-canvas-notes li.is-no .mss-canvas-note {
  color: var(--color-subtle-foreground);
  text-decoration: line-through;
}
.mss-canvas-n {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: oklch(1 0 0 / 0.08);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.mss-canvas-notes li.is-yes .mss-canvas-n {
  background: var(--color-base-foreground);
  color: var(--color-content-background);
}
.mss-canvas-pager {
  display: flex;
  max-width: 1328px;
  align-items: center;
  margin-top: 32px;
}
</style>
