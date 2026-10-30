<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CONTENT } from './content'
import { GROUPS, PAGES } from './registry'
import AboutPage from './pages/AboutPage.vue'
import CodeTab from './pages/CodeTab.vue'
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
    : page.value.group === 'Playground'
      ? 'custom'
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
const nav = computed(() =>
  GROUPS.map((g) => ({
    group: g,
    pages: PAGES.filter(
      (p) =>
        p.group === g && `${p.label} ${p.title}`.toLowerCase().includes(query.value.toLowerCase())
    )
  })).filter((g) => g.pages.length)
)

// Pages whose hero is their only example (kit/PageFrame.vue says so):
// as patterns they need no tabs.
const single = ref<Record<string, boolean>>({})
function onMeta(e: MessageEvent): void {
  if (e.data?.type === 'mar-ds:meta')
    single.value = { ...single.value, [e.data.page]: e.data.single }
}
const bare = computed(
  () => page.value.group === 'Patterns' && single.value[page.value.id] && tabs.value.length === 1
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
        v-if="kind !== 'about' && kind !== 'custom'"
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

          <component :is="page.custom" v-if="kind === 'custom'" />

          <!-- Components and patterns: the example, then the decisions. -->
          <template v-else-if="kind === 'component'">
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

          <template v-if="(kind === 'component' && !bare) || kind === 'foundation'">
            <div class="ds-tabs" role="tablist">
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
            <template v-else>
              <ThemeFrames v-if="active === 'states'" :page="page.id" mode="states" :themes />
              <ThemeFrames v-else-if="active === 'specs'" :page="page.id" mode="specs" :themes />
              <CodeTab v-else :page="page.id" :source="page.source" />
            </template>
          </template>
        </template>
      </main>
    </div>
  </div>
</template>
