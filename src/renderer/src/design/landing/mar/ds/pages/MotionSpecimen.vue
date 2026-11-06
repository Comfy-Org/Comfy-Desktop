<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Bell } from 'lucide-vue-next'
import portraitSun from '../../assets/portrait-sun.jpg'
import Button from '../../../ui/Button.vue'
import Tooltip from '../../../ui/Tooltip.vue'
import VariantModes from '../../../variants/VariantModes.vue'
import LaunchBanner from '../../LaunchBanner.vue'
import { ComfyWorkflow } from '../../icons/comfyIcons'
import MarItem from '../../pages/MarItem.vue'
import MarSeg from '../../pages/MarSeg.vue'
import MarStatus from '../../pages/MarStatus.vue'
import MarUndoToast from '../../pages/MarUndoToast.vue'
import { notify } from '../../pages/undo'
import { onPlayback, previewReduced, readPlayback } from '../kit/playback'
import { playPageIn, type PageTransition } from '../../motion/pageIn'
// Their stylesheets, as the app loads them with the component.
import '../../search/search.css'
import '../../templateModal/templateModal.css'
import '../../pages/MarAssetsPage.vue'
import '../../graph/MarGraph.vue'
import '../../graph/CanvasNode.vue'

/**
 * One animation from the app, played with its real classes. Enter
 * animations replay by mounting again; transitions and hovers flip on a
 * loop, slower when the page's speed is lower.
 */
const { id } = defineProps<{ id: string }>()

const run = ref(0)
const on = ref(true)
const speed = ref(readPlayback().speed)
let timer: ReturnType<typeof setTimeout> | undefined
let stopListening: (() => void) | undefined

// Flips `on` forever for transitions; replays enter animations on demand.
const LOOPED = [
  'tab-pill',
  'sidebar',
  'prompt',
  'card-hover',
  'press',
  'progress',
  'palette',
  'graph',
  'page'
]
// Toasts leave on their own: they come back once they're gone.
const AGAIN = ['toast', 'undo']
const step = ref(0)
function loop(): void {
  clearTimeout(timer)
  const again = AGAIN.includes(id)
  timer = setTimeout(
    () => {
      if (again) replay()
      else {
        on.value = !on.value
        step.value++
      }
      loop()
    },
    (again ? 7000 : 1600) / speed.value
  )
}

const root = ref<HTMLElement>()
function replay(): void {
  run.value++
  on.value = true
  if (id === 'toast') notify('Saved to Assets')
  if (id === 'undo') notify('Moved 1 workflow to Hero shots', () => {})
  if (id === 'tooltip') {
    const t = root.value?.querySelector<HTMLElement>('button')
    t?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerType: 'mouse' }))
    setTimeout(
      () =>
        t?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' })),
      120
    )
  }
}
defineExpose({ replay })

onMounted(() => {
  if (LOOPED.includes(id) || AGAIN.includes(id)) loop()
  setTimeout(replay, 500)
  let seen = readPlayback().replay
  stopListening = onPlayback((p) => {
    if (p.speed !== speed.value) speed.value = p.speed
    if (p.replay !== seen) {
      seen = p.replay
      replay()
    }
  })
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  stopListening?.()
})

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'shared', label: 'Shared with me' }
]
const tab = computed(() => TABS[step.value % 3]!.value)
const PROGRESS = [8, 35, 62, 100]
const progress = computed(() => PROGRESS[step.value % 4])
const force = (state: string): Record<string, string> =>
  on.value ? { 'data-ds-force': state } : {}

// Page transition: the three options side by side, each page swapping
// for the next on the loop while the sidebar beside it stays still.
const PAGE_KINDS: { kind: PageTransition; label: string }[] = [
  { kind: 'fade', label: 'Fade' },
  { kind: 'rise', label: 'Fade and rise' },
  { kind: 'stagger', label: 'Stagger' }
]
if (id === 'page')
  watch([step, run], async () => {
    await nextTick()
    for (const { kind } of PAGE_KINDS) {
      const page = root.value?.querySelector<HTMLElement>(`[data-page-kind='${kind}']`)
      if (!page) continue
      for (const a of playPageIn([page], kind, previewReduced())) a.playbackRate = speed.value
    }
  })

