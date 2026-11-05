<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, Menu, X } from 'lucide-vue-next'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import Button from '../../ui/Button.vue'
import MarSearchField from '../pages/MarSearchField.vue'
import MarSeg from '../pages/MarSeg.vue'
import { CONTENT } from './content'
import { GROUPS, PAGES, type DsPage } from './registry'
import AboutPage from './pages/AboutPage.vue'
import CodeTab from './pages/CodeTab.vue'
import PlaygroundTab from './pages/PlaygroundTab.vue'
import type { FrameSection } from './kit/mode'
import ThemeFrames from './kit/ThemeFrames.vue'

/**
 * The page: a grouped nav with search, and the picked page in one template.
 * Components and patterns: one large example, when to use it, Do / Don't,
 * its rules, then States · Specs · Code. Foundations: a visual Overview,
 * then Details (and Code). Dark by default; light or both from the header.
 * Pages are addressed by hash (#/buttons?tab=specs).
 */
function readHash(): { id: string; tab: string } {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?')
  // The Playground was a page of its own: its links open the tab.
  if (path === 'playground') {
    const c = new URLSearchParams(query ?? '').get('c') ?? 'button'
    const to = Object.keys(CONTENT).find((k) => CONTENT[k]!.play === c) ?? 'buttons'
    history.replaceState(null, '', `#/${to}?tab=playground`)
    return { id: to, tab: 'playground' }
  }
  const id = PAGES.some((p) => p.id === path) ? path! : PAGES[0]!.id
  return { id, tab: new URLSearchParams(query ?? '').get('tab') ?? '' }
}
const current = ref(readHash().id)
const tab = ref(readHash().tab)
const navOpen = ref(false)
const onHash = (): void => {
  const h = readHash()
  current.value = h.id
  tab.value = h.tab
  navOpen.value = false
}

type Theme = 'dark' | 'light' | 'both'
const THEMES: { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'both', label: 'Both' }
]
const THEME_KEY = 'mar-ds.theme'
const urlView = new URLSearchParams(location.search).get('view')
const theme = ref<Theme>(
  THEMES.find(
    (t) => t.value === (urlView === 'both' ? 'both' : (urlView ?? localStorage.getItem(THEME_KEY)))
  )?.value ?? 'dark'
)
watch(theme, (t) => localStorage.setItem(THEME_KEY, t))
const themes = computed(() => (theme.value === 'both' ? ['dark', 'light'] : [theme.value]))
// The site's own chrome follows the theme (Both reads on dark): the same
// tokens as the app, from <html>.
watch(theme, (t) => (document.documentElement.dataset.dsTheme = t === 'light' ? 'light' : 'dark'), {
  immediate: true
})

const page = computed(() => PAGES.find((p) => p.id === current.value)!)
const content = computed(() => CONTENT[current.value] ?? {})
const kind = computed(() =>
  page.value.group === 'Foundations'
    ? 'foundation'
    : page.value.group === ''
      ? 'about'
      : 'component'
)

// Tabs: what the page has.
const tabs = computed(() => {
  if (kind.value === 'foundation')
    return [
      { value: 'overview', label: 'Overview' },
      { value: 'details', label: 'Details' },
      ...(page.value.code ? [{ value: 'code', label: 'Code' }] : [])
    ]
  const c = content.value
  return [
    { value: 'overview', label: 'Overview' },
    ...(c.play ? [{ value: 'playground', label: 'Playground' }] : []),
    { value: 'states', label: 'States' },
    ...(c.tokens?.length ? [{ value: 'specs', label: 'Specs' }] : []),
    ...(page.value.group === 'Components' || c.play || c.snippet
      ? [{ value: 'code', label: 'Code' }]
      : [])
  ]
})
const active = computed({
  get: () => (tabs.value.some((t) => t.value === tab.value) ? tab.value : tabs.value[0]!.value),
  set: (id: string) => {
    tab.value = id
    history.replaceState(
      null,
      '',
      `#/${current.value}${id === tabs.value[0]!.value ? '' : `?tab=${id}`}`
    )
  }
})

