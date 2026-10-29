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
  /** One short muted word: when, what kind, or the state. */
  word?: string
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
  /** rows: a list; tiles: pictures in a row; chips: icon + label in a row. */
  layout: 'rows' | 'tiles' | 'chips'
  label?: boolean
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
const PER_GROUP = 3

const query = ref('')
const scope = ref<Scope>('all')
const input = ref<HTMLInputElement>()
const list = ref<HTMLElement>()
const active = ref(0)

// --- What can be found ----------------------------------------------------

const CATEGORY = { image: 'Image', video: 'Video', '3d': '3D', audio: 'Audio' } as const
/** "12 min ago" → "12m", "Yesterday" → "1d": a time in one short word. */
function ago(when: string): string | undefined {
  const w = when.toLowerCase()
  if (w === 'just now') return 'now'
  if (w === 'yesterday') return '1d'
  if (w === 'last week') return '1w'
  const m = w.match(/^(\d+) (min|hour|day|week)/)
  return m ? `${m[1]}${{ min: 'm', hour: 'h', day: 'd', week: 'w' }[m[2]!]}` : undefined
}
const cloud = (): ReturnType<typeof instanceById> => instances.value.find((i) => i.kind === 'cloud')

function inCloud(what: string, then: () => void): () => void {
  return () => {
    toast(`Opening ${what} in Comfy Cloud`)
    then()
  }
}

const templateItem = (t: Template): Item => ({
  key: `t:${t.id}`,
  group: 'Templates',
  label: t.title,
  word: CATEGORY[t.category],
  image: thumb(t.id),
  icon: t.kind === 'app' ? PanelsTopLeft : ComfyTemplate,
  open: () => openDetail('template', t.id),
  cloud: t.runs === 'local' ? undefined : inCloud(t.title, () => openDetail('template', t.id))
})
const templates = computed(() => TEMPLATES.map(templateItem))

