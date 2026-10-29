<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import {
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
  X
} from 'lucide-vue-next'
import { ComfyAssets, ComfyTemplate, ComfyWorkflow } from '../icons/comfyIcons'
import { APPS, CLOUD_ASSETS, TEMPLATES, WORKFLOWS, thumb, type Template } from '../../mock'
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
import MarEmpty from '../pages/MarEmpty.vue'
import { search } from './search'
import { match, segments } from './match'
import './search.css'

/**
 * Global search (⌘K) in Mar's proposal, a command palette: one line to
 * type in, scopes (chips, a `w␣` prefix or Tab), and the panel sizes to
 * what it shows. Empty: your recent work, four suggested templates and
 * the quick actions. Typing: results grouped by kind, matched letters in
 * bold, a docs search as the last way out. ↑↓ move a raised highlight
 * (the pointer moves it too), ↵ opens, ⌘↵ opens in Comfy Cloud where
 * that applies, Esc or ⌘K closes.
 */
type Scope = 'all' | 'templates' | 'workflows' | 'projects' | 'spaces' | 'apps' | 'assets'

interface Item {
  key: string
  group: string
  label: string
  at?: number[]
  meta: string[]
  image?: string
  tile?: { mark: string; bg: string; fg: string }
  icon: Component
  shortcut?: string[]
  score?: number
  open: () => void
  cloud?: () => void
}
interface Section {
  name: string
  scope?: Scope
  tiles?: boolean
  more?: number
  items: (Item & { index: number })[]
}

const SCOPES: { id: Scope; label: string; prefix?: string; icon?: Component }[] = [
  { id: 'all', label: 'All' },
  { id: 'templates', label: 'Templates', prefix: 't', icon: ComfyTemplate },
  { id: 'workflows', label: 'Workflows', prefix: 'w', icon: ComfyWorkflow },
  { id: 'projects', label: 'Projects', prefix: 'p', icon: Folder },
  { id: 'spaces', label: 'Spaces', prefix: 's', icon: Circle },
  { id: 'apps', label: 'Apps', prefix: 'a', icon: PanelsTopLeft },
  { id: 'assets', label: 'Assets', prefix: 'as', icon: ComfyAssets }
]
const PER_GROUP = 4

const query = ref('')
const scope = ref<Scope>('all')
const input = ref<HTMLInputElement>()
const list = ref<HTMLElement>()
const active = ref(0)

// --- What can be found ----------------------------------------------------

const RUNS = ['7.9k', '7.5k', '6.5k', '4.5k', '3.4k', '3.2k', '3.1k', '2.9k', '2.1k', '1.8k']
const CATEGORY = { image: 'Image', video: 'Video', '3d': '3D', audio: 'Audio' } as const
const WHERE = { local: 'Local', cloud: 'Comfy Cloud', both: 'Local or Cloud' } as const
const cloud = (): ReturnType<typeof instanceById> => instances.value.find((i) => i.kind === 'cloud')

function inCloud(what: string, then: () => void): () => void {
  return () => {
    toast(`Opening ${what} in Comfy Cloud`)
    then()
  }
}

const templateItem = (t: Template, i: number): Item => ({
  key: `t:${t.id}`,
  group: 'Templates',
  label: t.title,
  meta: [CATEGORY[t.category], WHERE[t.runs], `${RUNS[i % RUNS.length]} runs`],
  image: thumb(t.id),
  icon: t.kind === 'app' ? PanelsTopLeft : ComfyTemplate,
  open: () => openDetail('template', t.id),
  cloud: t.runs === 'local' ? undefined : inCloud(t.title, () => openDetail('template', t.id))
})
const templates = computed(() => TEMPLATES.map(templateItem))

const workflows = computed<Item[]>(() =>
  WORKFLOWS.map((w) => {
    const name = w.name.replace(/\.json$/, '')
    const runsOn = instanceById(w.instanceId)?.name
    return {
      key: `w:${w.name}`,
      group: 'Workflows',
      label: name,
      meta: [w.project, runsOn, w.modified].filter((m): m is string => !!m),
      image: thumb(w.thumbId),
      icon: ComfyWorkflow,
      open: () => openDetail('workflow', w.name),
      cloud:
        instanceById(w.instanceId)?.kind === 'cloud'
          ? undefined
          : inCloud(name, () => openDetail('workflow', w.name))
    }
  })
)

