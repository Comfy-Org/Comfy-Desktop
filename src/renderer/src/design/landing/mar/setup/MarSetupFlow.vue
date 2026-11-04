<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronDown,
  CircleCheck,
  Copy,
  HardDrive,
  Laptop,
  Package,
  SlidersHorizontal,
  TriangleAlert
} from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle, RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import ChoiceCard from '../../../../components/ChoiceCard.vue'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import Badge from '../../ui/Badge.vue'
import Button from '../../ui/Button.vue'
import Checkbox from '../../ui/Checkbox.vue'
import DialogContent from '../../ui/DialogContent.vue'
import Input from '../../ui/Input.vue'
import MediaCard from '../../ui/MediaCard.vue'
import Select from '../../ui/Select.vue'
import MarSeg from '../pages/MarSeg.vue'
import { useShowcaseCarousel } from '../../../../composables/useShowcaseCarousel'
import en from '@locales/en.json'
import { PORTAL_TO } from '../../ui/portal'
import { hostActions, toast } from '../../useProto'
import {
  DETECTED,
  STARTERS,
  backFromError,
  cancelInstall,
  chooseCloud,
  chooseLocal,
  closeSetup,
  flow,
  localSetup,
  lowSpace,
  phaseIndex,
  phases,
  retryInstall,
  setupOn,
  startInstall,
  unsupported,
  type Starter
} from './setupFlow'
import SetupBloom from './SetupBloom.vue'
import './setup.css'

/**
 * Mar's proposed local setup (UI Playground › Local setup › Proposal), in
 * her step-modal family (New space): one smoked-glass modal over the app,
 * the content, then a footer bar with the actions. Set up sums up today's
 * Configure with what the checks found; the template step and the install
 * wait are today's.
 * Copy is the product's, in English.
 */
const open = computed({
  get: () => setupOn.value && flow.open && flow.step !== 'first',
  set: (v: boolean) => {
    if (!v) closeSetup()
  }
})