// The Classic sidebar's style is scoped to VariantModes.vue.
const sideScope = { [(VariantModes as { __scopeId?: string }).__scopeId ?? 'data-x']: '' }
</script>

<template>
  <div ref="root" class="ds-mo">
    <MarSeg v-if="id === 'tab-pill'" :model-value="tab" :options="TABS" label="Scope" />

    <div v-else-if="id === 'menu'" class="ds-mo-anchor">
      <div :key="run" role="menu" data-state="open" class="ds-mo-menu">
        <div role="menuitem" class="ds-mo-row">Open in Cloud</div>
        <div role="menuitem" class="ds-mo-row">Duplicate</div>
        <div role="menuitem" class="ds-mo-row">Move to project</div>
      </div>
    </div>

    <Tooltip v-else-if="id === 'tooltip'" content="Notifications" side="bottom">
      <Button variant="ghost" size="icon-sm" aria-label="Notifications"><Bell :size="15" /></Button>
    </Tooltip>

    <div v-else-if="id === 'toast' || id === 'undo'" class="ds-mo-box proto-ui">
      <MarUndoToast />
    </div>

    <div v-else-if="id === 'modal'" class="ds-mo-box">
      <template v-if="on">
        <div
          :key="`s${run}`"
          class="mar-tpl-scrim"
          data-state="open"
          :style="{ position: 'absolute' }"
        />
        <div
          :key="`m${run}`"
          class="mar-tpl"
          data-state="open"
          :style="{
            position: 'absolute',
            display: 'block',
            width: '70%',
            height: '60%',
            padding: '16px'
          }"
        >
          <strong>Portrait relight</strong>
        </div>
      </template>
    </div>

    <div v-else-if="id === 'palette'" class="ds-mo-box">
      <Transition name="mar-search">
        <div
          v-if="on"
          class="mar-search-scrim"
          :style="{ position: 'absolute', paddingTop: '24px' }"
        >
          <div class="mar-search" :style="{ width: '80%', padding: '14px 16px' }">
            Search templates, workflows, spaces…
          </div>
        </div>
      </Transition>
    </div>

    <div v-else-if="id === 'sidebar'" class="ds-mo-box ds-mo-shell">
      <aside
        v-bind="sideScope"
        :class="[
          'sidebar-slide flex shrink-0 flex-col rounded-[10px] bg-secondary-background',
          on ? 'm-2 mr-0 w-59 p-2' : 'm-0 w-0 p-0 opacity-0'
        ]"
      >
        <span class="ds-mo-line" /><span class="ds-mo-line" /><span class="ds-mo-line" />
      </aside>
      <div class="ds-mo-content" />
    </div>

    <div v-else-if="id === 'prompt'" class="mar-prompt bg-card-background ds-mo-prompt">
      <textarea v-bind="force('focus')" placeholder="Describe what to make…" tabindex="-1" />
    </div>

    <div v-else-if="id === 'home-rise'" :key="run" class="mar-home ds-mo-home">
      <div>
        <section v-for="i in 4" :key="i" class="ds-mo-block" />
      </div>
    </div>

    <div v-else-if="id === 'page'" class="ds-mo-pages">
      <figure v-for="p in PAGE_KINDS" :key="p.kind">
        <div class="ds-mo-box ds-mo-shell">
          <aside class="ds-mo-pageside" />
          <div class="ds-mo-pagearea">
            <div :key="`${step}-${run}`" :data-page-kind="p.kind" class="ds-mo-page">
              <span class="ds-mo-title" :style="{ width: step % 2 ? '40%' : '58%' }" />
              <div>
                <span v-for="i in step % 2 ? 3 : 4" :key="i" class="ds-mo-block" />
              </div>
              <div>
                <span v-for="i in step % 2 ? 3 : 4" :key="i" class="ds-mo-block" />
              </div>
            </div>
          </div>
        </div>
        <figcaption>{{ p.label }}</figcaption>
      </figure>
    </div>

    <LaunchBanner v-else-if="id === 'banner'" :key="run" />

    <div v-else-if="id === 'card-hover'" class="ds-mo-card">
      <MarItem
        v-bind="force('hover')"
        name="Product shots"
        meta="Local · 2h ago"
        :thumb="portraitSun"
        :icon="ComfyWorkflow"
        status="executing"
        :fav="false"
        :lines="[]"
      />
    </div>

    <Button v-else-if="id === 'press'" v-bind="force('active')" variant="primary">Create</Button>

    <div
      v-else-if="id === 'progress'"
      class="ds-mo-cover"
      :style="{ backgroundImage: `url(${portraitSun})` }"
    >
      <span class="mar-asset-progress"><i :style="{ width: `${progress}%` }" /></span>
    </div>

    <div v-else-if="id === 'running'" class="ds-mo-row-flex">
      <MarStatus status="executing" />
      <MarStatus status="running" />
    </div>

    <div v-else-if="id === 'graph'" class="ds-mo-row-flex">
      <span class="mg-spin" />
      <div class="sg-node ds-mo-node">
        <img :src="portraitSun" alt="" :class="['sg-img', on && 'is-working']" />
      </div>
      <div class="sg-node ds-mo-node">
        <p class="sg-empty is-working">Waiting…</p>
      </div>
    </div>

    <p v-else-if="id === 'glow'" class="ds-mo-still">Still: nothing to play.</p>
  </div>
