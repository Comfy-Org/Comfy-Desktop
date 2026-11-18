<script setup lang="ts">
import { computed, reactive, ref, type Component } from 'vue'
import {
  CircleHelp,
  Ellipsis,
  Folder,
  FolderInput,
  FolderOpen,
  Info,
  Keyboard,
  Plus,
  Monitor,
  Palette,
  RotateCcw,
  Settings2,
  User,
  Workflow
} from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Select from '../../ui/Select.vue'
import Switch from '../../ui/Switch.vue'
import { look } from '../../look'
import { proto, toast } from '../../useProto'
import { USER } from '../../mock'
import { surface } from '../shell/surface'
import MarPage from './MarPage.vue'
import MarSearchField from './MarSearchField.vue'
import { notify } from './undo'
import MarItemMenu from './MarItemMenu.vue'
import type { MenuLine } from './menu'

/**
 * Settings (Mar's proposal): the settings ComfyUI and Comfy Desktop
 * already have (names from the frontend's core settings and Desktop's
 * own), grouped down the left, one search over all of them. A changed
 * setting shows a Reset; Theme drives the prototype's real theme. Desktop
 * and folders only on Desktop.
 */
type Kind = 'switch' | 'select' | 'button' | 'value'
interface Setting {
  id: string
  group: string
  name: string
  hint?: string
  kind: Kind
  options?: { value: string; label: string }[]
  def?: string | boolean
  action?: string
}

const GROUPS: { id: string; label: string; icon: Component; desktop?: boolean }[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'canvas', label: 'Workflow & canvas', icon: Workflow },
  { id: 'desktop', label: 'Desktop', icon: Monitor, desktop: true },
  { id: 'folders', label: 'Folders', icon: Folder, desktop: true },
  { id: 'keys', label: 'Keybindings', icon: Keyboard },
  { id: 'account', label: 'Account', icon: User },
  { id: 'about', label: 'About', icon: Info }
]

