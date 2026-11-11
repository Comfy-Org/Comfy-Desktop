<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { onClickOutside, useElementSize } from '@vueuse/core'
import {
  ArrowDownToLine,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronDown,
  Link2,
  MoreHorizontal,
  Plug,
  Star,
  TriangleAlert,
  X
} from 'lucide-vue-next'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import LocationIcon from '../../ui/LocationIcon.vue'
import { PORTAL_TO } from '../../ui/portal'
import { hostActions, instances, proto, toast } from '../../useProto'
import { isFavorite, toggleFavorite } from '../favorites'
import { ComfyModel } from '../icons/comfyIcons'
import {
  MACHINE,
  aboutFor,
  fmtGb,
  infoFor,
  mediaFor,
  needsFor,
  rankTargets,
  reasonFor,
  targetFor,
  tplById,
  totalGb,
  type Target
} from './templateData'
import { graphFor } from './graphSpec'
import TplGraph from './TplGraph.vue'
import ZoomControl from '../assets/ZoomControl.vue'
import MarSeg from '../pages/MarSeg.vue'
// The asset view's frame, panel, sections and buttons (.mad-*): the modal
// wears them, so the two read as one view. Imported for its styles.
import '../assets/AssetDetail.vue'
import './templateModal.css'

/**
 * Mar's template modal, in the asset view's format: the output (or its
 * graph) on the left, the details on a panel a step lighter on the right.
 * The panel says where it opens (the best build, why in one line, the
 * others behind one quiet picker) and what it needs. At the bottom, one
 * line and one action: what happens, or what's in the way and the way
 * through it; More beside it.
 * Templates only; saved workflows keep Pablo's DetailSheet.
 */
const template = computed(() =>
  proto.detail?.kind === 'template' ? tplById(proto.detail.id) : undefined
)
const open = computed({
  get: () => Boolean(template.value),
  set: (v) => {
    if (!v) proto.detail = null
  }
})

const media = computed(() => (template.value ? mediaFor(template.value) : undefined))
const info = computed(() => (template.value ? infoFor(template.value) : undefined))
const needs = computed(() => (template.value ? needsFor(template.value) : []))
const total = computed(() => (template.value ? totalGb(template.value) : 0))
const graph = computed(() =>
  template.value && media.value ? graphFor(template.value, media.value) : undefined
)

const targets = computed<Target[]>(() => {
  const t = template.value
  if (!t) return []
  return rankTargets(instances.value.map((i) => targetFor(t, i, proto.signedIn)))
})
const best = computed(() => targets.value.find((x) => !x.disabled && x.state !== 'login'))
const reason = computed(() =>
  best.value && template.value ? reasonFor(best.value, targets.value, template.value) : ''
)

const selectedId = ref<string>()
/** The picture's own shape, so it fits the stage like an asset does. */
const ratio = ref(16 / 9)
const natural = ref(0)
function measure(e: Event): void {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) ratio.value = img.naturalWidth / img.naturalHeight
  natural.value = img.naturalWidth
}
/** The fitted picture's width over the file's, so the zoom reads in real
 *  size as on an asset. */
const mediaEl = ref<HTMLElement>()
const { width: mediaW } = useElementSize(mediaEl)
const picFit = computed(() => (natural.value && mediaW.value ? mediaW.value / natural.value : 1))
/** What the section and the action show: the pick, or, when nothing can
 *  be picked (offline, Cloud only), the first build and why it can't. */
const shown = computed(() => selected.value ?? targets.value[0])
/** Why the default is the default, in one short line: the first sentence
 *  of the reason. Only while the default is the pick. */
const fit = computed(() =>
  reason.value &&
  shown.value?.inst.id === best.value?.inst.id &&
  shown.value?.state !== 'running' &&
  shown.value?.state !== 'ready'
    ? reason.value.split(/(?<=\.) /)[0]!
    : ''
)
/** The one line over the action: what happens, or what's in the way. */
const line = computed(() => {
  const s = shown.value
  if (!s) return ''
  if (s.state === 'blocked') return `${s.status}. Pick another build to open it.`
  // The plain cases need no line: the button says it.
  return s.state === 'running' || s.state === 'ready' ? '' : s.note
})
/** The cost's colour: a warning only for what may fail; a download stays
 *  quiet, even on a build short of memory. */
