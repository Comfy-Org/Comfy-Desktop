<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import {
  ArrowDownToLine,
  Archive,
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarDays,
  Camera,
  ChevronRight,
  CircleCheck,
  CircleX,
  FlaskConical,
  Folder,
  FolderPlus,
  Megaphone,
  Package,
  Palette,
  Pencil,
  Plus,
  Scissors,
  Wand,
  Star,
  Trash2,
  Brush
} from 'lucide-vue-next'
import { ComfyAssets } from '../icons/comfyIcons'
import Tooltip from '../../ui/Tooltip.vue'
import MarItemMenu from '../pages/MarItemMenu.vue'
import type { MenuLine } from '../pages/menu'
import type { MarAsset } from '../pages/assetsStore'
import { factsFor } from './assetFacts'
import { isStarred } from './assetFavorites'
import { LABELS } from './assetLabels'
import {
  addFolder,
  folderName,
  folderOf,
  folders,
  removeFolder,
  renameFolder,
  tree,
  within,
  type AssetFolder
} from './assetFolders'

type Source = 'all' | 'generated' | 'imported'

const {
  items,
  favorites = true,
  dropping = false
} = defineProps<{
  items: MarAsset[]
  favorites?: boolean
  dropping?: boolean
}>()
const emit = defineEmits<{ drop: [folder: string] }>()
const folder = defineModel<string>('folder', { required: true })
const source = defineModel<Source>('source', { required: true })
const favOnly = defineModel<boolean>('favOnly', { required: true })

const INDENT = 12
const MAX_LEVELS = 8

const ICONS: Record<string, Component> = {
  'f-client': Briefcase,
  'f-moodboards': Palette,
  'f-tests': FlaskConical,
  'f-deep-1': Building2,
  'f-deep-2': CalendarDays,
  'f-deep-2b': Archive,
  'f-deep-3': Megaphone,
  'f-deep-3b': Megaphone,
  'f-deep-4': Camera,
  'f-deep-4b': Scissors,
  'f-deep-5': Package,
  'f-deep-6': CircleCheck,
  'f-deep-6b': CircleX,
  'f-deep-7': Brush,
  'f-deep-8': BadgeCheck
}
const GROUP_HUES = ['orange', 'green', 'blue', 'purple', 'red', 'yellow']

function rootOf(id: string): AssetFolder | undefined {
  let f = folders.find((x) => x.id === id)
  while (f?.parent) f = folders.find((x) => x.id === f!.parent)
  return f
}
function colorOf(id: string): string {
  const tops = folders.filter((f) => !f.parent)
  const at = Math.max(0, tops.indexOf(rootOf(id)!))
  const hue = GROUP_HUES[at % GROUP_HUES.length]
  return LABELS.find((l) => l.value === hue)?.color ?? 'currentColor'
}
function ancestors(id: string): AssetFolder[] {
  const out: AssetFolder[] = []
  for (let f = folders.find((x) => x.id === id); f?.parent;) {
    const up = folders.find((x) => x.id === f!.parent)
    if (!up) break
    out.unshift(up)
    f = up
  }
  return out
}

const open = ref(new Set<string>())
function toggle(id: string, to = !open.value.has(id)): void {
  const next = new Set(open.value)
  if (to) next.add(id)
  else next.delete(id)
  open.value = next
}
watch(folder, (id) => id && ancestors(id).forEach((p) => toggle(p.id, true)), {
  immediate: true
})

const ROWS = computed(() =>
  tree()
    .filter(({ folder: f }) => ancestors(f.id).every((p) => open.value.has(p.id)))
    .map(({ folder: f, depth }) => {
      const inside = within(f.id)
      const level = Math.min(depth, MAX_LEVELS)
      return {
        ...f,
        level,
        guides: Array.from({ length: level }, (_, i) => i),
        kids: folders.some((x) => x.parent === f.id),
        icon: ICONS[f.id] ?? Folder,
        color: colorOf(f.id),
        count: items.filter((a) => inside.has(folderOf(a.id) ?? '')).length
      }
    })
)

