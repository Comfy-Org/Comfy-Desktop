<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import {
  ArrowRight,
  BookOpen,
  Circle,
  Cloud,
  CornerDownLeft,
  Folder,
  FolderPlus,
  Moon,
  PanelsTopLeft,
  Plus,
  Search,
  Settings2,
  Sun,
  WifiOff,
  X
} from 'lucide-vue-next'
import { ComfyAssets, ComfyTemplate, ComfyWorkflow } from '../icons/comfyIcons'
import { APPS, CLOUD_ASSETS, TEMPLATES, WORKFLOWS, thumb, type Template } from '../../mock'
import { openApp } from '../../appFlow'
import { SPACES } from '../../spaces'
import {
  activeInstance,
  go,
  hostActions,
  instanceById,
  instances,
  openDetail,
  toast,
  type Page
} from '../../useProto'
import { look } from '../../look'
import { newProject, projects } from '../pages/projectsStore'
import { retry, shownState } from '../pages/pageState'
import MarEmpty from '../pages/MarEmpty.vue'
import MarSeg from '../pages/MarSeg.vue'
import { search } from './search'
import { match, segments } from './match'
import './search.css'

/**
 * Global search (⌘K) in Mar's proposal: a command palette. One field,
 * the scopes as the New UI tab group, and one list under them: rows with
 * a small picture, the name, what it is and where it lives, grouped and
 * capped per group with a "See all" row. Empty: recent work, suggested
 * templates, actions with their shortcuts. Follows the Page state
 * (loading skeletons, offline, a first-time user with nothing yet).
 *
 * Keys: ↑↓ move through the one list (the pointer moves the same
 * highlight), ↵ opens, ⌘↵ opens in Comfy Cloud where that applies;
 * Tab / ⇧Tab, ←→ on an empty field or ⌘1–7 switch scope, ⌫ on an empty
 * field goes back to All; Esc or ⌘K closes. The footer says what ↵ does
 * for the row you're on.
 */
type Scope = 'all' | 'templates' | 'workflows' | 'projects' | 'spaces' | 'apps' | 'assets'
type Kind =
  | 'template'
  | 'workflow'
  | 'project'
  | 'space'
  | 'app'
  | 'asset'
  | 'action'
  | 'more'
  | 'docs'

interface Item {
  key: string
  kind: Kind
  label: string
  /** Matched character indices, for bold. */
  at?: number[]
  /** Where it lives or its state, after the type. */
  meta?: string
  image?: string
  tile?: { mark: string; bg: string; fg: string }
  icon: Component
  shortcut?: string[]
  score?: number
  open: () => void
  cloud?: () => void
}
interface Group {
  name: string
  items: (Item & { index: number })[]
}

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'templates', label: 'Templates' },
  { value: 'workflows', label: 'Workflows' },
  { value: 'projects', label: 'Projects' },
  { value: 'spaces', label: 'Spaces' },
  { value: 'apps', label: 'Apps' },
  { value: 'assets', label: 'Assets' }
]
const TYPE: Record<Kind, string> = {
  template: 'Template',
  workflow: 'Workflow',
  project: 'Project',
  space: 'Space',
  app: 'App',
  asset: 'Asset',
  action: '',
  more: '',
  docs: ''
}
/** Results per group in All before "See all". */
const CAP = 3

const query = ref('')
const scope = ref<Scope>('all')
const input = ref<HTMLInputElement>()
const list = ref<HTMLElement>()
const active = ref(0)

// --- What can be found ----------------------------------------------------

const CATEGORY = { image: 'Image', video: 'Video', '3d': '3D', audio: 'Audio' } as const
const WHERE = { local: 'Local', cloud: 'Comfy Cloud', both: 'Local or Cloud' } as const
const cloudInstance = (): ReturnType<typeof instanceById> =>
  instances.value.find((i) => i.kind === 'cloud')

/** "12 min ago" → "12m", "Yesterday" → "1d". */
function ago(when: string): string {
  const w = when.toLowerCase()
  if (w === 'just now') return 'now'
  if (w === 'yesterday') return '1d'
  if (w === 'last week') return '1w'
  const m = w.match(/^(\d+) (min|hour|day|week)/)
  return m ? `${m[1]}${{ min: 'm', hour: 'h', day: 'd', week: 'w' }[m[2]!]}` : when
}
const dot = (...parts: (string | undefined)[]): string => parts.filter(Boolean).join(' · ')