const SETTINGS: Setting[] = [
  {
    id: 'lang',
    group: 'general',
    name: 'Language',
    kind: 'select',
    def: 'en',
    options: [
      { value: 'en', label: 'English' },
      { value: 'es', label: 'Español' },
      { value: 'zh', label: '中文' },
      { value: 'ja', label: '日本語' },
      { value: 'fr', label: 'Français' }
    ]
  },
  {
    id: 'confirmClose',
    group: 'general',
    name: 'Show confirmation when closing window',
    kind: 'switch',
    def: true
  },
  {
    id: 'promptName',
    group: 'general',
    name: 'Prompt for filename when saving workflow',
    kind: 'switch',
    def: true
  },
  {
    id: 'versionUpdates',
    group: 'general',
    name: 'Show version updates',
    kind: 'switch',
    def: true
  },
  { id: 'tooltips', group: 'general', name: 'Enable tooltips', kind: 'switch', def: true },

  {
    id: 'theme',
    group: 'appearance',
    name: 'Theme',
    kind: 'select',
    def: 'dark',
    options: [
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' }
    ]
  },
  {
    id: 'sidebarLoc',
    group: 'appearance',
    name: 'Sidebar location',
    kind: 'select',
    def: 'left',
    options: [
      { value: 'left', label: 'Left' },
      { value: 'right', label: 'Right' }
    ]
  },
  {
    id: 'sidebarSize',
    group: 'appearance',
    name: 'Sidebar size',
    kind: 'select',
    def: 'normal',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'small', label: 'Small' }
    ]
  },
  {
    id: 'animations',
    group: 'appearance',
    name: 'Disable animations',
    hint: 'Also follows your system’s Reduce motion.',
    kind: 'switch',
    def: false
  },

  {
    id: 'nav',
    group: 'canvas',
    name: 'Navigation mode',
    kind: 'select',
    def: 'standard',
    options: [
      { value: 'standard', label: 'Standard' },
      { value: 'legacy', label: 'Drag to pan (legacy)' },
      { value: 'custom', label: 'Custom' }
    ]
  },
  {
    id: 'wheel',
    group: 'canvas',
    name: 'Mouse wheel scroll',
    kind: 'select',
    def: 'zoom',
    options: [
      { value: 'zoom', label: 'Zooms the canvas' },
      { value: 'pan', label: 'Pans the canvas' }
    ]
  },
  {
    id: 'zoomSpeed',
    group: 'canvas',
    name: 'Canvas zoom speed',
    kind: 'select',
    def: '1.1',
    options: [
      { value: '1.05', label: 'Slow' },
      { value: '1.1', label: 'Normal' },
      { value: '1.2', label: 'Fast' }
    ]
  },
  {
    id: 'canvasInfo',
    group: 'canvas',
    name: 'Show canvas info on bottom left corner (fps, etc.)',
    kind: 'switch',
    def: true
  },
  { id: 'validate', group: 'canvas', name: 'Validate workflows', kind: 'switch', def: true },
  {
    id: 'preview',
    group: 'canvas',
    name: 'Preview image format',
    hint: 'Used for previews while a run is going.',
    kind: 'select',
    def: 'webp',
    options: [
      { value: 'webp', label: 'WebP' },
      { value: 'jpeg', label: 'JPEG' },
      { value: 'png', label: 'PNG' }
    ]
  },

  {
    id: 'autoUpdate',
    group: 'desktop',
    name: 'Automatically check for updates',
    kind: 'switch',
    def: true
  },
  {
    id: 'stats',
    group: 'desktop',
    name: 'Send anonymous usage statistics',
    hint: 'Crash reports and which features get used. Never your workflows or images.',
    kind: 'switch',
    def: true
  },
  {
    id: 'window',
    group: 'desktop',
    name: 'Window style',
    kind: 'select',
    def: 'custom',
    options: [
      { value: 'custom', label: 'Custom title bar' },
      { value: 'default', label: 'System title bar' }
    ]
  },
  {
    id: 'pypi',
    group: 'desktop',
    name: 'PyPI install mirror',
    hint: 'Where Python packages come from when a build installs.',
    kind: 'select',
    def: 'default',
    options: [
      { value: 'default', label: 'Default (pypi.org)' },
      { value: 'tuna', label: 'Tsinghua mirror' }
    ]
  },
  // Folders: the install location and the shared folders (FOLDERS below).
  {
    id: 'installLocation',
    group: 'folders',
    name: 'Default install location',
    kind: 'value',
    def: '~/ComfyUI-Installs'
  },
  {
    id: 'sharedFolders',
    group: 'folders',
    name: 'Shared folders',
    hint: 'Models, input and output folders every build can use',
    kind: 'value',
    def: '4 folders'
  },
  {
    id: 'logs',
    group: 'desktop',
    name: 'Logs',
    hint: '~/Library/Logs/ComfyUI',
    kind: 'button',
    action: 'Show in Finder'
  },
  {
    id: 'reinstall',
    group: 'desktop',
    name: 'Reinstall',
    hint: 'Keeps your models, workflows and outputs.',
    kind: 'button',
    action: 'Reinstall…'
  },

  { id: 'k-run', group: 'keys', name: 'Queue prompt', kind: 'value', def: '⌘ ↵' },
  { id: 'k-save', group: 'keys', name: 'Save workflow', kind: 'value', def: '⌘ S' },
  { id: 'k-search', group: 'keys', name: 'Search', kind: 'value', def: '⌘ K' },
  { id: 'k-fit', group: 'keys', name: 'Fit view to selection', kind: 'value', def: '.' },
  { id: 'k-bypass', group: 'keys', name: 'Bypass selected nodes', kind: 'value', def: '⌘ B' },
  { id: 'k-mute', group: 'keys', name: 'Mute selected nodes', kind: 'value', def: '⌘ M' },

  {
    id: 'email',
    group: 'account',
    name: 'Signed in as',
    hint: USER.email,
    kind: 'button',
    action: 'Log out'
  },
  {
    id: 'credits',
    group: 'account',
    name: 'Credits',
    hint: `${USER.credits} left`,
    kind: 'button',
    action: 'Add credits'
  },
  {
    id: 'apinodes',
    group: 'account',
    name: 'Show API node pricing badge',
    kind: 'switch',
    def: true
  },

  { id: 'v-desktop', group: 'about', name: 'Comfy Desktop', kind: 'value', def: 'v0.5.2' },
  { id: 'v-comfy', group: 'about', name: 'ComfyUI', kind: 'value', def: 'v0.3.74' },
  { id: 'v-front', group: 'about', name: 'Frontend', kind: 'value', def: 'v1.32.4' },
  {
    id: 'check',
    group: 'about',
    name: 'Updates',
    hint: 'You’re on the latest version.',
    kind: 'button',
    action: 'Check now'
  }
]