const projectItems = computed<Item[]>(() =>
  projects.items
    .filter((p) => !p.archived)
    .map((p) => {
      const count = WORKFLOWS.filter((w) => w.project === p.name).length
      return {
        key: `p:${p.id}`,
        group: 'Projects',
        label: p.name,
        meta: [
          instanceById(p.envId)?.name ?? 'Deployment',
          count ? `${count} workflow${count === 1 ? '' : 's'}` : 'No workflows yet',
          p.updated
        ],
        image: p.art,
        icon: Folder,
        open: () => go(`project:${p.id}` as Page)
      }
    })
)

const STATUS = { live: 'Live', draft: 'Draft', paused: 'Paused' } as const
const spaces = computed<Item[]>(() =>
  SPACES.map((s) => ({
    key: `s:${s.id}`,
    group: 'Spaces',
    label: s.name,
    meta: [STATUS[s.status], s.domain, `${s.members.length} members`],
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
    group: 'Apps',
    label: a.name,
    meta: [a.you ? 'Yours' : a.owner, `${compact(a.runs)} runs`, `Updated ${a.updated}`],
    image: thumb(a.thumbId),
    icon: PanelsTopLeft,
    open: () => go(`app:${a.id}` as Page)
  }))
)

const TYPE = { image: 'Image', video: 'Video', '3d': '3D', audio: 'Audio' } as const
const assets = computed<Item[]>(() =>
  CLOUD_ASSETS.map((a) => ({
    key: `m:${a.id}`,
    group: 'Assets',
    label: a.name,
    meta: [TYPE[a.type], a.size, a.project ?? a.when].filter((m): m is string => !!m),
    image: thumb(a.thumbId),
    icon: ComfyAssets,
    open: () => go('assets')
  }))
)

const actions = computed<Item[]>(() => [
  {
    key: 'x:new-workflow',
    group: 'Actions',
    label: 'New workflow',
    meta: [activeInstance.value ? `On ${activeInstance.value.name}` : 'Pick where it runs'],
    icon: Plus,
    shortcut: ['⌘', 'N'],
    open: () => {
      const on = activeInstance.value
      if (on) hostActions.launch(on)
    }
  },
  {
    key: 'x:new-project',
    group: 'Actions',
    label: 'New project',
    meta: ['A shared place for workflows'],
    icon: FolderPlus,
    shortcut: ['⇧', '⌘', 'P'],
    open: () => go(`project:${newProject().id}` as Page)
  },
  {
    key: 'x:cloud',
    group: 'Actions',
    label: 'Open Comfy Cloud',
    meta: [cloud()?.gpu ?? 'Run on rented GPUs'],
    icon: Cloud,
    shortcut: ['⇧', '⌘', 'C'],
    open: () => {
      const c = cloud()
      if (c) hostActions.launch(c)
    }
  },
  {
    key: 'x:settings',
    group: 'Actions',
    label: 'Go to Settings',
    meta: ['Account, appearance, shortcuts'],
    icon: Settings2,
    shortcut: ['⌘', ','],
    open: () => go('settings' as Page)
  },
  {
    key: 'x:theme',
    group: 'Actions',
    label: look.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme',
    meta: ['Appearance'],
    icon: look.theme === 'light' ? Moon : Sun,
    shortcut: ['⇧', '⌘', 'L'],
    open: toggleTheme
  }
])
function toggleTheme(): void {
  look.theme = look.theme === 'light' ? 'dark' : 'light'
}

const BY_SCOPE = computed<Record<Exclude<Scope, 'all'>, Item[]>>(() => ({
  templates: templates.value,
  workflows: workflows.value,
  projects: projectItems.value,
  spaces: spaces.value,
  apps: apps.value,
  assets: assets.value
}))

// --- What shows -----------------------------------------------------------

const q = computed(() => query.value.trim())

function hits(items: Item[]): Item[] {
  const out: (Item & { score: number })[] = []
  for (const it of items) {
    const m = match(it.label, q.value)
    if (m) out.push({ ...it, at: m.at, score: m.score })
  }
  return out.sort((a, b) => b.score - a.score)
}