function inCloud(what: string, then: () => void): () => void {
  return () => {
    toast(`Opening ${what} in Comfy Cloud`)
    then()
  }
}

const templateItem = (t: Template): Item => ({
  key: `t:${t.id}`,
  kind: 'template',
  label: t.title,
  meta: dot(CATEGORY[t.category], WHERE[t.runs]),
  image: thumb(t.id),
  icon: t.kind === 'app' ? PanelsTopLeft : ComfyTemplate,
  open: () => openDetail('template', t.id),
  cloud: t.runs === 'local' ? undefined : inCloud(t.title, () => openDetail('template', t.id))
})
const templates = computed(() => TEMPLATES.map(templateItem))

const workflows = computed<Item[]>(() =>
  WORKFLOWS.map((w) => {
    const name = w.name.replace(/\.json$/, '')
    const on = instanceById(w.instanceId)
    return {
      key: `w:${w.name}`,
      kind: 'workflow',
      label: name,
      meta: dot(w.project ?? on?.name, ago(w.modified)),
      image: thumb(w.thumbId),
      icon: ComfyWorkflow,
      open: () => openDetail('workflow', w.name),
      cloud: on?.kind === 'cloud' ? undefined : inCloud(name, () => openDetail('workflow', w.name))
    }
  })
)

const projectItems = computed<Item[]>(() =>
  projects.items
    .filter((p) => !p.archived)
    .map((p) => ({
      key: `p:${p.id}`,
      kind: 'project',
      label: p.name,
      meta: dot(instanceById(p.envId)?.name, ago(p.updated)),
      image: p.art,
      icon: Folder,
      open: () => go(`project:${p.id}` as Page)
    }))
)

const STATUS = { live: 'Live', draft: 'Draft', paused: 'Paused' } as const
const spaces = computed<Item[]>(() =>
  SPACES.map((s) => ({
    key: `s:${s.id}`,
    kind: 'space',
    label: s.name,
    meta: dot(STATUS[s.status], s.domain),
    tile: {
      mark: s.brand.logo.mark,
      bg: s.brand.logo.bg ?? s.brand.color,
      fg: s.brand.logo.fg ?? '#fff'
    },
    icon: Circle,
    open: () => go(`space:${s.id}` as Page)
  }))
)

const compact = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const apps = computed<Item[]>(() =>
  APPS.map((a) => ({
    key: `a:${a.id}`,
    kind: 'app',
    label: a.name,
    meta: dot(a.you ? 'Yours' : a.owner, `${compact(a.runs)} runs`),
    image: thumb(a.thumbId),
    icon: PanelsTopLeft,
    open: () => openApp(a.id)
  }))
)

const MEDIA = { image: 'Image', video: 'Video', '3d': '3D', audio: 'Audio' } as const
const assets = computed<Item[]>(() =>
  CLOUD_ASSETS.map((a) => ({
    key: `m:${a.id}`,
    kind: 'asset',
    label: a.name,
    meta: dot(MEDIA[a.type], a.project ?? a.when),
    image: thumb(a.thumbId),
    icon: ComfyAssets,
    open: () => go('assets')
  }))
)

function toggleTheme(): void {
  look.theme = look.theme === 'light' ? 'dark' : 'light'
}
const actions = computed<Item[]>(() => [
  {
    key: 'x:new-workflow',
    kind: 'action',
    label: 'New workflow',
    icon: Plus,
    shortcut: ['⌘', 'N'],
    open: () => {
      const on = activeInstance.value
      if (on) hostActions.launch(on)
    }
  },
  {
    key: 'x:new-project',
    kind: 'action',
    label: 'New project',
    icon: FolderPlus,
    shortcut: ['⇧', '⌘', 'P'],
    open: () => go(`project:${newProject().id}` as Page)
  },
  {
    key: 'x:cloud',
    kind: 'action',
    label: 'Open Comfy Cloud',
    icon: Cloud,
    shortcut: ['⇧', '⌘', 'C'],
    open: () => {
      const c = cloudInstance()
      if (c) hostActions.launch(c)
    }
  },
  {
    key: 'x:settings',
    kind: 'action',
    label: 'Go to Settings',
    icon: Settings2,
    shortcut: ['⌘', ','],
    open: () => go('settings' as Page)
  },
  {
    key: 'x:theme',
    kind: 'action',
    label: look.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme',
    icon: look.theme === 'light' ? Moon : Sun,
    shortcut: ['⇧', '⌘', 'L'],
    open: toggleTheme
  }
])