/**
 * Folders (Comfy-Desktop#2175): where new builds go, then one list of the
 * folders every build can share, each naming its kind. Downloads is always
 * in view: the folder that gets downloaded models wears the tag, every
 * other models folder offers Use for downloads. A row's ⋯ only removes.
 * Long paths keep their end, the full path on hover.
 */
const installLocation = ref('~/ComfyUI-Installs')
interface SharedFolder {
  id: string
  path: string
  kind: 'Models' | 'Input' | 'Output'
}
const FOLDERS = ref<SharedFolder[]>([
  { id: 'm1', path: '~/Documents/comfyui-data/models', kind: 'Models' },
  {
    id: 'm2',
    path: '~/Library/Application Support/Comfy-Desktop/ComfyUI-Shared/models',
    kind: 'Models'
  },
  {
    id: 'in',
    path: '~/Library/Application Support/Comfy-Desktop/ComfyUI-Shared/input',
    kind: 'Input'
  },
  {
    id: 'out',
    path: '~/Library/Application Support/Comfy-Desktop/ComfyUI-Shared/output',
    kind: 'Output'
  }
])
const downloadsTo = ref('m1')
const folderLines = (f: SharedFolder): MenuLine[] => [
  {
    label: 'Remove',
    danger: true,
    run: () => {
      const before = [...FOLDERS.value]
      FOLDERS.value = FOLDERS.value.filter((x) => x.id !== f.id)
      notify('Folder removed', () => (FOLDERS.value = before))
    }
  }
]
let added = 0
function addModelsFolder(): void {
  added++
  FOLDERS.value = [
    ...FOLDERS.value.filter((f) => f.kind === 'Models'),
    { id: `new${added}`, path: `~/Models ${added}`, kind: 'Models' },
    ...FOLDERS.value.filter((f) => f.kind !== 'Models')
  ]
}
const showFolders = computed(() => !query.value && group.value === 'folders')

const values = reactive<Record<string, string | boolean>>(
  Object.fromEntries(SETTINGS.filter((s) => s.def !== undefined).map((s) => [s.id, s.def!]))
)
// Theme is the prototype's own.
const theme = computed({
  get: () => look.theme,
  set: (v: string) => (look.theme = v as typeof look.theme)
})

const desktop = computed(() => surface.id === 'desktop')
const groups = computed(() => GROUPS.filter((g) => !g.desktop || desktop.value))
const group = ref('general')
const query = ref('')

const hits = computed(() => {
  const q = query.value.trim().toLowerCase()
  return SETTINGS.filter(
    (s) =>
      groups.value.some((g) => g.id === s.group) &&
      (q ? `${s.name} ${s.hint ?? ''}`.toLowerCase().includes(q) : s.group === group.value)
  )
})
const label = (id: string): string => GROUPS.find((g) => g.id === id)!.label

// Theme is the prototype's own pick (UI Playground), never a change to undo.
const changed = (s: Setting): boolean =>
  s.kind !== 'button' && s.kind !== 'value' && s.id !== 'theme' && values[s.id] !== s.def
function reset(s: Setting): void {
  if (s.id === 'theme') theme.value = s.def as string
  else values[s.id] = s.def!
}
function resetAll(): void {
  const before = { ...values }
  const t = look.theme
  for (const s of SETTINGS) if (changed(s)) reset(s)
  notify('Settings back to their defaults', () => {
    Object.assign(values, before)
    look.theme = t
  })
}
const anyChanged = computed(() => SETTINGS.some(changed))

function act(s: Setting): void {
  if (s.id === 'email') {
    proto.signedIn = false
    toast('Signed out')
  } else if (s.id === 'check') toast('You’re on the latest version')
  else toast(`${s.action?.replace('…', '')} · ${s.name}`)
}
</script>

