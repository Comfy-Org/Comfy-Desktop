<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  ArrowDownToLine,
  BadgeCheck,
  BookOpen,
  Check,
  Coins,
  Link2,
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
  DialogTitle,
  RadioGroupItem,
  RadioGroupRoot
} from 'reka-ui'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import LocationIcon from '../../ui/LocationIcon.vue'
import { PORTAL_TO } from '../../ui/portal'
import { hostActions, instances, proto, toast } from '../../useProto'
import { templateById } from '../../fit'
import { isFavorite, toggleFavorite } from '../favorites'
import { ComfyModel, ComfyTemplate, ComfyWorkflow } from '../icons/comfyIcons'
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
  totalGb,
  type Target
} from './templateData'
import { graphFor } from './graphSpec'
import TplGraph from './TplGraph.vue'
import MarSeg from '../pages/MarSeg.vue'
import './templateModal.css'

/**
 * Mar's template modal: what it makes (a hero of the output, or its
 * graph), what it needs, and where it runs. The picker puts the best build
 * first with the reason, shows what every other one would cost, and the
 * one primary action follows the choice. Templates only; saved workflows
 * keep Pablo's DetailSheet.
 */
const template = computed(() =>
  proto.detail?.kind === 'template' ? templateById(proto.detail.id) : undefined
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

function share(): void {
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
    ;(el?.querySelector<HTMLElement>('[role="radio"][data-state="checked"]') ?? el)?.focus({
      preventScroll: true
    })
  })
}
/** Enter launches from the picker (or from nowhere in particular); on any
 *  other control it keeps its own meaning. */
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Enter' || e.isComposing) return
  const el = e.target as HTMLElement
  if (el.closest('[role="radio"]') || !el.closest('button, a, input, textarea, [role="tab"]')) {
    e.preventDefault()
    confirm()
  }
}