</template>

<style>
.ds-mo {
  display: flex;
  width: 100%;
  min-height: 120px;
  align-items: center;
  justify-content: center;
}
.ds-mo-anchor {
  width: 220px;
  height: 140px;
}
.ds-mo-menu {
  width: 220px;
  transform-origin: top left;
}
.ds-mo-row {
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 13px;
}
/* A box that holds what the app places `fixed` (the transform makes it
   the containing block). */
.ds-mo-box {
  position: relative;
  width: 100%;
  height: 200px;
  overflow: hidden;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 4%, transparent);
  transform: translateZ(0);
}
.ds-mo-shell {
  display: flex;
}
.ds-mo-line {
  height: 10px;
  margin: 6px 4px;
  border-radius: 4px;
  background: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
.ds-mo-content {
  flex: 1;
  margin: 8px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
.ds-mo-prompt {
  width: 100%;
  align-self: flex-start;
}
.ds-mo-prompt textarea {
  width: 100%;
  resize: none;
  background: transparent;
  outline: none;
}
.ds-mo-home {
  width: 100%;
}
.ds-mo-home > div {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.ds-mo-block {
  height: 60px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.ds-mo-card {
  width: 220px;
}
.ds-mo-pages {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.ds-mo-pages .ds-mo-box {
  height: 120px;
}
.ds-mo-pages figcaption {
  margin-top: 4px;
  color: var(--color-muted-foreground);
  font-size: 11px;
  text-align: center;
}
.ds-mo-pageside {
  width: 22%;
  margin: 6px 0 6px 6px;
  border-radius: 6px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
.ds-mo-pagearea {
  flex: 1;
  overflow: hidden;
  padding: 10px;
}
.ds-mo-page {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ds-mo-page > div {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.ds-mo-page .ds-mo-block {
  height: 22px;
  border-radius: 4px;
}
.ds-mo-title {
  height: 8px;
  border-radius: 3px;
  background: color-mix(in oklch, var(--color-base-foreground) 22%, transparent);
}
.ds-mo-cover {
  position: relative;
  width: 220px;
  height: 140px;
  overflow: hidden;
  border-radius: 12px;
  background-position: center;
  background-size: cover;
}
.ds-mo-row-flex {
  display: flex;
  align-items: center;
  gap: 16px;
}
.ds-mo-node {
  position: relative;
  width: 120px;
  height: 90px;
  overflow: hidden;
  border-radius: 10px;
}
.ds-mo-still {
  color: var(--color-muted-foreground);
  font-size: 12.5px;
}
</style>
