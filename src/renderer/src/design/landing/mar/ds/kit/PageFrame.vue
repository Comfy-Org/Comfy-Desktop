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
const total = ref(0)
const showAll = ref(false)
provideMode({ mode, hero: content.hero ?? [0, 0], sections: 0, total, showAll })

const root = ref<HTMLElement>()
onMounted(() => {
  const post = (): void =>
    parent.postMessage({ type: 'mar-ds:height', h: Math.ceil(root.value!.offsetHeight) }, '*')
  new ResizeObserver(post).observe(root.value!)
})
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div ref="root" :class="['proto-ui ds-frame-page', `is-${mode}`]">
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