const VIEWS: { value: 'result' | 'graph'; label: string }[] = [
  { value: 'result', label: 'Result' },
  { value: 'graph', label: 'Graph' }
]
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal :to="PORTAL_TO" defer>
      <DialogOverlay class="proto-ui mar-tpl-scrim" />
      <DialogContent
        v-if="template && info && media"
        ref="content"
        class="proto-ui mar-tpl"
        :data-busy="phase === 'busy' || undefined"
        @open-auto-focus="focusPicker"
        @keydown="onKey"
      >
        <div class="mar-tpl-main">
          <header class="mar-tpl-head">
            <div class="min-w-0">
              <p class="mar-tpl-eyebrow">
                <ComfyTemplate :size="13" />Template<i />{{ info.useCase }}<i />
                <ComfyWorkflow :size="13" />Node graph
              </p>
              <DialogTitle class="mar-tpl-title">{{ template.title }}</DialogTitle>
              <DialogDescription class="mar-tpl-meta">
                <span class="mar-tpl-author"><ComfyCLogo :size="10" /></span>
                <b>ComfyUI</b><i />{{ info.uses }} uses<i />Added {{ info.added }}<i />{{
                  info.license
                }}
              </DialogDescription>
            </div>
          </header>

          <div class="mar-tpl-stage" :data-view="view">
            <MarSeg
              v-model="view"
              :options="VIEWS"
              label="Preview"
              on-media
              class="mar-tpl-views"
            />
            <template v-if="view === 'result'">
              <img :src="media.hero" alt="" class="mar-tpl-hero" draggable="false" />
              <template v-if="media.quadrants">
                <span v-for="(q, i) in media.quadrants" :key="q" class="mar-tpl-quad" :data-q="i">{{
                  q
                }}</span>
              </template>
              <span class="mar-tpl-caption">Example output</span>
            </template>
            <TplGraph v-else-if="graph" :spec="graph" />
          </div>

          <section class="mar-tpl-about">
            <h3 class="mar-tpl-label">What it makes</h3>
            <p v-for="(para, i) in aboutFor(template)" :key="i">{{ para }}</p>
            <div class="mar-tpl-tags">
              <span v-for="t in info.tags" :key="t" class="mar-tpl-tag">{{ t }}</span>
              <a
                class="mar-tpl-tutorial"
                href="https://docs.comfy.org/tutorials"
                target="_blank"
                rel="noreferrer"
                @click.prevent="toast('Opens the tutorial on docs.comfy.org')"
                ><BookOpen :size="13" />Tutorial</a
              >
            </div>
          </section>
        </div>

        <aside class="mar-tpl-side">
          <div class="mar-tpl-social">
            <!-- Keep it: the app's one way to keep a template (Favorites).
                 Templates have no likes or copies in the product. -->
            <button
              v-if="template"
              type="button"
              class="mar-tpl-chip"
              data-tpl-like
              :aria-pressed="isFavorite(template.id, 'template')"
              @click="toggleFavorite(template.id, 'template')"
            >
              <Star
                :size="14"
                :fill="isFavorite(template.id, 'template') ? 'currentColor' : 'none'"
              />{{ isFavorite(template.id, 'template') ? 'Favorited' : 'Favorite' }}
            </button>
            <button type="button" class="mar-tpl-chip" @click="share">
              <Link2 :size="14" />Share
            </button>
          </div>

          <div class="mar-tpl-side-scroll">
            <section class="mar-tpl-panel">
              <h3 class="mar-tpl-label">
                What it needs<span>{{ total ? fmtGb(total) : 'No downloads' }}</span>
              </h3>
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
            </section>

            <section class="mar-tpl-where">
              <h3 class="mar-tpl-label">Open in</h3>
              <p v-if="best && reason" class="mar-tpl-reason">
                <BadgeCheck :size="14" /><span
                  ><b>{{ best.inst.name }}</b> is the best fit. {{ reason }}</span
                >
              </p>
              <RadioGroupRoot
                v-model="selectedId"
                class="mar-tpl-picker"
                aria-label="Open in"
                :disabled="phase === 'busy'"
              >
                <RadioGroupItem
                  v-for="x in targets"
                  :key="x.inst.id"
                  :value="x.inst.id"
                  :disabled="x.disabled"
                  class="mar-tpl-row"
                  :data-s="x.state"
                  @focus="phase === 'idle' && (selectedId = x.inst.id)"
                >
                  <span class="mar-tpl-glyph">
                    <LocationIcon :kind="x.inst.kind === 'cloud' ? 'cloud' : 'local'" :size="18" />
                    <i v-if="x.inst.state === 'running' && !x.disabled" />
                  </span>
                  <span class="mar-tpl-row-text">
                    <span class="mar-tpl-row-name"
                      >{{ x.inst.name }}<em v-if="best?.inst.id === x.inst.id">Best fit</em></span
                    >
                    <span class="mar-tpl-row-status">{{ x.status }}</span>
                  </span>
                  <span class="mar-tpl-cost" :data-s="x.state">
                    <Coins v-if="x.state === 'cloud'" :size="12" />
                    <ArrowDownToLine v-else-if="x.state === 'download'" :size="12" />
                    <TriangleAlert v-else-if="x.state === 'memory'" :size="12" />
                    {{ x.cost }}
                  </span>
                  <span class="mar-tpl-radio" />
                </RadioGroupItem>
              </RadioGroupRoot>
            </section>
          </div>

          <footer class="mar-tpl-foot">
            <p class="mar-tpl-note">{{ selected?.note }}</p>
            <div class="mar-tpl-buttons">
              <DialogClose class="mar-tpl-cancel">Cancel</DialogClose>
              <button
                type="button"
                class="mar-tpl-primary"
                data-tpl-primary
                :disabled="!selected || selected.disabled"
                :style="{ '--p': progress }"
                @click="confirm"
              >
                <span>{{ phase === 'busy' ? busyLabel : selected?.action }}</span>
                <kbd v-if="phase === 'idle'">↵</kbd>
              </button>
            </div>
          </footer>
        </aside>

        <DialogClose class="mar-tpl-close" aria-label="Close"><X :size="16" /></DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
