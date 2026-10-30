<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy, FolderInput, Pencil, Trash2 } from 'lucide-vue-next'
import { thumb } from '../../../mock'
import Button from '../../../ui/Button.vue'
import { ComfyWorkflow } from '../../icons/comfyIcons'
import MarItem from '../../pages/MarItem.vue'
import MarItemMenu from '../../pages/MarItemMenu.vue'
import MarSearchField from '../../pages/MarSearchField.vue'
import MarSeg from '../../pages/MarSeg.vue'
import MarUndoToast from '../../pages/MarUndoToast.vue'
import { collection } from '../../pages/collection'
import { useLibrary } from '../../pages/library'
import type { MenuLine } from '../../pages/menu'
import AppShot from '../kit/AppShot.vue'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import Stage from '../kit/Stage.vue'
import KeysBlock from '../kit/KeysBlock.vue'
import { useMode } from '../kit/mode'

/**
 * Interactions: keyboard and pointer, each a live demo with the real
 * component and the keys it answers to (read from its code).
 */
// Details: the keys alone, without the demos.
const details = useMode().mode === 'details'
const tab = ref('all')
const TABS = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'shared', label: 'Shared with me' }
]
const query = ref('')

const MENU: MenuLine[] = [
  { label: 'Open', icon: ComfyWorkflow },
  { label: 'Rename', icon: Pencil },
  { label: 'Duplicate', icon: Copy },
  {
    label: 'Move to project',
    icon: FolderInput,
    sub: [{ label: 'Hero shots' }, { label: 'Flux tests' }, { label: 'Product campaign' }]
  },
  'sep',
  { label: 'Delete', icon: Trash2, danger: true }
]

// The library pages' own wiring: selection, rename in place, delete with Undo.
const PICS = [
  'image_flux2',
  'image_z_image_turbo',
  'video_ltx2_5_i2v',
  'image_qwen_image_edit_2511',
  'template_product_placement'
]
const col = collection(
  ['Product shots', 'Portrait relight', 'Teaser cut', 'Packshot clean-up', 'Campaign hero'].map(
    (name, i) => ({ id: `w${i}`, name, pic: thumb(PICS[i]!) })
  ),
  'workflow'
)
const shown = computed(() => col.items)
const lib = useLibrary(col, shown)
const lines = (id: string): MenuLine[] => [
  { label: 'Rename', icon: Pencil, run: () => (lib.renaming.value = id) },
  'sep',
  { label: 'Delete', icon: Trash2, danger: true, run: () => col.remove([id]) }
]

const KEYS = {
  focus: [
    ['Tab / ⇧Tab', 'Move between controls; the ring shows only for the keyboard (focus-visible).']
  ],
  tabs: [
    ['Tab', 'Each tab is its own stop.'],
    ['Enter / Space', 'Pick the focused tab; the indicator slides to it.']
  ],
  menu: [
    ['Enter / Space / ↓', 'Open the menu on its trigger.'],
    ['↑ ↓', 'Move between items (roving focus; disabled ones are skipped).'],
    ['Home / End', 'First / last item.'],
    ['A–Z', 'Type-ahead: jump to the item that starts with it.'],
    ['→ / ←', 'Open / close a submenu (Move to project).'],
    ['Enter / Space', 'Run the item.'],
    ['Esc', 'Close; focus goes back to the trigger.']
  ],
  runOn: [
    ['A–Z', 'Typing goes to the picker’s filter, ahead of the menu’s own type-ahead.'],
    ['↓', 'From the filter into the list.']
  ],
  search: [
    ['⌘K / Ctrl+K', 'Open (anywhere) or close.'],
    ['↑ ↓ (or Ctrl+P / Ctrl+N)', 'Move through results.'],
    ['← →', 'Along a row of tiles, with the field empty.'],
    ['Tab / ⇧Tab', 'Change scope.'],
    ['Backspace', 'With the field empty: back to All.'],
    ['Enter / ⌘Enter', 'Open / open it in Cloud (where it can).'],
    ['⌘N, ⌘⇧P, ⌘⇧C, ⌘,, ⌘⇧L', 'New workflow, new project, Cloud, settings, theme.'],
    ['Esc', 'Close.']
  ],
  tuner: [['⌘. / Ctrl+.', 'Show or hide UI Playground; Esc closes it.']],
  rename: [
    ['Double-click the name, or ⋯ › Rename', 'The name becomes a field, selected.'],
    ['Enter', 'Save (with Undo in the toast).'],
    ['Esc', 'Cancel.']
  ],
  select: [
    ['Click', 'Open (or select, once anything is selected).'],
    ['⌘/Ctrl-click, or the check', 'Add or remove one.'],
    ['⇧-click', 'Select the range from the last one.'],
    ['⌘A / Ctrl+A', 'Select all.'],
    ['Esc', 'Clear the selection.'],
    ['Delete / Backspace', 'Delete what’s selected; Undo in the toast (6s).']
  ],
  graph: [
    ['Drag the canvas / a node', 'Pan / move it; drag from a slot to link.'],
    ['⇧ or ⌘-click', 'Add a node to the selection.'],
    ['⌘Z, ⌘⇧Z / ⌘Y', 'Undo, redo.'],
    ['⌘A, ⌘C, ⌘V, ⌘D', 'Select all, copy, paste, duplicate.'],
    ['⌘G', 'Group the selection.'],
    ['⌘B, ⌘M, ⌥C', 'Bypass, mute, collapse.'],
    ['⌘Enter', 'Run.'],
    ['/ or N', 'Add a node (search at the centre).'],
    ['A', 'Show or hide assets.'],
    ['Delete', 'Remove the selection or the selected link.'],
    ['Esc', 'Close the menu, clear the selection.']
  ]
} as const
</script>