const SMART = computed(() => {
  const generated = items.filter((a) => !factsFor(a).imported).length
  return [
    { id: 'generated' as const, label: 'Generated', icon: Wand, count: generated },
    {
      id: 'imported' as const,
      label: 'Imported',
      icon: ArrowDownToLine,
      count: items.length - generated
    }
  ]
})
const favCount = computed(() => items.filter((a) => isStarred(a.id)).length)

const allOn = computed(() => source.value === 'all' && !folder.value && !favOnly.value)
function pickAll(): void {
  source.value = 'all'
  folder.value = ''
  favOnly.value = false
}
function pickSource(s: Source): void {
  favOnly.value = false
  folder.value = ''
  source.value = source.value === s ? 'all' : s
}
function pickFavorites(): void {
  folder.value = ''
  source.value = 'all'
  favOnly.value = !favOnly.value
}
function pickFolder(id: string): void {
  source.value = 'all'
  favOnly.value = false
  folder.value = id
}

const naming = ref<{ id?: string; parent?: string; name: string } | null>(null)
const vFocus = {
  mounted: (el: HTMLInputElement) =>
    requestAnimationFrame(() => {
      el.focus()
      el.select()
    })
}
function startNaming(n: { id?: string; parent?: string; name: string }): void {
  if (n.parent) toggle(n.parent, true)
  naming.value = n
}
function endNaming(keep: boolean): void {
  const n = naming.value
  naming.value = null
  if (!n || !keep) return
  if (n.id) renameFolder(n.id, n.name)
  else if (n.name.trim()) pickFolder(addFolder(n.name, n.parent).id)
}
const namingLevel = (parent?: string): number =>
  parent ? Math.min(ancestors(parent).length + 1, MAX_LEVELS) : 0

const menuFor = ref('')
function lines(id: string): MenuLine[] {
  return [
    {
      label: 'New subfolder',
      icon: FolderPlus,
      run: () => startNaming({ parent: id, name: 'New folder' })
    },
    { label: 'Rename', icon: Pencil, run: () => startNaming({ id, name: folderName(id) ?? '' }) },
    'sep',
    {
      label: 'Delete folder',
      icon: Trash2,
      danger: true,
      run: () => {
        if (within(id).has(folder.value)) folder.value = ''
        removeFolder(id)
      }
    }
  ]
}

const dropOn = ref('')
watch(
  () => dropping,
  (on) => !on && (dropOn.value = '')
)
function drop(id: string): void {
  dropOn.value = ''
  emit('drop', id)
}
</script>

