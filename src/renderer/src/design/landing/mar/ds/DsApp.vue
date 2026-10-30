<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PAGES } from './registry'
import AboutPage from './pages/AboutPage.vue'

/**
 * The page: nav on the left, the picked component on the right in dark
 * and light side by side (or one of them). Each theme is a frame of this
 * same entry (`?frame=page`), since Mar's themes live on <html>.
 * Pages are addressed by hash (#/sidebar).
 */
const current = ref(readHash())
function readHash(): string {
  // A page can keep its own state after `?` (the Playground).
  const id = location.hash.replace(/^#\/?/, '').split('?')[0] ?? ''
  return PAGES.some((p) => p.id === id) ? id : PAGES[0]!.id
}
const onHash = (): void => void (current.value = readHash())

const VIEWS = [
  { value: 'both', label: 'Dark + light' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' }
] as const
type View = (typeof VIEWS)[number]['value']
const VIEW_KEY = 'mar-ds.view'
const urlView = new URLSearchParams(location.search).get('view')
const view = ref<View>(
  (VIEWS.find((v) => v.value === (urlView ?? localStorage.getItem(VIEW_KEY)))?.value ??
    'both') as View
)
watch(view, (v) => localStorage.setItem(VIEW_KEY, v))
const themes = computed(() => (view.value === 'both' ? ['dark', 'light'] : [view.value]))

const page = computed(() => PAGES.find((p) => p.id === current.value)!)
const groups = computed(() => [...new Set(PAGES.map((p) => p.group))])
const main = ref<HTMLElement>()
watch(current, () => main.value?.scrollTo({ top: 0 }))

// Each theme frame reports its height; frames never scroll on their own.
const heights = ref<Record<string, number>>({})
const frames = ref<HTMLIFrameElement[]>([])
function onMessage(e: MessageEvent): void {
  if (e.data?.type !== 'mar-ds:height') return
  const f = frames.value.find((x) => x.contentWindow === e.source)
  if (f) heights.value = { ...heights.value, [f.dataset.theme!]: e.data.h }
}
onMounted(() => {
  window.addEventListener('hashchange', onHash)
  window.addEventListener('message', onMessage)
})
onBeforeUnmount(() => {
  window.removeEventListener('hashchange', onHash)
  window.removeEventListener('message', onMessage)
})
const src = (theme: string): string =>
  `?frame=page&page=${current.value}&theme=${theme}&proposal=mariana`
</script>

<template>
  <div class="ds-app">
    <header class="ds-header">
      <span class="font-semibold">Mar DS</span>
      <span class="text-subtle-foreground">{{ page.label }}</span>
      <div class="ds-views" role="radiogroup" aria-label="Theme">
        <button
          v-for="v in VIEWS"
          :key="v.value"
          type="button"
          role="radio"
          :aria-checked="view === v.value"
          @click="view = v.value"
        >
          {{ v.label }}
        </button>
      </div>
    </header>
    <div class="ds-body">
      <nav class="ds-nav" aria-label="Components">
        <template v-for="g in groups" :key="g">
          <p class="ds-nav-group">{{ g }}</p>
          <a
            v-for="p in PAGES.filter((x) => x.group === g)"
            :key="p.id"
            :href="`#/${p.id}`"
            class="ds-nav-item"
            :aria-current="p.id === current ? 'page' : undefined"
            >{{ p.label }}</a
          >
        </template>
      </nav>
      <main ref="main" class="ds-main" :data-page="page.id">
        <AboutPage v-if="!page.component && !page.custom" />
        <template v-else>
          <header class="ds-page-head">
            <h1>{{ page.title }}</h1>
            <p v-if="page.use">{{ page.use }}</p>
            <p v-if="page.source" class="ds-source">
              From <code>{{ page.source }}</code>
            </p>
          </header>
          <component :is="page.custom" v-if="page.custom" />
          <component :is="page.bar" v-if="page.bar" />
          <div v-if="!page.custom" :class="['ds-themes', themes.length > 1 && 'is-both']">
            <div v-for="t in themes" :key="`${current}-${t}`" class="ds-theme">
              <span class="ds-theme-label">{{ t === 'dark' ? 'Dark' : 'Light' }}</span>
              <iframe
                ref="frames"
                :data-theme="t"
                :src="src(t)"
                :title="`${page.title}, ${t}`"
                class="ds-theme-frame"
                :style="{ height: `${heights[t] ?? 600}px` }"
              />
            </div>
          </div>
          <component :is="page.doc" v-if="page.doc" />
        </template>
      </main>
    </div>
  </div>
</template>
