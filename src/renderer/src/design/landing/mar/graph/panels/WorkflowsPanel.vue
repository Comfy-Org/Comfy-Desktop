<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { AppWindow, Bookmark, ChevronDown, Folder, Plus, RefreshCw, SearchX } from 'lucide-vue-next'
import RailPanel from './RailPanel.vue'
import { WORKFLOW_TREE, type FileNode } from './panelData'
import { LIB, addedApps } from '../../../appFlow'
import { ComfyWorkflow } from '../../icons/comfyIcons'
import MarSearchField from '../../pages/MarSearchField.vue'
import MarEmpty from '../../pages/MarEmpty.vue'

/**
 * Workflows and Apps (ComfyUI's BaseWorkflowsSidebarTab, which Apps reuses
 * for its app files): Refresh, search, Bookmarks when there are any, then
 * Browse, the saved files as a tree. Apps adds a BETA badge and Create.
 */
const { kind, active } = defineProps<{ kind: 'workflows' | 'apps'; active: string }>()
const emit = defineEmits<{ close: []; open: [name: string] }>()

const apps = computed(() => kind === 'apps')
const query = ref('')
onMounted(() =>
  nextTick(() => document.querySelector<HTMLInputElement>('.rp .mar-pfind input')?.focus())
)
const bookmarks = ref<string[]>(apps.value ? [] : ['portrait-sun'])
const shut = ref(new Set<string>())
const syncing = ref(false)
function refresh(): void {
  syncing.value = true
  setTimeout(() => (syncing.value = false), 700)
}
function toggle(name: string): void {
  const s = new Set(shut.value)
  if (s.has(name)) s.delete(name)
  else s.add(name)
  shut.value = s
}
function mark(name: string): void {
  bookmarks.value = bookmarks.value.includes(name)
    ? bookmarks.value.filter((b) => b !== name)
    : [...bookmarks.value, name]
}
const count = (n: FileNode): number =>
  n.children ? n.children.reduce((s, c) => s + count(c), 0) : 1
const tree = computed<FileNode[]>(() => {
  // Apps lists the same apps as Desktop's Apps page: yours, your team's,
  // shared with you, and the ones added from Explore.
  const base: FileNode[] = apps.value
    ? [...LIB, ...addedApps.value].map((a) => ({ name: a.name }))
    : WORKFLOW_TREE
  const q = query.value.trim().toLowerCase()
  if (!q) return [...base].sort((a, b) => Number(!a.children) - Number(!b.children))
  const leaves: FileNode[] = []
  const walk = (ns: FileNode[]): void =>
    ns.forEach((n) => (n.children ? walk(n.children) : leaves.push(n)))
  walk(base)
  return leaves.filter((l) => l.name.toLowerCase().includes(q))
})
</script>

<template>
  <RailPanel :title="apps ? 'Apps' : 'Workflows'" @close="emit('close')">
    <template v-if="apps" #alt-title><span class="rp-badge">BETA</span></template>
    <template #tools>
      <button type="button" class="rp-icon" aria-label="Refresh" title="Refresh" @click="refresh">
        <RefreshCw :size="14" :class="syncing && 'jp-spin'" />
      </button>
      <button v-if="apps && tree.length" type="button" class="rp-btn">
        <Plus :size="13" />Create
      </button>
    </template>
    <template #header>
      <MarSearchField
        v-model="query"
        :placeholder="apps ? 'Search Apps...' : 'Search Workflows...'"
      />
    </template>

    <div class="rp-list">
      <template v-if="bookmarks.length && !query">
        <p class="rp-section">Bookmarks</p>
        <div v-for="b in bookmarks" :key="`b-${b}`" class="np-line">
          <button
            type="button"
            class="rp-row"
            :class="b === active && 'is-on'"
            @click="emit('open', b)"
          >
            <ComfyWorkflow :size="14" class="rp-row-icon" /><span class="rp-row-text">{{ b }}</span>
          </button>
          <button
            type="button"
            class="rp-icon np-mark is-on"
            aria-label="Bookmark"
            @click="mark(b)"
          >
            <Bookmark :size="13" fill="currentColor" />
          </button>
        </div>
      </template>

      <template v-if="tree.length">
        <p v-if="!query" class="rp-section">Browse</p>
        <template v-for="n in tree" :key="n.name">
          <template v-if="n.children">
            <button type="button" class="rp-row" @click="toggle(n.name)">
              <ChevronDown :size="14" class="rp-chev" :class="shut.has(n.name) && 'is-shut'" />
              <Folder :size="14" class="rp-row-icon" /><span class="rp-row-text">{{ n.name }}</span>
              <span class="rp-count">{{ count(n) }}</span>
            </button>
            <template v-if="!shut.has(n.name)">
              <div v-for="c in n.children" :key="c.name" class="np-line is-in">
                <button
                  type="button"
                  class="rp-row"
                  :class="c.name === active && 'is-on'"
                  @click="emit('open', c.name)"
                >
                  <ComfyWorkflow :size="14" class="rp-row-icon" /><span class="rp-row-text">{{
                    c.name
                  }}</span>
                </button>
                <button
                  type="button"
                  class="rp-icon np-mark"
                  :class="bookmarks.includes(c.name) && 'is-on'"
                  aria-label="Bookmark"
                  @click="mark(c.name)"
                >
                  <Bookmark
                    :size="13"
                    :fill="bookmarks.includes(c.name) ? 'currentColor' : 'none'"
                  />
                </button>
              </div>
            </template>
          </template>
          <div v-else class="np-line">
            <button
              type="button"
              class="rp-row"
              :class="n.name === active && 'is-on'"
              @click="emit('open', n.name)"
            >
              <ComfyWorkflow v-if="!apps" :size="14" class="rp-row-icon" /><span
                class="rp-row-text"
                >{{ n.name }}</span
              >
            </button>
            <button
              type="button"
              class="rp-icon np-mark"
              :class="bookmarks.includes(n.name) && 'is-on'"
              aria-label="Bookmark"
              @click="mark(n.name)"
            >
              <Bookmark :size="13" :fill="bookmarks.includes(n.name) ? 'currentColor' : 'none'" />
            </button>
          </div>
        </template>
      </template>
    </div>
    <MarEmpty
      v-if="!tree.length && apps && !query"
      compact
      :icon="AppWindow"
      title="No apps yet"
      text="Saved apps will show up here. Click below to build your first app."
      action="Create app"
    />
    <MarEmpty
      v-else-if="!tree.length"
      compact
      :icon="query ? SearchX : Folder"
      :title="query ? 'No results' : 'No workflows yet'"
      :text="query ? `Nothing matches “${query}”.` : 'Saved workflows will show up here.'"
      :action="query ? 'Clear search' : undefined"
      @action="query = ''"
    />
  </RailPanel>
</template>

<style>
.rp-list > .rp-section:first-child {
  padding-top: 8px;
}
</style>