const tone = (x: Target): string =>
  x.state === 'memory' && x.cost !== 'May fail' ? 'download' : x.state
const buildMenu = ref(false)
const buildBox = ref<HTMLElement>()
onClickOutside(buildBox, () => (buildMenu.value = false))
function pickBuild(x: Target): void {
  if (x.disabled) return
  selectedId.value = x.inst.id
  buildMenu.value = false
}
const moreMenu = ref(false)
const moreBox = ref<HTMLElement>()
onClickOutside(moreBox, () => (moreMenu.value = false))
const favorited = computed(() =>
  template.value ? isFavorite(template.value.id, 'template') : false
)
const selected = computed(() => targets.value.find((x) => x.inst.id === selectedId.value))
const view = ref<'result' | 'graph'>('result')
const phase = ref<'idle' | 'busy'>('idle')
const progress = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

watch(
  () => proto.detail,
  () => {
    selectedId.value = (best.value ?? targets.value.find((x) => !x.disabled))?.inst.id
    view.value = 'result'
    moreMenu.value = false
    buildMenu.value = false
    ratio.value = 16 / 9
    stop()
  },
  { immediate: true }
)
onBeforeUnmount(stop)

function stop(): void {
  clearInterval(timer)
  phase.value = 'idle'
  progress.value = 0
}

/** Per model, what the chosen build means for it. */
const modelState = computed<'here' | 'get' | 'cloud' | undefined>(() => {
  const s = selected.value?.state
  if (s === 'running' || s === 'ready') return 'here'
  if (s === 'download') return 'get'
  if (s === 'cloud') return 'cloud'
  if (s === 'memory') return selected.value!.cost === 'May fail' ? 'here' : 'get'
  return undefined
})
const memoryOk = computed(() => {
  const v = info.value?.vramGb
  if (!v) return true
  return selected.value?.inst.kind === 'cloud' || v <= MACHINE.memGb
})

const busyLabel = computed(() => {
  const s = selected.value
  if (!s) return ''
  if (s.state === 'download')
    return `Downloading ${fmtGb(total.value * progress.value)} of ${fmtGb(total.value)}`
  if (s.inst.kind === 'cloud') return `Opening ${s.inst.name}`
  if (s.state === 'running') return `Opening in ${s.inst.name}`
  return `Starting ${s.inst.name}`
})

function confirm(): void {
  const s = selected.value
  const t = template.value
  if (!s || !t || s.disabled || phase.value === 'busy') return
  if (s.state === 'login') {
    hostActions.signIn()
    return
  }
  phase.value = 'busy'
  const ms = s.state === 'download' ? 2600 : s.state === 'running' ? 700 : 1400
  const t0 = Date.now()
  timer = setInterval(() => {
    progress.value = Math.min(1, (Date.now() - t0) / ms)
    if (progress.value < 1) return
    stop()
    hostActions.launch(s.inst, t.title)
  }, 40)
}

function favorite(): void {
  moreMenu.value = false
  if (template.value) toggleFavorite(template.value.id, 'template')
}
function share(): void {
  moreMenu.value = false
  void navigator.clipboard
    ?.writeText(`https://comfy.org/templates/${template.value?.id}`)
    .catch(() => {})
  toast('Link copied')
}

const content = ref<{ $el: HTMLElement }>()
function focusPicker(e: Event): void {
  e.preventDefault()
  void nextTick(() => {
    const el = content.value?.$el as HTMLElement | undefined
    ;(el?.querySelector<HTMLElement>('[data-tpl-primary]:not(:disabled)') ?? el)?.focus({
      preventScroll: true,
      // Enter runs it; no ring until the keyboard moves.
      focusVisible: false
    } as FocusOptions)
  })
}
/** Escape closes an open menu first, then the modal. */
function onEscape(e: KeyboardEvent): void {
  if (zoomCtl.value?.open) {
    e.preventDefault()
    zoomCtl.value.open = false
    return
  }
  if (!moreMenu.value && !buildMenu.value) return
  e.preventDefault()
  moreMenu.value = buildMenu.value = false
}
/** Enter launches from nowhere in particular; on a control it keeps its
 *  own meaning (on the primary, it is the primary). */
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Enter' || e.isComposing) return
  const el = e.target as HTMLElement
  if (!el.closest('button, a, input, textarea, [role="tab"]')) {
    e.preventDefault()
    confirm()
  }
}