/** How many results each scope has for the query (on the chips). */
const counts = computed(() => {
  const out: Partial<Record<Scope, number>> = {}
  if (!q.value) return out
  let all = 0
  for (const s of SCOPES) {
    if (s.id === 'all') continue
    const n = hits(BY_SCOPE.value[s.id]).length
    out[s.id] = n
    all += n
  }
  out.all = all + hits(actions.value).length
  return out
})

const docs = computed<Item>(() => ({
  key: 'd:docs',
  group: 'Docs',
  label: `Search the docs for “${q.value}”`,
  meta: ['docs.comfy.org'],
  icon: BookOpen,
  open: () => toast(`Searching the docs for “${q.value}”`)
}))

const sections = computed<Section[]>(() => {
  const out: (Omit<Section, 'items'> & { items: Item[] })[] = []
  if (!q.value) {
    if (scope.value === 'all') {
      const w = workflows.value
      const p = projectItems.value
      out.push({
        name: 'Recent',
        items: [w[0], p[3], w[1], w[2]]
          .filter((it): it is Item => !!it)
          .map((it) => ({ ...it, meta: [it.group.replace(/s$/, ''), ...it.meta] }))
      })
      out.push({
        name: 'Suggested templates',
        scope: 'templates',
        tiles: true,
        items: [4, 1, 6, 9].map((i) => templates.value[i]).filter((it): it is Item => !!it)
      })
      out.push({ name: 'Quick actions', items: actions.value })
    } else {
      const s = SCOPES.find((x) => x.id === scope.value)!
      out.push({ name: s.label, items: BY_SCOPE.value[scope.value as Exclude<Scope, 'all'>] })
    }
  } else if (scope.value === 'all') {
    const groups = [
      ...SCOPES.filter((s) => s.id !== 'all').map((s) => ({
        name: s.label,
        scope: s.id,
        items: hits(BY_SCOPE.value[s.id as Exclude<Scope, 'all'>])
      })),
      { name: 'Actions', scope: undefined, items: hits(actions.value) }
    ]
      .filter((g) => g.items.length)
      .sort((a, b) => (b.items[0]!.score ?? 0) - (a.items[0]!.score ?? 0))
    for (const g of groups)
      out.push({
        ...g,
        more: g.items.length > PER_GROUP ? g.items.length : undefined,
        items: g.items.slice(0, PER_GROUP)
      })
  } else {
    const s = SCOPES.find((x) => x.id === scope.value)!
    const items = hits(BY_SCOPE.value[scope.value as Exclude<Scope, 'all'>])
    if (items.length) out.push({ name: s.label, items })
  }
  if (q.value && out.length) out.push({ name: 'Docs', items: [docs.value] })

  let index = 0
  return out.map((s) => ({ ...s, items: s.items.map((it) => ({ ...it, index: index++ })) }))
})
const flat = computed(() => sections.value.flatMap((s) => s.items))
const current = computed(() => flat.value[active.value])
const none = computed(() => !!q.value && !flat.value.length)

// --- Scopes ---------------------------------------------------------------

function setScope(s: Scope): void {
  scope.value = s
  active.value = 0
  input.value?.focus()
}
/** `w␣` scopes to Workflows (the letters are the scope's prefix). */
watch(query, (v) => {
  const prefix = v.match(/^([a-z]{1,2}) $/i)?.[1]?.toLowerCase()
  const s = prefix && scope.value === 'all' && SCOPES.find((x) => x.prefix === prefix)
  if (s) {
    scope.value = s.id
    query.value = ''
  }
  active.value = 0
})

function onTab(back: boolean): void {
  // A word that starts a scope's name: Tab completes it ("work⇥").
  const typed = q.value.toLowerCase()
  const named =
    typed && SCOPES.find((s) => s.id !== 'all' && s.label.toLowerCase().startsWith(typed))
  if (named && scope.value === 'all') {
    query.value = ''
    setScope(named.id)
    return
  }
  const i = SCOPES.findIndex((s) => s.id === scope.value)
  setScope(SCOPES[(i + (back ? -1 : 1) + SCOPES.length) % SCOPES.length]!.id)
}