type Library = Exclude<Scope, 'all'>
const BY_SCOPE = computed<Record<Library, Item[]>>(() => ({
  templates: templates.value,
  workflows: workflows.value,
  projects: projectItems.value,
  spaces: spaces.value,
  apps: apps.value,
  assets: assets.value
}))
const scopeLabel = (s: Scope): string => SCOPES.find((x) => x.value === s)!.label

// --- What shows -----------------------------------------------------------

const q = computed(() => query.value.trim())
/** Templates come from the catalog, the rest from your library, which
 *  follows the Page state (loading, offline, nothing yet). */
const state = computed(() => shownState.value)
const reachable = (s: Library): boolean => state.value === 'live' || s === 'templates'

function hits(items: Item[]): Item[] {
  const out: (Item & { score: number })[] = []
  for (const it of items) {
    const m = match(it.label, q.value)
    if (m) out.push({ ...it, at: m.at, score: m.score })
  }
  return out.sort((a, b) => b.score - a.score)
}

function seeAll(s: Library, n: number): Item {
  return {
    key: `more:${s}`,
    kind: 'more',
    label: `See all ${n} in ${scopeLabel(s)}`,
    icon: ArrowRight,
    shortcut: ['⌘', String(SCOPES.findIndex((x) => x.value === s) + 1)],
    open: () => setScope(s)
  }
}
const docs = computed<Item>(() => ({
  key: 'docs',
  kind: 'docs',
  label: `Search the docs for “${q.value}”`,
  icon: BookOpen,
  open: () => toast(`Searching the docs for “${q.value}”`)
}))

const QUICK = ['x:new-workflow', 'x:new-project', 'x:cloud', 'x:settings']
const groups = computed<Group[]>(() => {
  const out: { name: string; items: Item[] }[] = []
  if (!q.value && scope.value === 'all') {
    if (state.value === 'live') {
      const w = workflows.value
      const p = projectItems.value
      out.push({ name: 'Recent', items: [w[0], p[3], w[1]].filter((it): it is Item => !!it) })
    }
    out.push({
      name: 'Suggested templates',
      items: [
        ...[4, 1].map((i) => templates.value[i]).filter((it): it is Item => !!it),
        seeAll('templates', templates.value.length)
      ]
    })
    out.push({ name: 'Actions', items: actions.value.filter((a) => QUICK.includes(a.key)) })
  } else if (!q.value) {
    const s = scope.value as Library
    if (reachable(s)) out.push({ name: scopeLabel(s), items: BY_SCOPE.value[s] })
  } else if (scope.value === 'all') {
    const found = (SCOPES.slice(1) as { value: Library; label: string }[])
      .filter((s) => reachable(s.value))
      .map((s) => ({
        scope: s.value as Library | undefined,
        name: s.label,
        items: hits(BY_SCOPE.value[s.value])
      }))
    const all = [...found, { scope: undefined, name: 'Actions', items: hits(actions.value) }]
      .filter((g) => g.items.length)
      .sort((a, b) => (b.items[0]!.score ?? 0) - (a.items[0]!.score ?? 0))
    for (const g of all)
      out.push({
        name: g.name,
        items:
          g.scope && g.items.length > CAP
            ? [...g.items.slice(0, CAP), seeAll(g.scope, g.items.length)]
            : g.items
      })
  } else {
    const s = scope.value as Library
    const items = reachable(s) ? hits(BY_SCOPE.value[s]) : []
    if (items.length) out.push({ name: scopeLabel(s), items })
  }
  if (q.value && out.length) out.push({ name: 'Docs', items: [docs.value] })

  let index = 0
  return out.map((g) => ({ ...g, items: g.items.map((it) => ({ ...it, index: index++ })) }))
})
const flat = computed(() => groups.value.flatMap((g) => g.items))
const current = computed(() => flat.value[active.value])
const inLibrary = computed(() => scope.value !== 'all' && scope.value !== 'templates')
const loading = computed(() => state.value === 'loading' && inLibrary.value)
const offline = computed(() => state.value === 'error' && inLibrary.value)
const none = computed(() => !!q.value && !flat.value.length && !loading.value && !offline.value)
const nothingYet = computed(
  () => !q.value && !flat.value.length && !loading.value && !offline.value
)

/** Type and meta on a row; only Recent mixes types; everywhere else the
 *  group's title already says it. */
function sub(it: Item, group: string): string {
  return dot(group === 'Recent' ? TYPE[it.kind] : undefined, it.meta)
}