<template>
  <MarPage
    title="Settings"
    skeleton="settings"
    :no-results="hits.length === 0"
    error-title="Some settings didn’t load"
    error-text="Account and cloud settings need Comfy Cloud, which is out of reach. Everything on this computer still saves."
    @clear="query = ''"
  >
    <template #actions="{ state }">
      <Button v-if="state === 'live' && anyChanged" variant="ghost" @click="resetAll"
        ><RotateCcw :size="14" />Reset all</Button
      >
    </template>
    <template #toolbar>
      <MarSearchField v-model="query" placeholder="Search settings" />
    </template>

    <div class="mar-set">
      <nav class="mar-set-nav" aria-label="Settings">
        <button
          v-for="g in groups"
          :key="g.id"
          type="button"
          class="mar-set-tab"
          :aria-current="!query && group === g.id ? 'page' : undefined"
          @click="((group = g.id), (query = ''))"
        >
          <component :is="g.icon" :size="15" />{{ g.label }}
        </button>
      </nav>

      <section class="mar-set-list">
        <template v-if="showFolders">
          <h2 class="mar-set-title mar-set-label">
            Default install location<CircleHelp
              :size="13"
              aria-label="Where new builds are installed"
              title="Where new builds are installed"
            />
          </h2>
          <div class="mar-set-box">
            <div class="mar-set-folder">
              <Folder :size="15" class="shrink-0 text-muted-foreground" />
              <span class="mar-set-path" :title="installLocation"
                ><bdi>{{ installLocation }}</bdi></span
              >
              <button
                type="button"
                class="mar-set-icon"
                title="Choose a folder"
                aria-label="Choose a folder"
                @click="installLocation = '/Volumes/Studio/ComfyUI-Installs'"
              >
                <FolderOpen :size="15" />
              </button>
            </div>
          </div>
          <h2 class="mar-set-title mar-set-label">
            Shared folders<CircleHelp
              :size="13"
              aria-label="Folders every build can use"
              title="Folders every build can use"
            />
          </h2>
          <p class="mar-set-hint mar-set-lead">
            These folders are shared by every build. Each build chooses in its own Folders tab
            whether to use them.
          </p>
          <div class="mar-set-box">
            <div v-for="f in FOLDERS" :key="f.id" class="mar-set-folder is-shared">
              <FolderInput :size="15" class="shrink-0 text-muted-foreground" />
              <span class="mar-set-path" :title="f.path"
                ><bdi>{{ f.path }}</bdi></span
              >
              <span class="mar-set-kind">{{ f.kind }}</span>
              <span class="mar-set-dl">
                <span v-if="downloadsTo === f.id" class="mar-set-tag"
                  >Downloads<CircleHelp
                    :size="12"
                    title="Models you download from ComfyUI land here"
                    aria-label="Models you download from ComfyUI land here"
                /></span>
                <button
                  v-else-if="f.kind === 'Models'"
                  type="button"
                  class="mar-set-use"
                  @click="downloadsTo = f.id"
                >
                  Use for downloads
                </button>
              </span>
              <button
                type="button"
                class="mar-set-icon"
                title="Open folder"
                aria-label="Open folder"
                @click="toast(`Opened ${f.path}`)"
              >
                <FolderOpen :size="15" />
              </button>
              <span class="mar-set-more">
                <MarItemMenu
                  v-if="f.kind === 'Models' && downloadsTo !== f.id"
                  :lines="folderLines(f)"
                  label="Folder actions"
                >
                  <template #trigger>
                    <button type="button" class="mar-set-icon" aria-label="Folder actions">
                      <Ellipsis :size="15" />
                    </button>
                  </template>
                </MarItemMenu>
              </span>
            </div>
            <button type="button" class="mar-set-add" @click="addModelsFolder">
              <Plus :size="15" />Add models folder
            </button>
          </div>
        </template>
        <h2 v-else class="mar-set-title">
          {{ query ? `Results for “${query}”` : label(group) }}
        </h2>
        <div
          v-for="s in showFolders ? [] : hits"
          :key="s.id"
          class="mar-set-row"
          :class="changed(s) && 'is-changed'"
        >
          <div class="min-w-0 flex-1">
            <p class="mar-set-name">
              {{ s.name }}<span v-if="query" class="mar-set-where">{{ label(s.group) }}</span>
            </p>
            <p v-if="s.hint" class="mar-set-hint">{{ s.hint }}</p>
          </div>
          <button
            v-if="changed(s)"
            type="button"
            class="mar-set-reset"
            title="Reset to default"
            @click="reset(s)"
          >
            <RotateCcw :size="13" />
          </button>
          <Switch
            v-if="s.kind === 'switch'"
            v-model="values[s.id] as boolean"
            :aria-label="s.name"
          />
          <Select
            v-else-if="s.kind === 'select' && s.id === 'theme'"
            v-model="theme"
            :options="s.options!"
            class="w-48"
          />
          <Select
            v-else-if="s.kind === 'select'"
            v-model="values[s.id] as string"
            :options="s.options!"
            class="w-48"
          />
          <kbd v-else-if="s.kind === 'value' && s.group === 'keys'" class="mar-set-kbd">{{
            values[s.id]
          }}</kbd>
          <span v-else-if="s.kind === 'value'" class="mar-set-value">{{ values[s.id] }}</span>
          <Button v-else size="sm" @click="act(s)">{{ s.action }}</Button>
        </div>
      </section>
    </div>
  </MarPage>