// The nav: Foundations in reading order; Components and Patterns A–Z, the
// library pages in a group of their own.
const LIBRARY = 'Library pages'
const isLibrary = (p: DsPage): boolean => p.id.startsWith('lib-')
const byLabel = (a: DsPage, b: DsPage): number => a.label.localeCompare(b.label)
const SECTIONS = GROUPS.flatMap((g) => {
  const inGroup = PAGES.filter((p) => p.group === g)
  if (g === 'Patterns')
    return [
      { group: g, pages: inGroup.filter((p) => !isLibrary(p)).sort(byLabel) },
      { group: LIBRARY, pages: inGroup.filter(isLibrary).sort(byLabel) }
    ]
  return [{ group: g, pages: g === 'Components' ? [...inGroup].sort(byLabel) : inGroup }]
})
const navLabel = (p: DsPage): string => p.label.replace(/^Library · /, '')
const sectionOf = (p: DsPage): string => (isLibrary(p) ? LIBRARY : p.group)

const query = ref('')
// A search finds a page by its name first, then by what it holds: its id,
// what it's for and its source files ("tab" finds Filters bar, which is
// built from MarSeg's tabs). Name matches come first in each group.
const words = (p: DsPage): string =>
  `${p.id} ${p.use ?? ''} ${(p.source ?? '').replace(/[^,]*\//g, '')}`.toLowerCase()
const nav = computed(() => {
  const q = query.value.trim().toLowerCase()
  const named = (p: DsPage): boolean => `${p.label} ${p.title}`.toLowerCase().includes(q)
  return SECTIONS.map((s) => ({
    group: s.group,
    pages: q
      ? [...s.pages.filter(named), ...s.pages.filter((p) => !named(p) && words(p).includes(q))]
      : s.pages
  })).filter((g) => g.pages.length)
})

// Pages whose hero is their only example (kit/PageFrame.vue says so):
// as patterns they need no tabs.
const single = ref<Record<string, boolean>>({})
function onMeta(e: MessageEvent): void {
  if (e.data?.type === 'mar-ds:meta')
    single.value = { ...single.value, [e.data.page]: e.data.single }
}
const bare = computed(
  () =>
    page.value.group === 'Patterns' &&
    single.value[page.value.id] &&
    tabs.value.every((t) => t.value === 'overview' || t.value === 'states')
)

// On this page: the overview's own blocks, or the sections the frame
// reports (kit/PageFrame.vue).
const main = ref<HTMLElement>()
const frameSections = ref<FrameSection[]>([])
const anchors = computed(() => {
  if (kind.value === 'component' && active.value === 'overview') {
    const c = content.value
    return [
      { title: 'Example', id: 'ds-example' },
      ...(c.when || c.whenNot ? [{ title: 'When to use', id: 'ds-when' }] : []),
      ...(c.pairs?.length ? [{ title: 'Do and don’t', id: 'ds-dodont' }] : []),
      ...(c.rules?.length ? [{ title: 'Rules', id: 'ds-rules' }] : [])
    ].map((a) => ({ title: a.title, go: () => scrollTo(document.getElementById(a.id), 0) }))
  }
  return frameSections.value.map((s) => ({ title: s.title, go: () => scrollTo(s.frame, s.top) }))
})
function scrollTo(el: HTMLElement | null, offset: number): void {
  if (!el || !main.value) return
  const top =
    el.getBoundingClientRect().top - main.value.getBoundingClientRect().top + main.value.scrollTop
  main.value.scrollTo({ top: top + offset - 24, behavior: 'smooth' })
}
watch([current, active], () => (frameSections.value = []))