// --- Scopes ---------------------------------------------------------------

function setScope(s: Scope): void {
  scope.value = s
  input.value?.focus()
}
function stepScope(by: number): void {
  const i = SCOPES.findIndex((s) => s.value === scope.value)
  setScope(SCOPES[(i + by + SCOPES.length) % SCOPES.length]!.value)
}
watch([query, scope], () => {
  active.value = 0
  nextTick(() => list.value?.scrollTo({ top: 0 }))
})

// --- Keyboard and pointer -------------------------------------------------

function close(): void {
  search.open = false
}
function choose(it: Item | undefined, inCloud = false): void {
  if (!it) return
  if (it.kind !== 'more') close()
  if (inCloud && it.cloud) it.cloud()
  else it.open()
}
function move(by: number): void {
  const n = flat.value.length
  if (!n) return
  active.value = (active.value + by + n) % n
}

const SHORTCUTS: Record<string, string> = {
  n: 'x:new-workflow',
  P: 'x:new-project',
  C: 'x:cloud',
  ',': 'x:settings',
  L: 'x:theme'
}
function onKey(e: KeyboardEvent): void {
  const mod = e.metaKey || e.ctrlKey
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !query.value) {
    e.preventDefault()
    stepScope(e.key === 'ArrowRight' ? 1 : -1)
  } else if (e.key === 'Tab') {
    e.preventDefault()
    stepScope(e.shiftKey ? -1 : 1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    choose(current.value, mod)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'Backspace' && !query.value && scope.value !== 'all') {
    e.preventDefault()
    setScope('all')
  } else if (mod && /^[1-7]$/.test(e.key)) {
    e.preventDefault()
    setScope(SCOPES[Number(e.key) - 1]!.value)
  } else if (mod && e.key.toLowerCase() !== 'k') {
    const key = SHORTCUTS[e.shiftKey ? e.key.toUpperCase() : e.key]
    const it = key && actions.value.find((a) => a.key === key)
    if (it) {
      e.preventDefault()
      choose(it)
    }
  }
}

/** The pointer takes the highlight only when it really moves, so a list
 *  scrolling under a still pointer doesn't steal it from the keys. */
let last = { x: -1, y: -1 }
function onPointer(e: PointerEvent, i: number): void {
  if (e.clientX === last.x && e.clientY === last.y) return
  last = { x: e.clientX, y: e.clientY }
  active.value = i
}

/** Keep the active row in view; the first row of a group brings its title. */
watch(active, (i) =>
  nextTick(() => {
    const el = list.value?.querySelector<HTMLElement>(`[data-i="${i}"]`)
    if (!el) return
    const head = el.previousElementSibling
    if (head?.classList.contains('mar-search-head')) head.scrollIntoView({ block: 'nearest' })
    el.scrollIntoView({ block: 'nearest' })
  })
)

// --- Open and close -------------------------------------------------------

watch(
  () => search.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (!open) return
    query.value = ''
    scope.value = 'all'
    active.value = 0
    nextTick(() => input.value?.focus())
  }
)

function onGlobalKey(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    search.open = !search.open
  }
}
onMounted(() => window.addEventListener('keydown', onGlobalKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  document.body.style.overflow = ''
})

const placeholder = computed(() =>
  scope.value === 'all' ? 'Search or jump to…' : `Search ${scopeLabel(scope.value).toLowerCase()}…`
)
const optionId = (i: number): string => `mar-search-opt-${i}`
/** What ↵ (and ⌘↵) do for the row you're on, for the footer. */
const verbs = computed(() => {
  const it = current.value
  if (!it) return []
  const main = {
    action: 'Run',
    more: 'Show all',
    docs: 'Search',
    asset: 'Show in Assets'
  }[it.kind as string]
  return [
    { keys: ['↵'], label: main ?? 'Open' },
    ...(it.cloud ? [{ keys: ['⌘', '↵'], label: 'Open in Cloud' }] : [])
  ]
})
</script>

