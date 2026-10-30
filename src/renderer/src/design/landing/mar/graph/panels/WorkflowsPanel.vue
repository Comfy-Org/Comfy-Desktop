<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { Bookmark, ChevronDown, Folder, Plus, RefreshCw, Search } from 'lucide-vue-next'
import RailPanel from './RailPanel.vue'
import { APPS, WORKFLOW_TREE, type FileNode } from './panelData'
import { ComfyWorkflow } from '../../icons/comfyIcons'

/**
 * Workflows and Apps (ComfyUI's BaseWorkflowsSidebarTab, which Apps reuses
 * for its app files): Refresh, search, Bookmarks when there are any, then
 * Browse, the saved files as a tree. Apps adds a BETA badge and Create.
 */
const { kind, active } = defineProps<{ kind: 'workflows' | 'apps'; active: string }>()
const emit = defineEmits<{ close: []; open: [name: string] }>()

const apps = computed(() => kind === 'apps')
const query = ref('')
const input = ref<HTMLInputElement>()
onMounted(() => nextTick(() => input.value?.focus()))
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
  const base: FileNode[] = apps.value ? APPS.map((name) => ({ name })) : WORKFLOW_TREE
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
      <div class="rp-top">
        <label class="rp-search">
          <Search :size="14" />
          <input
            ref="input"
            v-model="query"
            type="search"
            :placeholder="apps ? 'Search Apps...' : 'Search Workflows...'"
          />
        </label>
      </div>
    </template>

    <div class="rp-list">
      <template v-if="bookmarks.length && !query">
        <p class="wp-divider"><span>Bookmarks</span></p>
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
        <p v-if="!query" class="wp-divider"><span>Browse</span></p>
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

      <div v-else-if="apps && !query" class="rp-empty">
        <span>Saved apps will show up here.<br />Click below to build your first app.</span>
        <button type="button" class="rp-btn"><Plus :size="13" />Create app</button>
      </div>
      <div v-else class="rp-empty">
        <Folder :size="40" :stroke-width="1.25" />
        <strong>Empty</strong>
        <span>No workflows found.</span>
      </div>
    </div>
  </RailPanel>
</template>

<style>
.wp-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 6px 8px;
  color: var(--mg-dim);
  font-size: 11.5px;
}
.wp-divider::after {
  height: 0;
  flex: 1;
  border-top: 1px dashed var(--rp-line);
  content: '';
}
</style>
