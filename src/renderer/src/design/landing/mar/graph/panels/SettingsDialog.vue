<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Box,
  Ellipsis,
  Info,
  Keyboard,
  Palette,
  PenTool,
  Puzzle,
  ReceiptText,
  Search,
  Server,
  Settings,
  User,
  Users,
  Workflow
} from 'lucide-vue-next'
import type { Component } from 'vue'
import GraphDialog from './GraphDialog.vue'
import { SHORTCUTS } from './panelData'

/**
 * Settings (ComfyUI's SettingDialog, rail › Settings): search, then the
 * categories, Workspace (signed in) and General, Server-Config on Desktop
 * only. A category lists its settings, each with its control.
 */
const { cloud, start } = defineProps<{ cloud: boolean; start?: string }>()
const emit = defineEmits<{ close: [] }>()

type Setting =
  | { name: string; kind: 'toggle'; value: boolean }
  | { name: string; kind: 'select'; value: string; options: string[] }
  | { name: string; kind: 'number'; value: number }
  | { name: string; kind: 'text'; value: string }

const NAV: { group: string; items: { label: string; icon: Component }[] }[] = [
  {
    group: 'Workspace',
    items: [
      { label: 'Plan & Credits', icon: ReceiptText },
      { label: 'Members', icon: Users }
    ]
  },
  {
    group: 'General',
    items: [
      { label: 'User', icon: User },
      { label: 'Comfy', icon: Settings },
      { label: 'Lite Graph', icon: Workflow },
      { label: 'Appearance', icon: Palette },
      { label: '3D', icon: Box },
      { label: 'Mask Editor', icon: PenTool },
      { label: 'Other', icon: Ellipsis },
      { label: 'Keybinding', icon: Keyboard },
      { label: 'Extension', icon: Puzzle },
      { label: 'About', icon: Info },
      ...(cloud ? [] : [{ label: 'Server-Config', icon: Server }])
    ]
  }
]

const SETTINGS = ref<Record<string, Setting[]>>({
  Comfy: [
    { name: 'Sidebar location', kind: 'select', value: 'left', options: ['left', 'right'] },
    { name: 'Sidebar size', kind: 'select', value: 'normal', options: ['normal', 'small'] },
    {
      name: 'Sidebar style',
      kind: 'select',
      value: 'connected',
      options: ['connected', 'floating']
    },
    {
      name: 'Opened workflows position',
      kind: 'select',
      value: 'Topbar',
      options: ['Topbar', 'Sidebar']
    },
    { name: 'Prompt for filename when saving workflow', kind: 'toggle', value: true },
    { name: 'Require confirmation when clearing workflow', kind: 'toggle', value: true }
  ],
  'Lite Graph': [
    { name: 'Modern Node Design (Nodes 2.0)', kind: 'toggle', value: true },
    {
      name: 'Link Render Mode',
      kind: 'select',
      value: 'Spline',
      options: ['Straight', 'Linear', 'Spline', 'Hidden']
    },
    { name: 'Canvas zoom speed', kind: 'number', value: 1.1 },
    { name: 'Snap to grid size', kind: 'number', value: 10 },
    { name: 'Show minimap', kind: 'toggle', value: true }
  ],
  Appearance: [
    {
      name: 'Color Palette',
      kind: 'select',
      value: 'Dark (Default)',
      options: ['Dark (Default)', 'Light', 'Arc', 'Github', 'Nord', 'Solarized']
    },
    { name: 'Node opacity', kind: 'number', value: 1 },
    { name: 'Show link tooltips', kind: 'toggle', value: true }
  ],
  '3D': [
    { name: 'Show Grid', kind: 'toggle', value: true },
    { name: 'Background Color', kind: 'text', value: '#282828' },
    {
      name: 'Camera Type',
      kind: 'select',
      value: 'perspective',
      options: ['perspective', 'orthographic']
    }
  ],
  'Mask Editor': [
    { name: 'Brush adjustment speed multiplier', kind: 'number', value: 1 },
    { name: 'Lock brush adjustment to dominant axis', kind: 'toggle', value: false }
  ],
  Other: [
    { name: 'Show confirmation when closing window', kind: 'toggle', value: true },
    { name: 'Tooltip enabled', kind: 'toggle', value: true }
  ],
  Extension: [
    { name: 'Comfy.ColorPalette', kind: 'toggle', value: true },
    { name: 'Comfy.ContextMenuFilter', kind: 'toggle', value: true },
    { name: 'Comfy.GroupOptions', kind: 'toggle', value: true },
    { name: 'Comfy.Load3D', kind: 'toggle', value: true },
    { name: 'Comfy.MaskEditor', kind: 'toggle', value: true }
  ],
  'Server-Config': [
    { name: 'Host: The IP address to listen on', kind: 'text', value: '127.0.0.1' },
    { name: 'Port: The port to listen on', kind: 'number', value: 8188 },
    { name: 'Enable CORS header', kind: 'toggle', value: false },
    {
      name: 'Preview method',
      kind: 'select',
      value: 'auto',
      options: ['none', 'auto', 'latent2rgb', 'taesd']
    }
  ]
})

const nav = ref(start ?? 'Comfy')
const query = ref('')
const found = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  return Object.entries(SETTINGS.value).flatMap(([cat, list]) =>
    (cloud && cat === 'Server-Config' ? [] : list)
      .filter((s) => s.name.toLowerCase().includes(q))
      .map((s) => ({ cat, s }))
  )
})
const keybindings = computed(() =>
  Object.values(SHORTCUTS).flatMap((cols) => cols.flatMap((c) => c.rows))
)
</script>