const where = computed(() =>
  flow.movedDisk ? `/Volumes/${DETECTED.otherDisk.name}/ComfyUI` : DETECTED.path
)
const free = computed(() =>
  flow.movedDisk ? DETECTED.otherDisk.freeGb : lowSpace.value ? DETECTED.lowFreeGb : DETECTED.freeGb
)
const freeLabel = (gb: number): string => (gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${gb} GB`)

// First launch, as shipped today: Local picked, terms off until ticked,
// usage data and beta on, Express off. Consent is asked here once, not in
// Set up. Express skips Set up and the template step and installs with
// the recommended settings, as today.
const firstOpen = computed(() => setupOn.value && flow.open && flow.step === 'first')
const runOn = ref<'cloud' | 'local'>('local')
const terms = ref(false)
const usage = ref(true)
const beta = ref(true)
const express = ref(false)
function continueFirst(): void {
  if (runOn.value === 'cloud') chooseCloud()
  else if (express.value && !unsupported.value) installWith(null)
  else chooseLocal()
}

// Today's estimate: the download, unpacked, takes about 2.25 times its size.
const REQUIRED_GB = (DETECTED.downloadGb * 2.25).toFixed(1)

// Set up › Continue: low space asks first, as today, then the template step.
function continueSetup(): void {
  if (lowSpace.value) flow.confirmLowDisk = true
  else toTemplates()
}
function toTemplates(): void {
  flow.confirmLowDisk = false
  if (dontShowTemplates.value) installWith(null)
  else flow.step = 'template'
}
const dontShowTemplates = ref(false)
const TABS = [
  { value: 'image' as const, label: 'Image' },
  { value: 'video' as const, label: 'Video' },
  { value: '3d' as const, label: '3D' },
  { value: 'audio' as const, label: 'Audio' }
]
function pick(s: Starter): void {
  flow.picked = flow.picked?.id === s.id ? null : s
}
function installWith(s: Starter | null): void {
  flow.picked = s
  startInstall()
}
const imgUrl = (f: string): string => new URL(`../assets/${f}`, import.meta.url).href
// The install wait's outputs: today's showcase clips, floating on their own
// instead of inside today's scene box.
const CLIPS = [
  { id: 'eye', src: './install-showcase-scene/Assets/eye.webm', poster: 'mock/clip-eye.jpg' },
  {
    id: 'clouds',
    src: './install-showcase-scene/Assets/clouds.webm',
    poster: 'mock/clip-clouds.jpg'
  },
  {
    id: 'mountains',
    src: './install-showcase-scene/Assets/dusk_mountains.webm',
    poster: 'mock/clip-dusk-mountains.jpg'
  },
  {
    id: 'flower',
    src: './install-showcase-scene/Assets/flower.webm',
    poster: 'mock/clip-flower.jpg'
  }
]

// Change setup: the fields start on what fits this computer.
const name = ref('ComfyUI')
const channel = ref<'stable' | 'latest'>('stable')
const hardware = ref<'mps' | 'cpu'>('mps')
// Today's install methods on a Mac (Portable is Windows only). Managed
// builds need a sign-in; a remote server needs only its address.
const method = ref<'public' | 'managed' | 'remote'>('public')
const METHODS = [
  { value: 'public' as const, label: 'Public Builds' },
  { value: 'managed' as const, label: 'Managed Builds' },
  { value: 'remote' as const, label: 'Remote Connection' }
]
const serverUrl = ref('')
const version = ref(DETECTED.version)
const VERSIONS = [
  { value: DETECTED.version, label: DETECTED.version, hint: 'Latest stable' },
  { value: 'v0.42.3', label: 'v0.42.3' },
  { value: 'v0.42.2', label: 'v0.42.2' }
]

// Back leaves Change setup as it found it; Done keeps the edits.
const draft = () => ({
  method: method.value,
  serverUrl: serverUrl.value,
  name: name.value,
  channel: channel.value,
  version: version.value,
  hardware: hardware.value,
  movedDisk: flow.movedDisk
})
let saved = draft()
function changeSetup(): void {
  saved = draft()
  flow.step = 'change'
}
function discardChanges(): void {
  method.value = saved.method
  serverUrl.value = saved.serverUrl
  name.value = saved.name
  channel.value = saved.channel
  version.value = saved.version
  hardware.value = saved.hardware
  flow.movedDisk = saved.movedDisk
  flow.step = 'setup'
}
const CHANNELS = [
  { value: 'stable' as const, label: 'Stable' },
  { value: 'latest' as const, label: 'Latest on GitHub' }
]
const HARDWARE = [
  { value: 'mps' as const, label: DETECTED.build, hint: '' },
  { value: 'cpu' as const, label: 'CPU', hint: '' }
]

// Today's install wait: the Cloud pitch rotates over the scene, in the
// product's own strings.
const showcase = useShowcaseCarousel()
const say = (key: string): string =>
  key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en) as string

const failed = computed(() => flow.step === 'error')
</script>

<template>
  <!-- First launch: today's takeover, unchanged. Local goes on to Set up. -->
  <Teleport :to="PORTAL_TO">
    <Transition name="mss-first">
      <div
        v-if="firstOpen"
        class="proto-ui mss-first"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mss-first-title"
      >
        <div class="mss-first-frame">
          <ComfyCLogo class="mss-first-mark" />
          <div class="mss-first-hero">
            <h1 id="mss-first-title" class="mss-first-title">How do you want to run Comfy?</h1>
            <p class="mss-first-lead">
              Choose the setup that fits how you work. You can switch later.
            </p>
            <!-- Desktop's own ChoiceCard, as on today's first screen. -->
            <div
              class="mss-first-cards"
              role="radiogroup"
              data-no-pill
              aria-label="How do you want to run Comfy?"
            >
              <ChoiceCard
                selectable
                :selected="runOn === 'cloud'"
                label="Cloud"
                tagline="Full power. Instant setup."
                description="Best for **most users** who want powerful GPUs and popular custom nodes, ready anywhere."
                @click="runOn = 'cloud'"
              />
              <ChoiceCard
                selectable
                :selected="runOn === 'local'"
                label="Local"
                tagline="Full control. Your hardware."
                description="Best for people who want **full manual control** with versions, custom nodes, and offline workflows."
                @click="runOn = 'local'"
              />
            </div>
            <!-- Migrate and Express are Local options; they keep their room
                 while Cloud is picked, so switching cards doesn't move the
                 screen. -->
            <div
              class="mss-first-mods"
              :class="runOn !== 'local' && 'is-off'"
              :aria-hidden="runOn !== 'local'"
            >
              <label v-if="localSetup.machine === 'legacy'" class="mss-check">
                <Checkbox v-model="flow.bringOver" />
                <span
                  ><span class="text-base-foreground">Migrate existing instance</span>
                  <span class="mss-first-hint"
                    >Bring over <b>workflows, models, and settings</b> from your existing ComfyUI
                    instance.</span
                  ></span
                >
              </label>
              <label class="mss-check">
                <Checkbox v-model="express" />
                <span
                  ><span class="text-base-foreground"
                    >Express Install with recommended settings</span
                  >
                  <span v-if="express" class="mss-first-hint"
                    >Detected: {{ DETECTED.build }} - if that's not your hardware, uncheck
                    Express</span
                  ></span
                >
              </label>
            </div>
          </div>
          <div class="mss-first-bottom">
            <div class="mss-first-consent">
              <label class="mss-check">
                <Checkbox v-model="terms" />
                <span
                  >I agree to the <a href="#" class="mss-link" @click.prevent>EULA</a> and
                  <a href="#" class="mss-link" @click.prevent>Terms of Service</a>.</span
                >
              </label>
              <label class="mss-check">
                <Checkbox v-model="usage" />
                <span
                  >Help improve Comfy by sharing anonymous usage data.
                  <a href="#" class="mss-link" @click.prevent>Learn more</a></span
                >
              </label>
              <label class="mss-check">
                <Checkbox v-model="beta" :disabled="!usage" />
                <span>Opt in to beta features and help test what ships next</span>
              </label>
            </div>
            <div class="mss-first-actions">
              <Button variant="primary" size="lg" :disabled="!terms" @click="continueFirst"
                >Continue</Button
              >
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- First launch: Set up and the install sit on the same full-window
       frame, above the scrim, so the Home never shows behind them. -->
  <Teleport :to="PORTAL_TO">
    <div v-if="open && flow.takeover" class="proto-ui mss-first is-backdrop" aria-hidden="true">
      <div class="mss-first-frame"><ComfyCLogo class="mss-first-mark" /></div>
    </div>
  </Teleport>

  <DialogRoot v-model:open="open">
    <DialogContent
      size="lg"
      class="mar-wizard mss w-[min(760px,calc(100vw-48px))] p-0"
      :class="flow.takeover && 'mss-in-takeover z-[72]'"
      :closable="!flow.takeover"
    >
      <!-- Set up: the checks already ran, one Install. -->
      <template v-if="flow.step === 'setup'">
        <div :key="flow.step" class="mar-wizard-body mss-body">
          <template v-if="!unsupported">
            <DialogTitle as="h3" class="text-title font-semibold"
              >Install ComfyUI on this Mac</DialogTitle
            >
            <DialogDescription
              >Checked for your {{ DETECTED.chip }}. Change anything before you
              install.</DialogDescription
            >

            <!-- The machine it checked, on the bloom stage. -->
            <div class="mss-stage">
              <SetupBloom />
              <div class="mss-stage-ui">
                <div class="mss-stage-top">
                  <span v-if="lowSpace" class="mss-chip is-bad"
                    ><TriangleAlert :size="12" />Low Disk Space</span
                  >
                  <span v-else></span>
                  <button type="button" class="mss-chip is-btn" @click="changeSetup">
                    <SlidersHorizontal :size="12" />Change
                  </button>
                </div>
                <div class="mss-stage-subject">
                  <span class="mss-stage-glyph"><Laptop :size="20" /></span>
                  <span class="grid">
                    <span class="mss-stage-title"
                      >{{ DETECTED.chip }} · {{ DETECTED.memGb }} GB</span
                    >
                    <span class="mss-stage-sub"
                      >Detected. Uses the {{ DETECTED.build }} build.</span
                    >
                  </span>
                </div>
              </div>
            </div>

            <section class="mss-tiles" aria-label="Install summary">
              <div class="mss-tile" :class="lowSpace && 'is-bad'">
                <span class="mss-tile-icon"><HardDrive :size="16" /></span>
                <span class="mss-sum-val">
                  <span class="mss-sum-key">Location</span>
                  <span class="truncate">{{ where }}</span>
                  <span :class="lowSpace ? 'text-status-danger' : 'text-subtle-foreground'"
                    >{{ freeLabel(free) }} free · ~{{ REQUIRED_GB }} GB required</span
                  >
                </span>
                <TriangleAlert
                  v-if="lowSpace"
                  :size="16"
                  class="mss-bad"
                  aria-label="Low Disk Space"
                />
                <CircleCheck v-else :size="16" class="mss-ok" aria-label="Checked" />
              </div>
              <div class="mss-tile">
                <span class="mss-tile-icon"><Package :size="16" /></span>
                <span class="mss-sum-val">
                  <span class="mss-sum-key">Version</span>
                  <span>ComfyUI {{ DETECTED.version }} · Stable</span>
                  <span class="text-subtle-foreground">{{ DETECTED.downloadGb }} GB download</span>
                </span>
                <CircleCheck :size="16" class="mss-ok" aria-label="Checked" />
              </div>
              <!-- Migrate, ticked on the first screen: today's migrate op. -->
              <div
                v-if="localSetup.machine === 'legacy' && flow.bringOver"
                class="mss-tile is-wide"
              >
                <span class="mss-tile-icon"><ArrowLeftRight :size="16" /></span>
                <span class="mss-sum-val">
                  <span class="mss-sum-key">Migrate existing instance</span>
                  <span>Workflows, models, and settings</span>
                  <span class="text-subtle-foreground">From your existing ComfyUI instance</span>
                </span>
                <CircleCheck :size="16" class="mss-ok" aria-label="Checked" />
              </div>
            </section>
          </template>

          <!-- Intel Mac: today's Unsupported Hardware alert. A local install
               can't be picked; Cloud is on the first screen, Remote Connection
               under Change. -->
          <template v-else>
            <DialogTitle as="h3" class="text-title font-semibold">Unsupported Hardware</DialogTitle>
            <DialogDescription
              >ComfyUI requires Apple Silicon (M1/M2/M3) Mac. Intel-based Macs are not
              supported.</DialogDescription
            >
            <div class="mss-stage is-short">
              <SetupBloom tone="err" />
              <div class="mss-stage-ui">
                <div class="mss-stage-subject">
                  <span class="mss-stage-glyph"><Laptop :size="20" /></span>
                  <span class="mss-stage-title">Intel processor</span>
                </div>
              </div>
            </div>
          </template>
        </div>
        <footer class="mar-wizard-foot mss-foot">
          <Button v-if="flow.takeover" variant="ghost" size="lg" @click="flow.step = 'first'"
            >Back</Button
          >
          <!-- Today's low-space warning: it asks, it doesn't block. -->
          <template v-if="flow.confirmLowDisk">
            <span class="mr-auto grid text-ui">
              <span class="font-medium text-base-foreground">Low Disk Space</span>
              <span class="text-subtle-foreground"
                >The target drive only has {{ freeLabel(free) }} free. This operation may require
                approximately {{ REQUIRED_GB }} GB. You may run out of space during the
                process.</span
              >
            </span>
            <Button variant="ghost" size="lg" @click="flow.confirmLowDisk = false">Cancel</Button>
            <Button variant="primary" size="lg" @click="toTemplates">Continue Anyway</Button>
          </template>
          <template v-else>
            <span class="flex-1"></span>
            <Button v-if="unsupported" size="lg" @click="changeSetup">Change</Button>
            <Button v-else variant="primary" size="lg" @click="continueSetup">Continue</Button>
          </template>
        </footer>
      </template>

      <!-- Change: every field filled in with what fits this computer. -->
      <template v-else-if="flow.step === 'change'">
        <div :key="flow.step" class="mar-wizard-body mss-body">
          <DialogTitle as="h3" class="text-title font-semibold">Change setup</DialogTitle>
          <DialogDescription
            >Everything here is already set to what fits this computer.</DialogDescription
          >
          <div class="mss-fields">
            <div class="mss-field">
              <span class="text-ui font-medium text-base-foreground">Install method</span>
              <MarSeg v-model="method" label="Install method" :options="METHODS" />
            </div>
            <div v-if="method === 'remote'" class="mss-field">
              <span class="text-ui font-medium text-base-foreground">Server URL</span>
              <Input
                v-model="serverUrl"
                placeholder="http://192.168.1.20:8188"
                aria-label="Server URL"
              />
            </div>
            <div class="mss-field">
              <span class="text-ui font-medium text-base-foreground">Name</span>
              <Input v-model="name" aria-label="Name" />
            </div>
            <div v-if="method !== 'remote'" class="mss-field">
              <span class="text-ui font-medium text-base-foreground">Location</span>
              <Input :model-value="where" readonly aria-label="Location">
                <template #trailing>
                  <span class="text-ui whitespace-nowrap text-subtle-foreground"
                    >{{ freeLabel(free) }} free</span
                  >
                  <Button
                    size="sm"
                    variant="subtle"
                    class="mr-1.5"
                    @click.prevent="flow.movedDisk = true"
                    >Browse…</Button
                  >
                </template>
              </Input>
            </div>
            <div v-if="method === 'public'" class="mss-field">
              <span class="text-ui font-medium text-base-foreground">Release</span>
              <div class="flex flex-wrap items-center gap-3">
                <MarSeg v-model="channel" label="Release" :options="CHANNELS" />
                <Select
                  v-if="channel === 'stable'"
                  v-model="version"
                  label="ComfyUI"
                  :options="VERSIONS"
                />
              </div>
            </div>
            <div v-if="method === 'managed'" class="mss-field">
              <span class="text-ui font-medium text-base-foreground">Release</span>
              <div class="flex items-center gap-3">
                <span class="flex-1 text-ui text-subtle-foreground"
                  >Sign in to see your workspace's builds.</span
                >
                <Button size="sm" variant="secondary" @click="hostActions.signIn()">Sign in</Button>
              </div>
            </div>
            <div v-if="method !== 'remote'" class="mss-field">
              <span class="text-ui font-medium text-base-foreground">Hardware</span>
              <RadioGroupRoot v-model="hardware" class="grid grid-cols-2 gap-2">
                <RadioGroupItem
                  v-for="h in HARDWARE"
                  :key="h.value"
                  :value="h.value"
                  class="mss-radio"
                >
                  <span class="flex items-center justify-between gap-2">
                    <span class="text-ui font-medium text-base-foreground">{{ h.label }}</span>
                    <Badge v-if="h.value === 'mps'">Detected</Badge>
                  </span>
                  <span v-if="h.hint" class="text-ui text-subtle-foreground">{{ h.hint }}</span>
                </RadioGroupItem>
              </RadioGroupRoot>
            </div>
          </div>
        </div>
        <footer class="mar-wizard-foot mss-foot">
          <Button variant="ghost" size="lg" @click="discardChanges">Back</Button>
          <span class="mr-auto"></span>
          <Button
            v-if="method === 'remote'"
            variant="primary"
            size="lg"
            :disabled="!serverUrl"
            @click="toast(`Connecting to ${serverUrl}`)"
            >Connect</Button
          >
          <Button v-else variant="primary" size="lg" @click="flow.step = 'setup'">Done</Button>
        </footer>
      </template>

      <!-- Template: today's starter-workflow step, after Set up. -->
      <template v-else-if="flow.step === 'template'">
        <div :key="flow.step" class="mar-wizard-body mss-body">
          <DialogTitle as="h3" class="text-title font-semibold"
            >Choose a starter workflow</DialogTitle
          >
          <DialogDescription
            >Opens a ready-to-run workflow. Models download during setup.</DialogDescription
          >
          <div class="mss-pick-head">
            <MarSeg v-model="flow.tab" label="Workflow type" :options="TABS" />
          </div>
          <div class="mss-cards">
            <MediaCard
              v-for="s in STARTERS[flow.tab]"
              :key="s.id"
              ratio="4/3"
              :selected="flow.picked?.id === s.id"
              :aria-pressed="flow.picked?.id === s.id"
              class="mss-card"
              @click="pick(s)"
              @keydown.enter.prevent="pick(s)"
              @keydown.space.prevent="pick(s)"
            >
              <template #media>
                <img :src="imgUrl(s.img)" alt="" loading="lazy" class="mss-card-img" />
              </template>
              <template v-if="flow.picked?.id === s.id" #top-left>
                <span class="mss-card-check"><Check :size="12" :stroke-width="3" /></span>
              </template>
              <span class="line-clamp-2 text-ui font-medium text-base-foreground">{{
                s.title
              }}</span>
              <span class="text-ui tabular-nums text-subtle-foreground">{{
                s.credits ? 'No download' : `${s.gb} GB`
              }}</span>
            </MediaCard>
          </div>
          <Checkbox v-if="!flow.takeover" v-model="dontShowTemplates"
            >Don't show this template step again</Checkbox
          >
        </div>
        <footer class="mar-wizard-foot mss-foot">
          <Button variant="ghost" size="lg" class="mr-auto" @click="flow.step = 'setup'"
            >Back</Button
          >
          <Button size="lg" @click="installWith(null)">Skip &amp; Install</Button>
          <Button variant="primary" size="lg" @click="installWith(flow.picked)">Install</Button>
        </footer>
      </template>

      <!-- Installing: today's install wait. The scene of Comfy outputs at its
           own proportions with nothing over it, the Cloud pitch above it,
           progress below. Error: today's Operation failed, in place. -->
      <template v-else>
        <div :key="failed ? 'error' : 'installing'" class="mar-wizard-body mss-body">
          <DialogTitle as="h3" class="sr-only">{{
            failed ? 'Operation failed' : 'Installing ComfyUI'
          }}</DialogTitle>
          <section class="mss-prog" :class="failed ? 'is-err' : 'is-wait'">
            <div
              v-if="!failed"
              class="mss-pitch"
              role="region"
              :aria-label="say('installShowcase.label')"
            >
              <Transition name="mss-fade" mode="out-in">
                <p :key="showcase.card.value.id" class="mss-pitch-line">
                  <span class="text-base-foreground">{{ say(showcase.card.value.title) }}</span
                  ><span class="mss-pitch-sep" aria-hidden="true"></span
                  >{{ say(showcase.card.value.body) }}
                </p>
              </Transition>
              <Button size="sm" variant="ghost" @click="toast('Opening Comfy Cloud')"
                >{{ say('installShowcase.cloudCta') }}<ArrowRight :size="12"
              /></Button>
            </div>
            <div v-if="!failed" class="mss-scene" aria-hidden="true">
              <video
                v-for="c in CLIPS"
                :key="c.id"
                class="mss-clip"
                :class="`is-${c.id}`"
                :src="c.src"
                :poster="imgUrl(c.poster)"
                autoplay
                muted
                loop
                playsinline
              ></video>
            </div>
            <div class="mss-prog-head">
              <span class="mss-stage-title is-big">{{
                failed ? 'Operation failed' : 'Installing ComfyUI'
              }}</span>
              <span v-if="!failed" class="mss-stage-sub tabular-nums">{{ flow.percent }}%</span>
            </div>
            <div
              class="mss-bar"
              role="progressbar"
              :aria-valuenow="flow.percent"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-label="Install progress"
            >
              <i :style="{ width: flow.percent + '%' }"></i>
            </div>
            <div class="mss-steps-row">
              <ol class="mss-phases">
                <li
                  v-for="(p, i) in phases"
                  :key="p.label"
                  :data-phase="
                    i < phaseIndex ? 'done' : i === phaseIndex ? (failed ? 'fail' : 'now') : 'todo'
                  "
                >
                  <span class="mss-phase-node">
                    <Check v-if="i < phaseIndex" :size="11" :stroke-width="3" />
                    <TriangleAlert v-else-if="i === phaseIndex && failed" :size="11" />
                    <span v-else-if="i === phaseIndex" class="mss-phase-pulse"></span>
                  </span>
                  <span class="truncate">{{ p.label }}</span>
                </li>
              </ol>
              <button
                type="button"
                class="mss-logs-toggle"
                :aria-expanded="flow.logs"
                @click="flow.logs = !flow.logs"
              >
                <ChevronDown :size="14" :class="flow.logs && 'rotate-180'" />View logs
              </button>
            </div>
            <pre v-if="flow.logs || failed" class="mss-logs">
[setup] Installing torch==2.7.1 …
[setup] Downloading torch-2.7.1-cp313-macosx_arm64.whl (74 MB)<template v-if="failed">
<span class="e">ERROR: ConnectionResetError(54, 'Connection reset by peer')</span>
<span class="e">pip exited with code 2</span></template></pre>
            <Button v-if="failed" size="sm" class="self-start" @click="toast('Copied')"
              ><Copy :size="14" />Copy</Button
            >
          </section>
        </div>

        <footer class="mar-wizard-foot mss-foot">
          <template v-if="failed">
            <Button variant="ghost" size="lg" class="mr-auto" @click="backFromError">Back</Button>
            <Button variant="primary" size="lg" @click="retryInstall">Reboot</Button>
          </template>
          <template v-else-if="!flow.confirmCancel">
            <Button variant="ghost" size="lg" @click="flow.confirmCancel = true"
              ><ArrowLeft :size="14" />Return to Dashboard</Button
            >
          </template>
          <!-- Today's in-flight confirm: returning cancels the install. -->
          <template v-else>
            <span class="mr-auto grid text-ui">
              <span class="font-medium text-base-foreground">Cancel current operation?</span>
              <span class="text-subtle-foreground"
                >The operation will stop where it is. Anything not yet completed will be rolled back
                where possible.</span
              >
            </span>
            <Button variant="ghost" size="lg" @click="flow.confirmCancel = false">Cancel</Button>
            <Button variant="destructive" size="lg" @click="cancelInstall">Cancel operation</Button>
          </template>
        </footer>
      </template>
    </DialogContent>
  </DialogRoot>
</template>