<template>
  <nav class="mar-ftree" aria-label="Asset folders">
    <button
      type="button"
      class="mar-ftree-row"
      :class="allOn && 'is-on'"
      :aria-pressed="allOn"
      @click="pickAll"
    >
      <span class="mar-ftree-icon"><ComfyAssets :size="15" /></span>
      <span class="mar-ftree-name">All assets</span>
      <span class="mar-ftree-n">{{ items.length }}</span>
    </button>
    <button
      v-for="s in SMART"
      :key="s.id"
      type="button"
      class="mar-ftree-row"
      :class="source === s.id && !folder && !favOnly && 'is-on'"
      :aria-pressed="source === s.id && !folder && !favOnly"
      @click="pickSource(s.id)"
    >
      <span class="mar-ftree-icon"><component :is="s.icon" :size="15" /></span>
      <span class="mar-ftree-name">{{ s.label }}</span>
      <span class="mar-ftree-n">{{ s.count }}</span>
    </button>
    <button
      v-if="favorites"
      type="button"
      class="mar-ftree-row"
      :class="favOnly && 'is-on'"
      :aria-pressed="favOnly"
      @click="pickFavorites"
    >
      <span class="mar-ftree-icon"><Star :size="15" /></span>
      <span class="mar-ftree-name">Favorites</span>
      <span class="mar-ftree-n">{{ favCount }}</span>
    </button>

    <div class="mar-ftree-head">
      <p class="mar-ftree-label">
        Folders<span class="mar-ftree-label-n">{{ folders.length }}</span>
      </p>
      <Tooltip content="New folder" side="bottom">
        <button
          type="button"
          class="mar-ftree-add"
          aria-label="New folder"
          @click="startNaming({ name: 'New folder' })"
        >
          <Plus :size="14" />
        </button>
      </Tooltip>
    </div>

    <div class="mar-ftree-list" role="tree" aria-label="Folders">
      <template v-for="f in ROWS" :key="f.id">
        <div
          class="mar-ftree-item"
          :class="[folder === f.id && 'is-on', dropOn === f.id && 'is-drop']"
          :style="{ '--level': f.level, '--indent': `${INDENT}px` }"
          role="treeitem"
          :aria-selected="folder === f.id"
          :aria-expanded="f.kids ? open.has(f.id) : undefined"
          @dragover.prevent="dropping && (dropOn = f.id)"
          @dragleave="dropOn === f.id && (dropOn = '')"
          @drop.prevent="drop(f.id)"
          @contextmenu.prevent="menuFor = f.id"
        >
          <i v-for="g in f.guides" :key="g" class="mar-ftree-guide" :style="{ '--at': g }" />
          <div v-if="naming?.id === f.id" class="mar-ftree-naming">
            <span class="mar-ftree-chev-room" />
            <span class="mar-ftree-icon" :style="{ color: f.color }"
              ><component :is="f.icon" :size="15"
            /></span>
            <input
              v-model="naming.name"
              v-focus
              aria-label="Folder name"
              @keydown.enter="endNaming(true)"
              @keydown.esc="endNaming(false)"
              @blur="endNaming(true)"
            />
          </div>
          <template v-else>
            <button
              type="button"
              class="mar-ftree-row is-folder"
              :aria-pressed="folder === f.id"
              @click="pickFolder(f.id)"
              @dblclick="startNaming({ id: f.id, name: f.name })"
            >
              <span class="mar-ftree-chev-room" />
              <span class="mar-ftree-icon" :style="{ color: f.color }"
                ><component :is="f.icon" :size="15"
              /></span>
              <span class="mar-ftree-name" :title="f.name">{{ f.name }}</span>
              <span class="mar-ftree-n">{{ f.count }}</span>
            </button>
            <button
              v-if="f.kids"
              type="button"
              class="mar-ftree-chev"
              :class="open.has(f.id) && 'is-open'"
              :aria-label="`${open.has(f.id) ? 'Collapse' : 'Expand'} ${f.name}`"
              @click="toggle(f.id)"
            >
              <ChevronRight :size="13" />
            </button>
            <span class="mar-ftree-tools">
              <MarItemMenu
                :open="menuFor === f.id"
                :lines="lines(f.id)"
                label="Folder actions"
                @update:open="menuFor = $event ? f.id : ''"
              />
            </span>
          </template>
        </div>
        <div
          v-if="naming && !naming.id && naming.parent === f.id"
          class="mar-ftree-item"
          :style="{ '--level': namingLevel(f.id), '--indent': `${INDENT}px` }"
        >
          <div class="mar-ftree-naming">
            <span class="mar-ftree-chev-room" />
            <span class="mar-ftree-icon" :style="{ color: f.color }"><Folder :size="15" /></span>
            <input
              v-model="naming.name"
              v-focus
              aria-label="Folder name"
              @keydown.enter="endNaming(true)"
              @keydown.esc="endNaming(false)"
              @blur="endNaming(true)"
            />
          </div>
        </div>
      </template>
      <div
        v-if="naming && !naming.id && !naming.parent"
        class="mar-ftree-item"
        :style="{ '--level': 0, '--indent': `${INDENT}px` }"
      >
        <div class="mar-ftree-naming">
          <span class="mar-ftree-chev-room" />
          <span class="mar-ftree-icon"><Folder :size="15" /></span>
          <input
            v-model="naming.name"
            v-focus
            aria-label="Folder name"
            @keydown.enter="endNaming(true)"
            @keydown.esc="endNaming(false)"
            @blur="endNaming(true)"
          />
        </div>
      </div>
    </div>

    <button
      type="button"
      class="mar-ftree-row mar-ftree-new"
      @click="startNaming({ name: 'New folder' })"
    >
      <span class="mar-ftree-chev-room" />
      <span class="mar-ftree-icon"><Plus :size="15" /></span>
      <span class="mar-ftree-name">New folder</span>
    </button>
  </nav>
</template>