<template>
  <GraphDialog title="Settings" size="md" @close="emit('close')">
    <template #icon><Settings :size="16" /></template>
    <template #nav>
      <template v-for="g in NAV" :key="g.group">
        <p class="rp-dialog-group">{{ g.group }}</p>
        <button
          v-for="i in g.items"
          :key="i.label"
          type="button"
          class="rp-row"
          :class="nav === i.label && !query && 'is-on'"
          @click="((nav = i.label), (query = ''))"
        >
          <component :is="i.icon" :size="14" class="rp-row-icon" />{{ i.label }}
        </button>
      </template>
    </template>
    <template #header>
      <label class="rp-search">
        <Search :size="15" />
        <input v-model="query" type="search" placeholder="Search Settings..." />
      </label>
    </template>

    <template v-if="query">
      <h2 class="rp-title-lg">Search results</h2>
      <div v-for="r in found" :key="r.s.name" class="sd-row">
        <span
          >{{ r.s.name }}<small>{{ r.cat }}</small></span
        >
      </div>
      <p v-if="!found.length" class="rp-empty">No settings match “{{ query }}”.</p>
    </template>

    <template v-else-if="nav === 'Plan & Credits'">
      <h2 class="rp-title-lg">Plan & Credits</h2>
      <div class="sd-card">
        <span><small>Current plan</small><strong>Creator</strong></span>
        <button type="button" class="rp-btn">Manage plan</button>
      </div>
      <div class="sd-card">
        <span><small>Credits</small><strong>2,480</strong></span>
        <button type="button" class="rp-btn is-primary">Add credits</button>
      </div>
    </template>

    <template v-else-if="nav === 'Members'">
      <h2 class="rp-title-lg">Members</h2>
      <div v-for="m in ['Mar', 'Pablo', 'Alex']" :key="m" class="sd-row">
        <span class="sd-member"
          ><i>{{ m[0] }}</i
          >{{ m }}</span
        >
        <span class="sd-muted">{{ m === 'Mar' ? 'Owner' : 'Member' }}</span>
      </div>
    </template>

    <template v-else-if="nav === 'User'">
      <h2 class="rp-title-lg">User</h2>
      <div class="sd-card">
        <span class="sd-member"
          ><i>M</i><span><strong>Mar</strong><small>Signed in</small></span></span
        >
        <button type="button" class="rp-btn">Log Out</button>
      </div>
    </template>

    <template v-else-if="nav === 'Keybinding'">
      <h2 class="rp-title-lg">Keybinding</h2>
      <div v-for="[label, keys] in keybindings" :key="label" class="sd-row">
        <span>{{ label }}</span>
        <span class="sp-keys"
          ><kbd v-for="k in keys" :key="k" class="rp-kbd">{{ k }}</kbd></span
        >
      </div>
    </template>

    <template v-else-if="nav === 'About'">
      <h2 class="rp-title-lg">About</h2>
      <div class="sd-row"><span>ComfyUI Frontend</span><span class="sd-muted">v1.58</span></div>
      <div v-if="!cloud" class="sd-row">
        <span>ComfyUI Desktop</span><span class="sd-muted">v1.0.40</span>
      </div>
      <div v-else class="sd-row">
        <span>Comfy Cloud</span><span class="sd-muted">cloud.comfy.org</span>
      </div>
    </template>

    <template v-else>
      <h2 class="rp-title-lg">{{ nav }}</h2>
      <div v-for="s in SETTINGS[nav] ?? []" :key="s.name" class="sd-row">
        <span>{{ s.name }}</span>
        <button
          v-if="s.kind === 'toggle'"
          type="button"
          role="switch"
          class="sd-switch"
          :class="s.value && 'is-on'"
          :aria-checked="s.value"
          :aria-label="s.name"
          @click="s.value = !s.value"
        >
          <i />
        </button>
        <select
          v-else-if="s.kind === 'select'"
          v-model="s.value"
          class="sd-field"
          :aria-label="s.name"
        >
          <option v-for="o in s.options" :key="o">{{ o }}</option>
        </select>
        <input
          v-else-if="s.kind === 'number'"
          v-model.number="s.value"
          type="number"
          class="sd-field is-num"
          :aria-label="s.name"
        />
        <input v-else v-model="s.value" type="text" class="sd-field" :aria-label="s.name" />
      </div>
    </template>
  </GraphDialog>
</template>

<style>
.sd-row {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  box-shadow: inset 0 -1px 0 var(--rp-line);
  font-size: 13px;
}
.sd-row small,
.sd-card small {
  display: block;
  color: var(--mg-dim);
  font-size: 11.5px;
}
.sd-muted {
  color: var(--mg-muted);
}
.sd-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  padding: 14px 16px;
  border-radius: var(--mar-tab-radius);
  background: var(--rp-chip);
}
.sd-card strong {
  font-size: 15px;
}
.sd-member {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sd-member i {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--rp-chip-on);
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .sd-switch {
  position: relative;
  width: 34px;
  height: 20px;
  flex: none;
  padding: 0;
  border-radius: 999px;
  background: var(--rp-chip-on);
}
:root .proto-ui.proto-ui.proto-ui .sd-switch.is-on {
  background: var(--mg-run);
}
.sd-switch i {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--color-content-background);
  transition: translate 0.15s ease;
}
.sd-switch.is-on i {
  translate: 14px 0;
}
:root .proto-ui.proto-ui.proto-ui .sd-field {
  width: 180px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--mar-tab-item-radius);
  outline: none;
  background: var(--rp-chip);
  box-shadow: none;
  color: var(--mg-text);
  font: inherit;
  font-size: 12.5px;
}
:root .proto-ui.proto-ui.proto-ui .sd-field.is-num {
  width: 90px;
}
</style>