/** The needs, in one line, for the build picked: what it has, or what
 *  it downloads first. */
const needsLine = computed(() => {
  const n = needs.value.length
  if (!n)
    return template.value?.runs === 'cloud' ? 'Partner API on Comfy Cloud' : 'Nothing to download'
  const models = `${n} ${n === 1 ? 'model' : 'models'}`
  if (modelState.value === 'cloud') return `${models} · Ready on Cloud`
  if (modelState.value === 'here') return `${models} · Installed`
  return `${models} · ${fmtGb(total.value)}`
})

const aboutEl = ref<HTMLElement>()
const aboutOpen = ref(false)
const aboutLong = ref(false)
watch(
  [() => proto.detail, aboutEl],
  () => {
    aboutOpen.value = false
    void nextTick(() => {
      const el = aboutEl.value
      aboutLong.value = Boolean(el && el.scrollHeight > el.clientHeight + 1)
    })
  },
  { immediate: true }
)

// The graph's zoom: a percentage of the fitted size, read in real size.
const zoom = ref(100)
const graphFit = ref(1)
const zoomCtl = ref<InstanceType<typeof ZoomControl>>()
watch(view, () => (zoom.value = 100))

const VIEWS: { value: 'result' | 'graph'; label: string }[] = [
  { value: 'result', label: 'Result' },
  { value: 'graph', label: 'Graph' }
]
// The graph takes the whole stage so zoomed in it runs to the edges; it
// fits inside the room the picture has (under the bar, over the zoom).
const GRAPH_PAD = { t: 64, r: 32, b: 72, l: 32 }
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal :to="PORTAL_TO" defer>
      <DialogOverlay class="proto-ui mad-scrim mar-tpl-dim" />
      <DialogContent
        v-if="template && info && media"
        ref="content"
        class="proto-ui mad mar-tpl"
        :data-busy="phase === 'busy' || undefined"
        @open-auto-focus="focusPicker"
        @escape-key-down="onEscape"
        @keydown="onKey"
      >
        <section class="mad-stage" @pointerdown.self="open = false">
          <header class="mad-bar">
            <MarSeg v-model="view" :options="VIEWS" label="Preview" class="mar-tpl-views" />
          </header>
          <div v-if="view === 'result'" class="mad-view">
            <!-- Catalog pictures are small: never past 1.5× their size, so
                 they stay crisp. -->
            <div
              class="mad-fit"
              :style="{ '--r': ratio, maxWidth: natural ? `${natural * 1.5}px` : undefined }"
            >
              <div ref="mediaEl" class="mad-media" :style="{ scale: zoom / 100 }">
                <img :src="media.hero" alt="" draggable="false" @load="measure" />
                <template v-if="media.quadrants">
                  <span
                    v-for="(q, i) in media.quadrants"
                    :key="q"
                    class="mar-tpl-quad"
                    :data-q="i"
                    >{{ q }}</span
                  >
                </template>
              </div>
            </div>
          </div>
          <!-- The graph takes the picture's place, fitted to the same area. -->
          <div v-else-if="graph" class="mar-tpl-gview">
            <TplGraph v-model:zoom="zoom" v-model:fit="graphFit" :spec="graph" :pad="GRAPH_PAD" />
          </div>
          <!-- Zoom, where the asset view keeps it, bottom right, for the
               picture and the graph alike. -->
          <footer class="mad-foot">
            <span />
            <ZoomControl
              ref="zoomCtl"
              v-model="zoom"
              :fit="view === 'graph' ? graphFit : picFit"
              keys
            />
          </footer>
        </section>

        <aside class="mad-side" aria-label="Workflow details">
          <div class="mad-body">
            <header class="mad-head">
              <div class="mad-head-text">
                <DialogTitle class="mad-name">{{ template.title }}</DialogTitle>
                <DialogDescription class="mar-tpl-by">
                  <span class="mar-tpl-author"><ComfyCLogo :size="10" /></span>ComfyUI<i />{{
                    info.useCase
                  }}
                </DialogDescription>
              </div>
              <span
                v-if="favorited"
                class="mar-tpl-fav"
                title="In your favorites"
                aria-label="In your favorites"
                ><Star :size="14" fill="currentColor"
              /></span>
            </header>

            <!-- What it does, short: the first paragraph. -->
            <section class="mad-sec">
              <!-- Four lines at most; More opens the rest in place. -->
              <div class="mar-tpl-about">
                <p ref="aboutEl" :class="!aboutOpen && 'is-clamped'">
                  {{ aboutFor(template)[0] }}
                </p>
                <button
                  v-if="aboutLong"
                  type="button"
                  class="mar-tpl-more"
                  :aria-expanded="aboutOpen"
                  @click="aboutOpen = !aboutOpen"
                >
                  {{ aboutOpen ? 'Less' : 'More' }}
                </button>
              </div>
            </section>

            <section class="mad-sec">
              <h3 class="mad-label">Details</h3>
              <dl class="mad-rows">
                <div>
                  <dt>Author</dt>
                  <dd>ComfyUI</dd>
                </div>
                <div v-if="info.model">
                  <dt>Model</dt>
                  <dd>{{ info.model }}</dd>
                </div>
                <div>
                  <dt>Uses</dt>
                  <dd>{{ info.uses }}</dd>
                </div>
                <div>
                  <dt>License</dt>
                  <dd :title="info.license">{{ info.license }}</dd>
                </div>
                <!-- Only when the catalog has one: no row pointing nowhere. -->
                <div v-if="info.tutorial">
                  <dt>Tutorial</dt>
                  <dd>
                    <a
                      class="mar-tpl-tutorial"
                      :href="info.tutorial"
                      target="_blank"
                      rel="noreferrer"
                      ><BookOpen :size="13" />docs.comfy.org</a
                    >
                  </dd>
                </div>
              </dl>
            </section>

            <!-- Open in, last and pushed down to the button it sets: the build it opens on, as one filled row that is
                 the picker (the other builds open under it), then why in
                 one line. What blocks it is one line and one action at the
                 bottom, in place of the primary. -->
            <section class="mad-sec mar-tpl-openin">
              <h3 class="mad-label">Open in</h3>
              <div v-if="shown" ref="buildBox" class="mad-pick">
                <button
                  type="button"
                  class="mar-tpl-on"
                  :data-s="shown.state"
                  :aria-label="`Open in ${shown.inst.name}. Change build`"
                  aria-haspopup="menu"
                  :aria-expanded="buildMenu"
                  :disabled="phase === 'busy' || targets.length < 2"
                  @click="buildMenu = !buildMenu"
                >
                  <span class="mar-tpl-glyph">
                    <LocationIcon
                      :kind="shown.inst.kind === 'cloud' ? 'cloud' : 'local'"
                      :size="18"
                    />
                    <i v-if="shown.inst.state === 'running' && !shown.disabled" />
                  </span>
                  <span class="mar-tpl-row-text">
                    <span class="mar-tpl-row-name">{{ shown.inst.name }}</span>
                    <span class="mar-tpl-row-status">{{ shown.status }}</span>
                  </span>
                  <span v-if="shown.cost" class="mar-tpl-cost" :data-s="tone(shown)">{{
                    shown.cost
                  }}</span>
                  <ChevronDown v-if="targets.length > 1" :size="14" class="mar-tpl-chev" />
                </button>
                <div v-if="buildMenu" class="mad-menu is-up mar-tpl-builds" role="menu">
                  <button
                    v-for="x in targets"
                    :key="x.inst.id"
                    type="button"
                    role="menuitemradio"
                    :aria-checked="x.inst.id === selectedId"
                    :class="x.inst.id === selectedId && 'is-on'"
                    :disabled="x.disabled"
                    :data-s="x.state"
                    @click="pickBuild(x)"
                  >
                    <LocationIcon :kind="x.inst.kind === 'cloud' ? 'cloud' : 'local'" :size="15" />
                    <span class="mar-tpl-row-text">
                      <span class="mar-tpl-row-name">{{ x.inst.name }}</span>
                      <span class="mar-tpl-row-status">{{ x.status }}</span>
                    </span>
                    <span class="mar-tpl-cost" :data-s="tone(x)">{{ x.cost }}</span>
                  </button>
                </div>
              </div>
              <p v-if="fit" class="mar-tpl-fit"><BadgeCheck :size="13" />{{ fit }}</p>
            </section>

            <!-- What it needs, on the build picked above: one line; the files fold under it. -->
            <details
              class="mad-sec mar-tpl-needs-box"
              @toggle="
                ($event.target as HTMLDetailsElement).open &&
                ($event.target as HTMLElement).scrollIntoView({ block: 'nearest' })
              "
            >
              <summary class="mad-label">
                What it needs<span class="mar-tpl-total">{{ needsLine }}</span
                ><ChevronDown :size="13" class="mar-tpl-fold" />
              </summary>
              <ul class="mar-tpl-needs">
                <li v-for="m in needs" :key="m.name">
                  <ComfyModel :size="14" />
                  <span class="mar-tpl-file">{{ m.name.replace('.safetensors', '') }}</span>
                  <span class="mar-tpl-size">{{ m.size }}</span>
                  <span
                    class="mar-tpl-mark"
                    :data-m="modelState"
                    :title="
                      modelState === 'here'
                        ? 'Installed'
                        : modelState === 'get'
                          ? 'Downloads first'
                          : modelState === 'cloud'
                            ? 'Ready on Cloud'
                            : ''
                    "
                  >
                    <Check v-if="modelState === 'here' || modelState === 'cloud'" :size="12" />
                    <ArrowDownToLine v-else-if="modelState === 'get'" :size="12" />
                  </span>
                </li>
                <li v-if="template.runs === 'cloud'">
                  <Plug :size="14" />
                  <span class="mar-tpl-file">Partner model API</span>
                  <span class="mar-tpl-size">Comfy Cloud</span>
                  <span class="mar-tpl-mark" />
                </li>
                <li v-if="info.vramGb">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect
                      x="2.5"
                      y="4"
                      width="11"
                      height="8"
                      rx="1.5"
                      stroke="currentColor"
                      stroke-width="1.3"
                    />
                    <path
                      d="M5 4V2.5M8 4V2.5M11 4V2.5M5 13.5V12M8 13.5V12M11 13.5V12"
                      stroke="currentColor"
                      stroke-width="1.3"
                      stroke-linecap="round"
                    />
                  </svg>
                  <span class="mar-tpl-file is-ui">GPU memory</span>
                  <span class="mar-tpl-size">{{ info.vramGb }} GB</span>
                  <span class="mar-tpl-mark" :data-m="memoryOk ? 'here' : 'warn'">
                    <Check v-if="memoryOk" :size="12" />
                    <TriangleAlert v-else :size="11" />
                  </span>
                </li>
              </ul>
            </details>
          </div>

          <!-- At the bottom: what happens, then the one action; More (the
               favorite and the link) at its right. -->
          <footer class="mad-actions">
            <p v-if="line" class="mar-tpl-note">{{ line }}</p>
            <button
              type="button"
              class="mad-btn is-primary mar-tpl-go"
              data-tpl-primary
              :disabled="!selected || selected.disabled"
              :data-s="shown?.state"
              :style="{ '--p': progress }"
              @click="confirm"
            >
              <span>{{ phase === 'busy' ? busyLabel : shown?.action || 'Open' }}</span>
              <kbd v-if="phase === 'idle' && selected && !selected.disabled">↵</kbd>
            </button>
            <div ref="moreBox" class="mad-pick">
              <button
                type="button"
                class="mad-btn is-more"
                aria-label="More"
                title="More"
                aria-haspopup="menu"
                :aria-expanded="moreMenu"
                @click="moreMenu = !moreMenu"
              >
                <MoreHorizontal :size="16" />
              </button>
              <div v-if="moreMenu" class="mad-menu is-up is-end is-more" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  data-tpl-like
                  :aria-pressed="favorited"
                  @click="favorite"
                >
                  <Star :size="14" :fill="favorited ? 'currentColor' : 'none'" />{{
                    favorited ? 'Remove from favorites' : 'Add to favorites'
                  }}
                </button>
                <button type="button" role="menuitem" @click="share">
                  <Link2 :size="14" />Copy link
                </button>
              </div>
            </div>
          </footer>
        </aside>

        <DialogClose class="mad-x" aria-label="Close"><X :size="18" /></DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