<template>
  <div class="ds-ia">
    <Section
      title="Focus rings"
      note="Keyboard only: a 2px ring in --color-border-focus (focus-visible), never on click."
    >
      <Cells v-if="!details" :min="300">
        <Cell label="live: press Tab" fill>
          <div class="ds-ia-row">
            <Button variant="primary">Create</Button>
            <Button variant="ghost">Cancel</Button>
            <MarSearchField v-model="query" placeholder="Search" />
          </div>
        </Cell>
        <Cell label="forced: focus-visible" fill force="focus" target="button">
          <div class="ds-ia-row"><Button variant="primary">Create</Button></div>
        </Cell>
      </Cells>
      <KeysBlock>
        <template v-for="[k, v] in KEYS.focus" :key="k"
          ><dt>{{ k }}</dt>
          <dd>{{ v }}</dd></template
        >
      </KeysBlock>
    </Section>

    <Section
      title="Tabs"
      note="A tablist of buttons. Today each tab is its own Tab stop; there are no arrow keys between tabs yet (the ARIA tabs pattern uses ← →)."
    >
      <Cells v-if="!details" :min="300">
        <Cell label="live" fill><MarSeg v-model="tab" :options="TABS" label="Scope" /></Cell>
      </Cells>
      <KeysBlock>
        <template v-for="[k, v] in KEYS.tabs" :key="k"
          ><dt>{{ k }}</dt>
          <dd>{{ v }}</dd></template
        >
      </KeysBlock>
    </Section>

    <Section
      title="Menus"
      note="Every menu is reka's DropdownMenu: roving focus, type-ahead and submenus come with it."
    >
      <Cells v-if="!details" :min="300">
        <Cell label="live: the item menu (⋯)" fill :height="300">
          <div class="ds-ia-row"><MarItemMenu :lines="MENU" /></div>
        </Cell>
        <Stage v-if="!details" id="run-on-menu" label="live: Run on (type to filter)" />
      </Cells>
      <KeysBlock>
        <template v-for="[k, v] in KEYS.menu" :key="k"
          ><dt>{{ k }}</dt>
          <dd>{{ v }}</dd></template
        >
        <template v-for="[k, v] in KEYS.runOn" :key="k"
          ><dt>Run on · {{ k }}</dt>
          <dd>{{ v }}</dd></template
        >
      </KeysBlock>
    </Section>

    <Section
      title="Select, rename, delete, undo"
      note="The library pages' own wiring (useLibrary). Nothing asks first: a delete happens, and the toast offers it back."
    >
      <div v-if="!details" class="ds-ia-lib proto-ui">
        <div class="ds-ia-grid">
          <MarItem
            v-for="w in col.items"
            :key="w.id"
            :name="w.name"
            :thumb="w.pic"
            :icon="ComfyWorkflow"
            meta="Local · 2h ago"
            :lines="lines(w.id)"
            :selected="lib.sel.has(w.id)"
            :selecting="lib.sel.ids.value.size > 0"
            :renaming="lib.renaming.value === w.id"
            @select="lib.pick(w.id, $event)"
            @start-rename="lib.renaming.value = w.id"
            @rename="lib.rename(w.id, $event)"
            @cancel-rename="lib.renaming.value = ''"
          />
        </div>
        <MarUndoToast />
      </div>
      <KeysBlock>
        <template v-for="[k, v] in KEYS.select" :key="k"
          ><dt>{{ k }}</dt>
          <dd>{{ v }}</dd></template
        >
        <template v-for="[k, v] in KEYS.rename" :key="k"
          ><dt>Rename · {{ k }}</dt>
          <dd>{{ v }}</dd></template
        >
      </KeysBlock>
    </Section>

    <Section
      title="⌘K search and ⌘. UI Playground"
      note="Opens anywhere with ⌘K, or from the sidebar’s first row."
    >
      <Cells v-if="!details" :min="520">
        <AppShot label="live: the app" page="overview" />
      </Cells>
      <KeysBlock>
        <template v-for="[k, v] in KEYS.search" :key="k"
          ><dt>{{ k }}</dt>
          <dd>{{ v }}</dd></template
        >
        <template v-for="[k, v] in KEYS.tuner" :key="k"
          ><dt>{{ k }}</dt>
          <dd>{{ v }}</dd></template
        >
      </KeysBlock>
    </Section>

    <Section
      title="Graph editor"
      note="Pan, move, link and select with the pointer; the rest from the keyboard."
    >
      <Cells v-if="!details" :min="520">
        <AppShot label="live: a build's graph" page="overview" run="graph" />
      </Cells>
      <KeysBlock>
        <template v-for="[k, v] in KEYS.graph" :key="k"
          ><dt>{{ k }}</dt>
          <dd>{{ v }}</dd></template
        >
      </KeysBlock>
    </Section>
  </div>
</template>

<style>
.ds-ia {
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.ds-ia-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.ds-ia-keys {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 14px;
  font-size: 12px;
}
.ds-ia-keys dt {
  color: var(--color-base-foreground);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11.5px;
}
.ds-ia-keys dd {
  color: var(--color-muted-foreground);
}
/* Holds the undo toast, which the app places `fixed`. */
.ds-ia-lib {
  position: relative;
  min-height: 300px;
  padding: 12px 12px 72px;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 3%, transparent);
  transform: translateZ(0);
}
.ds-ia-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}
.ds-ia-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-subtle-foreground);
  font-size: 11.5px;
}
</style>