const workflows = computed<Item[]>(() =>
  WORKFLOWS.map((w) => {
    const name = w.name.replace(/\.json$/, '')
    return {
      key: `w:${w.name}`,
      group: 'Workflows',
      label: name,
      word: ago(w.modified),
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
      return {
        key: `p:${p.id}`,
        group: 'Projects',
        label: p.name,
        word: ago(p.updated),
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
    word: STATUS[s.status],
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
    word: `${compact(a.runs)} runs`,
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
    word: TYPE[a.type],
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
    icon: FolderPlus,
    shortcut: ['⇧', '⌘', 'P'],
    open: () => go(`project:${newProject().id}` as Page)
  },
  {
    key: 'x:cloud',
    group: 'Actions',
    label: 'Comfy Cloud',
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
    label: 'Settings',
    icon: Settings2,
    shortcut: ['⌘', ','],
    open: () => go('settings' as Page)
  },
  {
    key: 'x:theme',
    group: 'Actions',
    label: look.theme === 'light' ? 'Dark theme' : 'Light theme',
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

const scopeLabel = computed(() => SCOPES.find((s) => s.id === scope.value)!.label)

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
  label: `Search docs for “${q.value}”`,
  icon: BookOpen,
  open: () => toast(`Searching the docs for “${q.value}”`)
}))

const QUICK = ['x:new-workflow', 'x:new-project', 'x:cloud', 'x:settings']
const sections = computed<Section[]>(() => {
  const out: (Omit<Section, 'items'> & { items: Item[] })[] = []
  const list = (s: Scope): Item[] => BY_SCOPE.value[s as Exclude<Scope, 'all'>]
  if (!q.value) {
    if (scope.value === 'all') {
      const w = workflows.value
      const p = projectItems.value
      out.push({
        name: 'Recent',
        layout: 'tiles',
        label: true,
        items: [w[0], p[3], w[1], w[2], p[0], w[3]].filter((it): it is Item => !!it)
      })
      out.push({
        name: 'Templates',
        layout: 'tiles',
        label: true,
        items: [4, 1, 6, 9, 2, 11].map((i) => templates.value[i]).filter((it): it is Item => !!it)
      })
      out.push({
        name: 'Actions',
        layout: 'chips',
        items: actions.value.filter((a) => QUICK.includes(a.key))
      })
    } else out.push({ name: scopeLabel.value, layout: 'rows', items: list(scope.value) })
  } else if (scope.value === 'all') {
    const groups = [
      ...SCOPES.filter((s) => s.id !== 'all').map((s) => ({
        name: s.label,
        items: hits(list(s.id))
      })),
      { name: 'Actions', items: hits(actions.value) }
    ]
      .filter((g) => g.items.length)
      .sort((a, b) => (b.items[0]!.score ?? 0) - (a.items[0]!.score ?? 0))
    for (const g of groups) out.push({ ...g, layout: 'rows', items: g.items.slice(0, PER_GROUP) })
  } else {
    const items = hits(list(scope.value))
    if (items.length) out.push({ name: scopeLabel.value, layout: 'rows', items })
  }
  if (q.value && out.length) out.push({ name: 'Docs', layout: 'rows', items: [docs.value] })

  let index = 0
  return out.map((s) => ({ ...s, items: s.items.map((it) => ({ ...it, index: index++ })) }))
})
/** The one muted word on a row: what kind it is when everything is
 *  mixed, otherwise its own word (when, state). */
const wordOf = (it: Item): string | undefined =>
  q.value && scope.value === 'all' && it.group !== 'Docs' ? it.group.replace(/s$/, '') : it.word
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
/** ↑↓ go row by row in a list and section by section across a row of
 *  pictures or chips; ←→ move along such a row. */
function move(by: 1 | -1): void {
  const n = flat.value.length
  if (!n) return
  const secs = sections.value
  const at = secs.findIndex((g) => g.items.some((it) => it.index === active.value))
  const sec = secs[at]
  const first = (g: Section): number => g.items[0]!.index
  const last = (g: Section): number => g.items[g.items.length - 1]!.index
  const entry = (g: Section, down: boolean): number =>
    g.layout === 'rows' && !down ? last(g) : first(g)
  let next: number
  if (!sec) next = 0
  else if (
    sec.layout !== 'rows' ||
    (by > 0 ? active.value === last(sec) : active.value === first(sec))
  ) {
    const g = secs[(at + by + secs.length) % secs.length]!
    next = entry(g, by > 0)
  } else next = active.value + by
  active.value = next
  pointerMoved = false
}
function along(by: 1 | -1): boolean {
  const sec = sections.value.find((g) => g.items.some((it) => it.index === active.value))
  if (!sec || sec.layout === 'rows') return false
  const i = sec.items.findIndex((it) => it.index === active.value) + by
  if (i >= 0 && i < sec.items.length) active.value = sec.items[i]!.index
  pointerMoved = false
  return true
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
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !query.value) {
    if (along(e.key === 'ArrowRight' ? 1 : -1)) e.preventDefault()
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

const placeholder = computed(() =>
  scope.value === 'all' ? 'Search or jump to…' : `Search ${scopeLabel.value.toLowerCase()}…`
)
const optionId = (i: number): string => `mar-search-opt-${i}`
const verb = computed(() =>
  current.value?.group === 'Actions' ? 'Run' : current.value?.group === 'Docs' ? 'Search' : 'Open'
)
const hlTile = computed(
  () =>
    sections.value.find((g) => g.items.some((it) => it.index === active.value))?.layout === 'tiles'
)
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
              {{ s.label }}
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
              :class="[hlReady && 'is-moving', hlTile && 'is-tile']"
              :style="{
                transform: `translate(${hl.x}px, ${hl.y}px)`,
                width: `${hl.w}px`,
                height: `${hl.h}px`
              }"
              aria-hidden="true"
            />

            <section
              v-for="g in sections"
              :key="g.name"
              class="mar-search-group"
              :class="`is-${g.layout}`"
            >
              <div v-if="g.label" class="mar-search-head">{{ g.name }}</div>

              <div v-if="g.layout === 'tiles'" class="mar-search-tiles">
                <div
                  v-for="it in g.items"
                  :id="optionId(it.index)"
                  :key="it.key"
                  role="option"
                  :aria-selected="active === it.index"
                  :aria-label="it.label"
                  :data-i="it.index"
                  class="mar-search-tile"
                  :class="active === it.index && 'is-on'"
                  @pointermove="onPointer(it.index)"
                  @click="choose(it)"
                >
                  <img :src="it.image" alt="" />
                  <span class="mar-search-tile-t">{{ it.label }}</span>
                </div>
              </div>

              <div v-else-if="g.layout === 'chips'" class="mar-search-chips">
                <div
                  v-for="it in g.items"
                  :id="optionId(it.index)"
                  :key="it.key"
                  role="option"
                  :aria-selected="active === it.index"
                  :data-i="it.index"
                  class="mar-search-chip"
                  :class="active === it.index && 'is-on'"
                  @pointermove="onPointer(it.index)"
                  @click="choose(it)"
                >
                  <component :is="it.icon" :size="16" />
                  <span class="truncate">{{ it.label }}</span>
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
                  <span class="mar-search-lead" :class="!it.image && !it.tile && 'is-icon'">
                    <img v-if="it.image" :src="it.image" alt="" />
                    <span
                      v-else-if="it.tile"
                      class="mar-search-mark"
                      :style="{ background: it.tile.bg, color: it.tile.fg }"
                      >{{ it.tile.mark }}</span
                    >
                    <component :is="it.icon" v-else :size="16" />
                  </span>
                  <span class="mar-search-label"
                    ><template v-for="(s, k) in segments(it.label, it.at ?? [])" :key="k"
                      ><mark v-if="s.hit">{{ s.text }}</mark
                      ><template v-else>{{ s.text }}</template></template
                    ></span
                  >
                  <span v-if="wordOf(it)" class="mar-search-word">{{ wordOf(it) }}</span>
                  <span class="flex-1" />
                  <span v-if="active === it.index" class="mar-search-do">
                    <span v-if="it.cloud" class="mar-search-hint" title="Open in Comfy Cloud"
                      ><Cloud :size="13" /><kbd>⌘</kbd><kbd>↵</kbd></span
                    >
                    <kbd class="is-main"><CornerDownLeft :size="11" /></kbd>
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
                    ? 'Try another word, or the docs.'
                    : `No ${scopeLabel.toLowerCase()} match.`
                "
                action="Search docs"
                :second="scope === 'all' ? undefined : 'Search everything'"
                @action="choose(undefined)"
                @second="setScope('all')"
              />
            </div>
          </div>

          <footer class="mar-search-foot">
            <span v-if="current"
              ><kbd><CornerDownLeft :size="11" /></kbd>{{ verb }}</span
            >
            <span><kbd>esc</kbd>Close</span>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