// --- Keyboard and pointer -------------------------------------------------

function close(): void {
  search.open = false
}
function choose(it: Item | undefined, inCloud = false): void {
  if (!it) {
    if (none.value) docs.value.open()
    close()
    return
  }
  close()
  if (inCloud && it.cloud) it.cloud()
  else it.open()
}
function move(by: number): void {
  const n = flat.value.length
  if (!n) return
  active.value = (active.value + by + n) % n
  pointerMoved = false
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
  if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    choose(current.value, mod)
  } else if (e.key === 'Tab') {
    e.preventDefault()
    onTab(e.shiftKey)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'Backspace' && !query.value && scope.value !== 'all') {
    e.preventDefault()
    setScope('all')
  } else if (mod && e.key !== 'k') {
    const key = SHORTCUTS[e.shiftKey ? e.key.toUpperCase() : e.key]
    const it = key && actions.value.find((a) => a.key === key)
    if (it) {
      e.preventDefault()
      choose(it)
    }
  }
}

/** The pointer only takes the highlight once it moves, so a list that
 *  scrolls under a still pointer doesn't steal it from the keyboard. */
let pointerMoved = false
function onPointer(i: number): void {
  if (!pointerMoved) {
    pointerMoved = true
    return
  }
  active.value = i
}

// --- The raised highlight -------------------------------------------------

const hl = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const hlReady = ref(false)
function place(scroll: boolean): void {
  const el = list.value?.querySelector<HTMLElement>(`[data-i="${active.value}"]`)
  if (!el) {
    hl.value = null
    return
  }
  hl.value = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }
  if (scroll) el.scrollIntoView({ block: 'nearest' })
}
watch(active, () => nextTick(() => place(true)))
watch(sections, () => {
  hlReady.value = false
  nextTick(() => {
    place(false)
    list.value?.scrollTo({ top: 0 })
    requestAnimationFrame(() => (hlReady.value = true))
  })
})

// --- Open and close -------------------------------------------------------

