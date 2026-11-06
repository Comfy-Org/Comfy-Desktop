<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { TooltipProvider } from 'reka-ui'
import { CONTENT } from '../content'
import DoDont from '../pages/DoDont.vue'
import { PAGES } from '../registry'
import { KEY_SECTIONS, provideMode, type DsMode } from './mode'
import SpecsTable from './SpecsTable.vue'

/** One component page in one theme and one mode (kit/mode.ts), inside the
 *  page's frame. It tells the page its height so the frame never scrolls. */
const url = new URLSearchParams(location.search)
const id = url.get('page')
const mode = (url.get('mode') ?? 'states') as DsMode
const page = PAGES.find((p) => p.id === id)
const content = CONTENT[id ?? ''] ?? {}
// Patterns are whole pages and app frames: their example takes the column.
const heroWidth = content.heroWidth ?? (page?.group === 'Patterns' ? '100%' : undefined)
const total = ref(0)
const showAll = ref(false)
const ctx = {
  mode,
  hero: content.hero ?? ([0, 0] as [number, number]),
  sections: 0,
  total,
  showAll
}
provideMode(ctx)

const root = ref<HTMLElement>()
onMounted(() => {
  // Its height, and where its titled sections sit (the page's “On this
  // page” links), each time it changes size.
  const post = (): void => {
    parent.postMessage({ type: 'mar-ds:height', h: Math.ceil(root.value!.offsetHeight) }, '*')
    if (mode === 'hero' || mode === 'dodont' || mode === 'specs') return
    const top = root.value!.getBoundingClientRect().top
    const list = [...root.value!.querySelectorAll<HTMLElement>('.ds-section-title')].map((h) => ({
      title: h.textContent?.trim() ?? '',
      top: Math.round(h.getBoundingClientRect().top - top)
    }))
    parent.postMessage({ type: 'mar-ds:sections', list }, '*')
  }
  new ResizeObserver(post).observe(root.value!)
  // The hero tells the page whether it is the whole page (one example).
  if (mode === 'hero')
    setTimeout(
      () =>
        parent.postMessage(
          {
            type: 'mar-ds:meta',
            page: id,
            single: total.value <= 1 && (ctx as { heroCount?: number }).heroCount === 1
          },
          '*'
        ),
      600
    )
})
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div
      ref="root"
      :class="['proto-ui ds-frame-page', `is-${mode}`]"
      :style="heroWidth ? { '--ds-hero-w': heroWidth } : undefined"
    >
      <DoDont v-if="mode === 'dodont' && id" :page="id" />
      <template v-else>
        <component :is="page.component" v-if="page?.component" />
        <SpecsTable v-if="mode === 'specs'" :content />
        <button
          v-if="mode === 'states' && total > KEY_SECTIONS"
          type="button"
          class="ds-more ds-more-all"
          @click="showAll = !showAll"
        >
          {{ showAll ? 'Show key states' : `Show all states (${total} groups)` }}
        </button>
      </template>
    </div>
  </TooltipProvider>
</template>
