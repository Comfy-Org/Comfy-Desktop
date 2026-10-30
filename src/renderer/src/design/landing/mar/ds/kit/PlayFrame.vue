<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { TooltipProvider } from 'reka-ui'
import { Bell, Pencil, Trash2 } from 'lucide-vue-next'
import portraitGarden from '../../assets/portrait-garden.jpg'
import { thumb } from '../../../mock'
import Button from '../../../ui/Button.vue'
import Tooltip from '../../../ui/Tooltip.vue'
import LaunchBanner from '../../LaunchBanner.vue'
import { ComfyWorkflow } from '../../icons/comfyIcons'
import MarEmpty from '../../pages/MarEmpty.vue'
import { EMPTY_PICS } from '../../pages/emptyArt'
import MarItem from '../../pages/MarItem.vue'
import MarSearchField from '../../pages/MarSearchField.vue'
import MarSeg from '../../pages/MarSeg.vue'
import MarStatus, { type ItemStatus } from '../../pages/MarStatus.vue'
import type { MenuLine } from '../../pages/menu'
import { SPECS, filled, type Value } from '../play'

/**
 * The Playground's preview (pages/PlaygroundPage.vue): one component,
 * live, on the page or on a picture. Theme, corners and look come in the
 * URL (they're set before the app boots); props come as messages.
 */
const url = new URLSearchParams(location.search)
const id = ref(url.get('c') ?? 'button')
const values = ref<Record<string, Value>>(JSON.parse(url.get('p') ?? '{}'))
const bg = ref(url.get('bg') ?? 'page')

const spec = computed(() => SPECS.find((s) => s.id === id.value) ?? SPECS[0]!)
const v = computed(() => filled(spec.value, values.value))
const s = (k: string): string => String(v.value[k] ?? '')
const b = (k: string): boolean => Boolean(v.value[k])
// Empty means unset (an optional prop).
const status = computed(() => (s('status') || undefined) as ItemStatus | undefined)
const tone = computed(() => (s('tone') === 'error' ? 'error' : undefined))

function onMessage(e: MessageEvent): void {
  if (e.data?.type !== 'mar-ds:play') return
  id.value = e.data.c
  values.value = e.data.p
  bg.value = e.data.bg
}
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))

// What a control stands for, made into the prop.
const LINES: MenuLine[] = [
  { label: 'Rename', icon: Pencil },
  'sep',
  { label: 'Delete', icon: Trash2, danger: true }
]
const tabs = computed(() =>
  s('tabs')
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label) => ({ value: label.toLowerCase().replace(/\W+/g, '-'), label }))
)
const tab = ref('')
const picked = computed({
  get: () =>
    tabs.value.some((t) => t.value === tab.value) ? tab.value : (tabs.value[0]?.value ?? ''),
  set: (x: string) => (tab.value = x)
})
const query = ref('')
const renamed = ref('')
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div
      :class="['proto-ui ds-play-stage', bg === 'page' && 'proto-main']"
      :style="bg === 'image' ? { backgroundImage: `url(${portraitGarden})` } : undefined"
    >
      <div :class="['ds-play-fit', `is-${spec.id}`, s('layout') === 'list' && 'is-list']">
        <Button
          v-if="spec.id === 'button'"
          :variant="s('variant') as 'primary'"
          :size="s('size') as 'md'"
          :disabled="b('disabled')"
          >{{ s('label') }}</Button
        >
        <MarStatus
          v-else-if="spec.id === 'status'"
          :status="s('status') as ItemStatus"
          :label="s('label') || undefined"
          :on-media="b('on-media')"
        />
        <MarItem
          v-else-if="spec.id === 'item'"
          :name="renamed || s('name')"
          :meta="s('meta')"
          :layout="s('layout') as 'grid'"
          :status="status"
          :thumb="b('picture') ? thumb('image_flux2') : undefined"
          :icon="ComfyWorkflow"
          :selecting="b('selecting')"
          :selected="b('selected')"
          :renaming="b('renaming')"
          :fav="false"
          :lines="LINES"
          @rename="renamed = $event"
        />
        <MarEmpty
          v-else-if="spec.id === 'empty'"
          :icon="ComfyWorkflow"
          :title="s('title')"
          :text="s('text')"
          :action="s('action') || undefined"
          :second="s('second') || undefined"
          :pics="b('pictures') ? EMPTY_PICS.workflows : []"
          :compact="b('compact')"
          :tone="tone"
        />
        <MarSeg
          v-else-if="spec.id === 'tabs'"
          v-model="picked"
          :options="tabs"
          :label="s('label')"
        />
        <MarSearchField
          v-else-if="spec.id === 'search-field'"
          v-model="query"
          :placeholder="s('placeholder')"
        />
        <Tooltip
          v-else-if="spec.id === 'tooltip'"
          :content="s('content')"
          :side="s('side') as 'bottom'"
        >
          <Button variant="ghost" size="icon-sm" :aria-label="s('content')"
            ><Bell :size="15"
          /></Button>
        </Tooltip>
        <LaunchBanner v-else-if="spec.id === 'banner'" />
      </div>
    </div>
  </TooltipProvider>
</template>

<style>
html.ds-play-frame,
html.ds-play-frame body,
html.ds-play-frame #app {
  height: 100%;
  background: transparent;
}
.proto-ui.ds-play-stage {
  display: flex;
  height: 100%;
  margin: 0;
  overflow: auto;
  align-items: center;
  justify-content: center;
  padding: 32px;
  border-radius: 0;
  background-position: center;
  background-size: cover;
}
.ds-play-fit {
  display: flex;
  max-width: 100%;
  justify-content: center;
}
.ds-play-fit.is-item {
  width: 260px;
}
.ds-play-fit.is-item.is-list {
  width: 520px;
}
.ds-play-fit:is(.is-empty, .is-banner) {
  width: 100%;
}
</style>