<template>
  <Teleport to="body">
    <Transition name="mar-search">
      <div v-if="search.open" class="proto-ui mar-search-scrim" @pointerdown.self="close">
        <div
          class="mar-search"
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          @keydown="onKey"
          @mousedown="($event.target as HTMLElement).closest('input') || $event.preventDefault()"
        >
          <div class="mar-search-field">
            <Search :size="17" class="mar-search-glass" />
            <input
              ref="input"
              v-model="query"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="mar-search-list"
              aria-autocomplete="list"
              :aria-activedescendant="current ? optionId(active) : undefined"
              :placeholder
              aria-label="Search"
              spellcheck="false"
              autocomplete="off"
            />
            <button
              v-if="query"
              type="button"
              tabindex="-1"
              class="mar-search-clear"
              aria-label="Clear"
              @click="((query = ''), input?.focus())"
            >
              <X :size="14" />
            </button>
          </div>

          <div class="mar-search-scopes">
            <MarSeg v-model="scope" :options="SCOPES" label="Search in" />
          </div>

          <div
            id="mar-search-list"
            ref="list"
            class="mar-search-list"
            role="listbox"
            aria-label="Results"
          >
            <div v-if="loading" class="mar-search-group" aria-busy="true" aria-label="Loading">
              <div class="mar-search-head"><span class="mar-search-skel is-head" /></div>
              <div v-for="n in 5" :key="n" class="mar-search-row is-skel">
                <span class="mar-search-lead mar-search-skel" />
                <span
                  class="mar-search-skel"
                  :style="{ width: `${[38, 52, 30, 46, 34][n - 1]}%` }"
                />
              </div>
            </div>

            <div v-else-if="offline" class="mar-search-none">
              <MarEmpty
                compact
                tone="error"
                :icon="WifiOff"
                title="Can’t reach your library"
                text="Check your connection, then try again."
                action="Try again"
                @action="retry"
              />
            </div>

            <template v-else>
              <section v-for="g in groups" :key="g.name" class="mar-search-group">
                <div class="mar-search-head">{{ g.name }}</div>
                <div
                  v-for="it in g.items"
                  :id="optionId(it.index)"
                  :key="it.key"
                  role="option"
                  :aria-selected="active === it.index"
                  :data-i="it.index"
                  class="mar-search-row"
                  :class="[active === it.index && 'is-on', `is-${it.kind}`]"
                  @pointermove="onPointer($event, it.index)"
                  @click="choose(it)"
                >
                  <span class="mar-search-lead" :class="!it.image && !it.tile && 'is-icon'">
                    <img v-if="it.image" :src="it.image" alt="" />
                    <span
                      v-else-if="it.tile"
                      class="mar-search-mark"
                      :style="{ background: it.tile.bg, color: it.tile.fg }"
                      >{{ it.tile.mark }}</span
                    >
                    <component :is="it.icon" v-else :size="15" />
                  </span>
                  <span class="mar-search-label"
                    ><template v-for="(s, k) in segments(it.label, it.at ?? [])" :key="k"
                      ><mark v-if="s.hit">{{ s.text }}</mark
                      ><template v-else>{{ s.text }}</template></template
                    ></span
                  >
                  <span v-if="sub(it, g.name)" class="mar-search-sub">{{ sub(it, g.name) }}</span>
                  <span class="mar-search-fill" />
                  <span v-if="it.shortcut" class="mar-search-keys">
                    <kbd v-for="k in it.shortcut" :key="k">{{ k }}</kbd>
                  </span>
                  <span v-else-if="active === it.index" class="mar-search-keys">
                    <kbd><CornerDownLeft :size="11" /></kbd>
                  </span>
                </div>
              </section>

              <div v-if="none" class="mar-search-none">
                <MarEmpty
                  compact
                  :icon="Search"
                  :title="`No results for “${q}”`"
                  :text="
                    scope === 'all'
                      ? 'Try another word, or search the docs.'
                      : `Nothing in ${scopeLabel(scope)}. Try All.`
                  "
                  :action="scope === 'all' ? 'Search the docs' : 'Search everything'"
                  @action="scope === 'all' ? choose(docs) : setScope('all')"
                />
              </div>
              <div v-else-if="nothingYet" class="mar-search-none">
                <MarEmpty
                  compact
                  :icon="Search"
                  :title="`No ${scopeLabel(scope).toLowerCase()} yet`"
                  text="What you make shows up here."
                />
              </div>
            </template>
          </div>

          <footer class="mar-search-foot">
            <span v-for="v in verbs" :key="v.label" class="mar-search-verb">
              <kbd v-for="k in v.keys" :key="k">{{ k }}</kbd
              >{{ v.label }}
            </span>
            <span class="mar-search-fill" />
            <span class="mar-search-verb"><kbd>⇥</kbd>Scope</span>
            <span class="mar-search-verb"><kbd>esc</kbd>Close</span>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