watch(
  () => search.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (!open) return
    query.value = ''
    scope.value = 'all'
    active.value = 0
    pointerMoved = false
    hlReady.value = false
    nextTick(() => {
      input.value?.focus()
      place(false)
      requestAnimationFrame(() => (hlReady.value = true))
    })
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

const scopeLabel = computed(() => SCOPES.find((s) => s.id === scope.value)!.label)
const placeholder = computed(() =>
  scope.value === 'all' ? 'Search or jump to…' : `Search ${scopeLabel.value.toLowerCase()}…`
)
const optionId = (i: number): string => `mar-search-opt-${i}`
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
            <Search :size="18" class="mar-search-glass" />
            <span v-if="scope !== 'all'" class="mar-search-token">
              {{ scopeLabel }}
              <button
                type="button"
                tabindex="-1"
                :aria-label="`Search everything, not only ${scopeLabel}`"
                @click="setScope('all')"
              >
                <X :size="12" />
              </button>
            </span>
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
            <kbd class="mar-search-esc">esc</kbd>
          </div>

          <div class="mar-search-scopes" role="tablist" aria-label="Search in">
            <button
              v-for="s in SCOPES"
              :key="s.id"
              type="button"
              role="tab"
              tabindex="-1"
              :aria-selected="scope === s.id"
              class="mar-search-scope"
              :class="[scope === s.id && 'is-on', counts[s.id] === 0 && 'is-zero']"
              @click="setScope(s.id)"
            >
              {{ s.label
              }}<span v-if="counts[s.id] !== undefined" class="mar-search-count">{{
                counts[s.id]
              }}</span>
            </button>
          </div>

          <div
            id="mar-search-list"
            ref="list"
            class="mar-search-list"
            role="listbox"
            aria-label="Results"
          >
            <span
              v-if="hl"
              class="mar-search-hl"
              :class="hlReady && 'is-moving'"
              :style="{
                transform: `translate(${hl.x}px, ${hl.y}px)`,
                width: `${hl.w}px`,
                height: `${hl.h}px`
              }"
              aria-hidden="true"
            />

            <section v-for="g in sections" :key="g.name" class="mar-search-group">
              <div class="mar-search-head">
                <span>{{ g.name }}</span>
                <button
                  v-if="g.scope && (g.more || g.tiles)"
                  type="button"
                  tabindex="-1"
                  @click="setScope(g.scope)"
                >
                  {{ g.more ? `All ${g.more}` : 'See all' }}<kbd>⇥</kbd>
                </button>
              </div>

              <div v-if="g.tiles" class="mar-search-tiles">
                <div
                  v-for="it in g.items"
                  :id="optionId(it.index)"
                  :key="it.key"
                  role="option"
                  :aria-selected="active === it.index"
                  :data-i="it.index"
                  class="mar-search-tile"
                  :class="active === it.index && 'is-on'"
                  @pointermove="onPointer(it.index)"
                  @click="choose(it)"
                >
                  <img :src="it.image" alt="" />
                  <span class="mar-search-tile-t">{{ it.label }}</span>
                  <span class="mar-search-tile-m">{{ it.meta[2] }}</span>
                </div>
              </div>

              <template v-else>
                <div
                  v-for="it in g.items"
                  :id="optionId(it.index)"
                  :key="it.key"
                  role="option"
                  :aria-selected="active === it.index"
                  :data-i="it.index"
                  class="mar-search-row"
                  :class="active === it.index && 'is-on'"
                  @pointermove="onPointer(it.index)"
                  @click="choose(it)"
                >
                  <span class="mar-search-lead">
                    <img v-if="it.image" :src="it.image" alt="" />
                    <span
                      v-else-if="it.tile"
                      class="mar-search-mark"
                      :style="{ background: it.tile.bg, color: it.tile.fg }"
                      >{{ it.tile.mark }}</span
                    >
                    <component :is="it.icon" v-else :size="16" />
                    <span v-if="it.image || it.tile" class="mar-search-kind"
                      ><component :is="it.icon" :size="10"
                    /></span>
                  </span>
                  <span class="mar-search-text">
                    <span class="mar-search-label"
                      ><template v-for="(s, k) in segments(it.label, it.at ?? [])" :key="k"
                        ><mark v-if="s.hit">{{ s.text }}</mark
                        ><template v-else>{{ s.text }}</template></template
                      ></span
                    >
                    <span class="mar-search-meta">{{ it.meta.join(' · ') }}</span>
                  </span>
                  <span v-if="active === it.index" class="mar-search-do">
                    <span v-if="it.cloud" class="mar-search-hint">
                      Open in Cloud<kbd>⌘</kbd><kbd>↵</kbd>
                    </span>
                    <span class="mar-search-hint is-main">
                      {{ it.group === 'Actions' ? 'Run' : it.group === 'Docs' ? 'Search' : 'Open'
                      }}<kbd><CornerDownLeft :size="11" /></kbd>
                    </span>
                  </span>
                  <span v-else-if="it.shortcut" class="mar-search-keys">
                    <kbd v-for="k in it.shortcut" :key="k">{{ k }}</kbd>
                  </span>
                </div>
              </template>
            </section>

            <div v-if="none" class="mar-search-none">
              <MarEmpty
                compact
                :icon="Search"
                :title="`Nothing called “${q}”`"
                :text="
                  scope === 'all'
                    ? 'Check the spelling, or look for it in the docs.'
                    : `No ${scopeLabel.toLowerCase()} match. It may be somewhere else.`
                "
                action="Search the docs"
                :second="scope === 'all' ? undefined : 'Search everything'"
                @action="choose(undefined)"
                @second="setScope('all')"
              />
            </div>
          </div>

          <footer class="mar-search-foot">
            <span v-if="scope === 'all' && !q" class="mar-search-tip">
              Type <kbd>w</kbd><kbd>␣</kbd> for workflows, <kbd>⇥</kbd> to switch scope
            </span>
            <span v-else-if="scope !== 'all'" class="mar-search-tip">
              <kbd>⌫</kbd> to search everything
            </span>
            <span v-else class="mar-search-tip"><kbd>⇥</kbd> to switch scope</span>
            <span class="flex-1" />
            <template v-if="flat.length">
              <span><kbd>↑</kbd><kbd>↓</kbd>Move</span>
            </template>
            <span><kbd>⌘</kbd><kbd>K</kbd>Close</span>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