watch(current, () => main.value?.scrollTo({ top: 0 }))
watch(navOpen, (open) => {
  if (open) void nextTick(() => document.querySelector<HTMLInputElement>('.ds-nav input')?.focus())
})
const onKey = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') navOpen.value = false
}
onMounted(() => {
  window.addEventListener('hashchange', onHash)
  window.addEventListener('message', onMeta)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHash)
  window.removeEventListener('message', onMeta)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="ds-app" :class="navOpen && 'is-nav-open'">
    <header class="ds-header proto-ui">
      <Button
        variant="ghost"
        size="icon-sm"
        class="ds-menu-btn"
        :aria-label="navOpen ? 'Close pages' : 'Open pages'"
        :aria-expanded="navOpen"
        @click="navOpen = !navOpen"
      >
        <component :is="navOpen ? X : Menu" :size="16" />
      </Button>
      <a href="#/about" class="ds-brand">
        <ComfyCLogo :size="18" />
        <span class="ds-brand-name">Comfy Desktop</span>
        <span class="ds-brand-sub">Design system</span>
      </a>
      <MarSeg
        v-if="active !== 'playground' && !page.custom"
        v-model="theme"
        class="ds-views"
        :options="THEMES"
        label="Theme"
      />
    </header>
    <div class="ds-body">
      <div class="ds-scrim" aria-hidden="true" @click="navOpen = false" />
      <nav class="ds-nav proto-ui" aria-label="Pages">
        <div class="ds-nav-search">
          <MarSearchField v-model="query" placeholder="Search pages" />
        </div>
        <div class="ds-nav-list">
          <section v-for="g in nav" :key="g.group" class="ds-nav-sec">
            <p v-if="g.group" class="ds-nav-group">{{ g.group }}</p>
            <a
              v-for="p in g.pages"
              :key="p.id"
              :href="`#/${p.id}`"
              class="ds-nav-item"
              :aria-current="p.id === current ? 'page' : undefined"
              >{{ navLabel(p) }}</a
            >
          </section>
          <p v-if="!nav.length" class="ds-nav-none">No page matches “{{ query.trim() }}”.</p>
        </div>
      </nav>

      <main ref="main" class="ds-main" :data-page="page.id">
        <AboutPage v-if="kind === 'about'" />
        <template v-else>
          <header class="ds-page-head proto-ui">
            <p class="ds-eyebrow">{{ sectionOf(page) }}</p>
            <h1>{{ page.title }}</h1>
            <p v-if="page.use" class="ds-lede">{{ page.use }}</p>
            <p v-if="page.source" class="ds-page-src">
              <code>{{ page.source.split(',')[0] }}</code>
            </p>
            <div v-if="!bare && !page.custom" class="ds-page-tabs">
              <MarSeg v-model="active" :options="tabs" label="Page sections" />
            </div>
            <nav v-if="anchors.length > 1" class="ds-anchors" aria-label="On this page">
              <span>On this page</span>
              <button v-for="a in anchors" :key="a.title" type="button" @click="a.go()">
                {{ a.title }}
              </button>
            </nav>
          </header>

          <!-- Components and patterns: tabs, Overview first (the example and
               the decisions). Foundations: Overview, Details, Code. -->
          <!-- A page drawn by itself (the Theme playground): both themes,
               its own sections. -->
          <component :is="page.custom" v-if="page.custom" />
          <template v-else-if="kind === 'foundation'">
            <template v-if="active === 'overview'">
              <component :is="page.bar" v-if="page.bar" />
              <ThemeFrames
                :page="page.id"
                mode="overview"
                :themes
                @sections="frameSections = $event"
              />
            </template>
            <template v-else-if="active === 'details'">
              <component :is="page.bar" v-if="page.bar" />
              <ThemeFrames
                :page="page.id"
                mode="details"
                :themes
                @sections="frameSections = $event"
              />
              <div v-if="page.doc" class="ds-block"><component :is="page.doc" /></div>
            </template>
            <component :is="page.code" v-else />
          </template>

          <template v-else-if="active === 'overview'">
            <div id="ds-example" class="ds-hero">
              <ThemeFrames :page="page.id" mode="hero" :themes />
            </div>
            <div v-if="content.when || content.whenNot" id="ds-when" class="ds-when">
              <section v-if="content.when" class="is-yes">
                <h2><Check :size="15" />When to use</h2>
                <ul>
                  <li v-for="w in content.when" :key="w">{{ w }}</li>
                </ul>
              </section>
              <section v-if="content.whenNot" class="is-no">
                <h2><X :size="15" />When not to</h2>
                <ul>
                  <li v-for="w in content.whenNot" :key="w">{{ w }}</li>
                </ul>
              </section>
            </div>
            <div v-if="content.pairs?.length" id="ds-dodont" class="ds-block">
              <h2 class="ds-h2">Do and don’t</h2>
              <ThemeFrames :page="page.id" mode="dodont" :themes="themes.slice(0, 1)" />
            </div>
            <div v-if="content.rules?.length" id="ds-rules" class="ds-read ds-rules">
              <h2 class="ds-h2">Rules</h2>
              <ol>
                <li v-for="r in content.rules" :key="r">{{ r }}</li>
              </ol>
            </div>
          </template>
          <PlaygroundTab
            v-else-if="active === 'playground' && content.play"
            :key="page.id"
            :page="page.id"
            :spec="content.play"
          />
          <ThemeFrames
            v-else-if="active === 'states'"
            :page="page.id"
            mode="states"
            :themes
            @sections="frameSections = $event"
          />
          <ThemeFrames v-else-if="active === 'specs'" :page="page.id" mode="specs" :themes />
          <CodeTab v-else :page="page.id" :source="page.source" />
        </template>
      </main>
    </div>
  </div>
</template>