</template>

<style>
.mar-set {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 40px;
}
.mar-set-nav {
  position: sticky;
  top: 24px;
  display: flex;
  align-self: start;
  flex-direction: column;
  gap: 2px;
}
:root .proto-ui.proto-ui.proto-ui .mar-set-tab {
  display: flex;
  width: 100%;
  height: 34px;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border-radius: 9px;
  color: var(--color-muted-foreground);
  font-size: 13px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .mar-set-tab:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-set-tab[aria-current='page'] {
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  color: var(--color-base-foreground);
}
.mar-set-list {
  max-width: 720px;
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--color-card-background) 60%, transparent);
  padding: 8px 20px 12px;
}
.mar-set-title {
  margin: 12px 0 4px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-weight: 500;
}
.mar-set-row {
  display: flex;
  min-height: 64px;
  align-items: center;
  gap: 12px;
}
.mar-set-name {
  margin: 0;
  color: var(--color-base-foreground);
  font-size: 13px;
  font-weight: 500;
}
.mar-set-where {
  margin-left: 8px;
  color: var(--color-subtle-foreground);
  font-weight: 400;
}
.mar-set-hint {
  margin: 2px 0 0;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.mar-set-row.is-changed .mar-set-name::before {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin: 0 8px 2px -14px;
  border-radius: 999px;
  background: var(--color-base-foreground);
  content: '';
}
:root .proto-ui.proto-ui.proto-ui .mar-set-reset {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 8px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-set-reset:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
.mar-set-kbd {
  padding: 3px 8px;
  border-radius: 6px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-muted-foreground);
  font-family: inherit;
  font-size: 12px;
}
.mar-set-value {
  color: var(--color-muted-foreground);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
/* Folders (Comfy-Desktop#2175): uppercase section titles, each list in a
 * lighter box, no lines. */
.mar-set-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 20px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.mar-set-label:first-child {
  margin-top: 12px;
}
.mar-set-lead {
  margin: 4px 0 10px;
}
.mar-set-box {
  display: grid;
  gap: 2px;
  margin-top: 8px;
  padding: 6px;
  border-radius: 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
.mar-set-folder {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  min-height: 40px;
  align-items: center;
  gap: 12px;
  padding: 0 4px 0 10px;
}
.mar-set-folder.is-shared {
  grid-template-columns: 16px minmax(0, 1fr) 64px 140px 28px 28px;
}
/* A long path keeps its end: the ellipsis goes at the start. */
.mar-set-path {
  overflow: hidden;
  color: var(--color-base-foreground);
  direction: rtl;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12.5px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-set-kind {
  color: var(--color-muted-foreground);
  font-size: 13px;
}
.mar-set-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .mar-set-use {
  padding: 3px 8px;
  border-radius: 8px;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .mar-set-use:hover,
:root .proto-ui.proto-ui.proto-ui .mar-set-icon:hover,
:root .proto-ui.proto-ui.proto-ui .mar-set-add:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-set-icon {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 8px;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-set-add {
  display: flex;
  height: 36px;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border-radius: 9px;
  color: var(--color-base-foreground);
  font-size: 13px;
  text-align: left;
}
</style>