<style>
.mar-ftree-panel {
  position: relative;
  z-index: 4;
  width: 248px;
  flex: none;
  margin: 8px 0 8px 8px;
  overflow-y: auto;
  border-radius: var(--mar-panels-radius, 14px);
  background: var(--mar-panels-side, var(--color-app-background));
  animation: mar-ftree-in 240ms var(--mar-ease-io, ease) both;
  scrollbar-width: none;
}
@keyframes mar-ftree-in {
  from {
    opacity: 0;
    translate: -8px 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mar-ftree-panel {
    animation: none;
  }
}
.mar-ftree {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 12px 8px 16px;
}
:root .proto-ui.proto-ui.proto-ui .mar-ftree-row {
  display: flex;
  width: 100%;
  height: 30px;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--color-muted-foreground);
  cursor: pointer;
  font-size: 13px;
  font-weight: 400;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .mar-ftree-row:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-ftree-row.is-on,
:root .proto-ui.proto-ui.proto-ui .mar-ftree-item.is-on .mar-ftree-row {
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-ftree-item.is-drop .mar-ftree-row {
  background: color-mix(in oklch, var(--color-base-foreground) 16%, transparent);
  color: var(--color-base-foreground);
}
.mar-ftree-icon {
  display: inline-flex;
  width: 16px;
  flex: none;
  align-items: center;
  justify-content: center;
}
.mar-ftree-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-ftree-n {
  color: var(--color-subtle-foreground);
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.mar-ftree-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 4px 6px 8px;
}
.mar-ftree-label {
  display: flex;
  align-items: baseline;
  gap: 6px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.mar-ftree-label-n {
  font-family: var(--font-mono);
  letter-spacing: 0;
}
:root .proto-ui.proto-ui.proto-ui .mar-ftree-add {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--color-muted-foreground);
  cursor: pointer;
}
:root .proto-ui.proto-ui.proto-ui .mar-ftree-add:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
.mar-ftree-list {
  display: flex;
  flex-direction: column;
}
.mar-ftree-item {
  position: relative;
  border-radius: var(--radius-control);
}
:root .proto-ui.proto-ui.proto-ui .mar-ftree-item .mar-ftree-row,
.mar-ftree-item .mar-ftree-naming {
  padding-left: calc(8px + var(--level) * var(--indent));
}
.mar-ftree-guide {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--at) * var(--indent) + 15px);
  width: 1px;
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  pointer-events: none;
}
.mar-ftree-chev-room {
  width: 14px;
  flex: none;
  margin-right: -4px;
}
:root .proto-ui.proto-ui.proto-ui .mar-ftree-chev {
  position: absolute;
  top: 8px;
  left: calc(var(--level) * var(--indent) + 8px);
  display: flex;
  width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-subtle-foreground);
  cursor: pointer;
}
:root .proto-ui.proto-ui.proto-ui .mar-ftree-chev:hover {
  color: var(--color-base-foreground);
}
.mar-ftree-chev svg {
  transition: rotate 150ms ease-out;
}
.mar-ftree-chev.is-open svg {
  rotate: 90deg;
}
@media (prefers-reduced-motion: reduce) {
  .mar-ftree-chev svg {
    transition: none;
  }
}
.mar-ftree-tools {
  position: absolute;
  top: 50%;
  right: 3px;
  display: flex;
  opacity: 0;
  translate: 0 -50%;
  transition: opacity 120ms ease;
}
.mar-ftree-item:is(:hover, :focus-within) .mar-ftree-tools,
.mar-ftree-tools:has([data-state='open']) {
  opacity: 1;
}
.mar-ftree-item:is(:hover, :focus-within, :has([data-state='open'])) .mar-ftree-n {
  visibility: hidden;
}
:root .proto-ui.proto-ui.proto-ui .mar-ftree-tools .mar-kebab {
  width: 24px;
  height: 24px;
}
.mar-ftree-naming {
  display: flex;
  height: 30px;
  align-items: center;
  gap: 8px;
  padding: 0 4px 0 8px;
  color: var(--color-muted-foreground);
}
.mar-ftree-naming input {
  min-width: 0;
  flex: 1;
  height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-control);
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
  font-size: 13px;
  outline: none;
}
.mar-ftree-naming input:focus {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .mar-ftree-new {
  margin-top: 4px;
  color: var(--color-subtle-foreground);
}
</style>
