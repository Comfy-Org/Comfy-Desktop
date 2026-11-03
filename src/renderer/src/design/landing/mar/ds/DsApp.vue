<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CONTENT } from './content'
import { GROUPS, PAGES, type DsPage } from './registry'
import AboutPage from './pages/AboutPage.vue'
import CodeTab from './pages/CodeTab.vue'
import PlaygroundTab from './pages/PlaygroundTab.vue'
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
const onHash = (): void => {
  const h = readHash()
  current.value = h.id
  tab.value = h.tab
}

const THEMES = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'both', label: 'Both' }
] as const
type Theme = (typeof THEMES)[number]['value']
const THEME_KEY = 'mar-ds.theme'
const urlView = new URLSearchParams(location.search).get('view')
const theme = ref<Theme>(
  (THEMES.find(
    (t) => t.value === (urlView === 'both' ? 'both' : (urlView ?? localStorage.getItem(THEME_KEY)))
  )?.value ?? 'dark') as Theme
)
watch(theme, (t) => localStorage.setItem(THEME_KEY, t))
const themes = computed(() => (theme.value === 'both' ? ['dark', 'light'] : [theme.value]))

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
      { id: 'overview', label: 'Overview' },
      { id: 'details', label: 'Details' },
      ...(page.value.code ? [{ id: 'code', label: 'Code' }] : [])
    ]
  const c = content.value
  return [
    { id: 'overview', label: 'Overview' },
    ...(c.play ? [{ id: 'playground', label: 'Playground' }] : []),
    { id: 'states', label: 'States' },
    ...(c.tokens?.length ? [{ id: 'specs', label: 'Specs' }] : []),
    ...(page.value.group === 'Components' || c.play || c.snippet
      ? [{ id: 'code', label: 'Code' }]
      : [])
  ]
})
const active = computed(() =>
  tabs.value.some((t) => t.id === tab.value) ? tab.value : tabs.value[0]!.id
)
function pick(id: string): void {
  tab.value = id
  history.replaceState(
    null,
    '',
    `#/${current.value}${id === tabs.value[0]!.id ? '' : `?tab=${id}`}`
  )
}

const query = ref('')
// A search finds a page by its name first, then by what it holds: its id,
// what it's for and its source files ("tab" finds Filters bar, which is
// built from MarSeg's tabs). Name matches come first in each group.
const words = (p: DsPage): string =>
  `${p.id} ${p.use ?? ''} ${(p.source ?? '').replace(/[^,]*\//g, '')}`.toLowerCase()
const nav = computed(() => {
  const q = query.value.trim().toLowerCase()
  const named = (p: DsPage): boolean => `${p.label} ${p.title}`.toLowerCase().includes(q)
  return GROUPS.map((g) => {
    const inGroup = PAGES.filter((p) => p.group === g)
    return {
      group: g,
      pages: q
        ? [...inGroup.filter(named), ...inGroup.filter((p) => !named(p) && words(p).includes(q))]
        : inGroup
    }
  }).filter((g) => g.pages.length)
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
    tabs.value.every((t) => t.id === 'overview' || t.id === 'states')
)

const main = ref<HTMLElement>()
watch(current, () => main.value?.scrollTo({ top: 0 }))
onMounted(() => {
  window.addEventListener('hashchange', onHash)
  window.addEventListener('message', onMeta)
})
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHash)
  window.removeEventListener('message', onMeta)
})
</script>

<template>
  <div class="ds-app">
    <header class="ds-header">
      <span class="font-semibold">Desktop DS</span>
      <span class="text-subtle-foreground">{{ page.label }}</span>
      <div
        v-if="kind !== 'about' && active !== 'playground'"
        class="ds-views"
        role="radiogroup"
        aria-label="Theme"
      >
        <button
          v-for="t in THEMES"
          :key="t.value"
          type="button"
          role="radio"
          :aria-checked="theme === t.value"
          @click="theme = t.value"
        >
          {{ t.label }}
        </button>
      </div>
    </header>
    <div class="ds-body">
      <nav class="ds-nav" aria-label="Pages">
        <input
          v-model="query"
          type="search"
          class="ds-nav-search"
          placeholder="Search"
          aria-label="Search pages"
        />
        <template v-for="g in nav" :key="g.group">
          <p v-if="g.group" class="ds-nav-group">{{ g.group }}</p>
          <a
            v-for="p in g.pages"
            :key="p.id"
            :href="`#/${p.id}`"
            class="ds-nav-item"
            :aria-current="p.id === current ? 'page' : undefined"
            >{{ p.label }}</a
          >
        </template>
        <p v-if="!nav.length" class="ds-nav-none">Nothing matches.</p>
      </nav>

      <main ref="main" class="ds-main" :data-page="page.id">
        <AboutPage v-if="kind === 'about'" />
        <template v-else>
          <header class="ds-page-head">
            <h1>{{ page.title }}</h1>
            <p v-if="page.use">{{ page.use }}</p>
          </header>

          <!-- Components and patterns: tabs, Overview first (the example and
               the decisions). Foundations: Overview, Details, Code. -->
          <div v-if="!bare" class="ds-tabs" role="tablist">
            <button
              v-for="t in tabs"
              :key="t.id"
              type="button"
              role="tab"
              :aria-selected="active === t.id"
              @click="pick(t.id)"
            >
              {{ t.label }}
            </button>
          </div>

          <template v-if="kind === 'foundation'">
            <template v-if="active === 'overview'">
              <component :is="page.bar" v-if="page.bar" />
              <ThemeFrames :page="page.id" mode="overview" :themes />
            </template>
            <template v-else-if="active === 'details'">
              <component :is="page.bar" v-if="page.bar" />
              <ThemeFrames :page="page.id" mode="details" :themes />
              <div v-if="page.doc" class="ds-block"><component :is="page.doc" /></div>
            </template>
            <component :is="page.code" v-else />
          </template>

          <template v-else-if="active === 'overview'">
            <div class="ds-hero">
              <ThemeFrames :page="page.id" mode="hero" :themes />
            </div>
            <div v-if="content.when || content.whenNot" class="ds-read ds-when">
              <div v-if="content.when">
                <h2>When to use</h2>
                <ul>
                  <li v-for="w in content.when" :key="w">{{ w }}</li>
                </ul>
              </div>
              <div v-if="content.whenNot">
                <h2>When not to</h2>
                <ul>
                  <li v-for="w in content.whenNot" :key="w">{{ w }}</li>
                </ul>
              </div>
            </div>
            <div v-if="content.pairs?.length" class="ds-block">
              <ThemeFrames :page="page.id" mode="dodont" :themes="themes.slice(0, 1)" />
            </div>
            <div v-if="content.rules?.length" class="ds-read ds-rules">
              <h2>Rules</h2>
              <ul>
                <li v-for="r in content.rules" :key="r">{{ r }}</li>
              </ul>
            </div>
          </template>
          <PlaygroundTab
            v-else-if="active === 'playground' && content.play"
            :key="page.id"
            :page="page.id"
            :spec="content.play"
          />
          <ThemeFrames v-else-if="active === 'states'" :page="page.id" mode="states" :themes />
          <ThemeFrames v-else-if="active === 'specs'" :page="page.id" mode="specs" :themes />
          <CodeTab v-else :page="page.id" :source="page.source" />
        </template>
      </main>
    </div>
  </div>
</template>
