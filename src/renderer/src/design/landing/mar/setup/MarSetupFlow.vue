<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowLeft,
  ArrowLeftRight,
  Check,
  ChevronDown,
  Cloud,
  Copy,
  Cpu,
  HardDrive,
  LoaderCircle,
  Package,
  TriangleAlert,
  Users,
  Zap
} from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle, RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import ChoiceCard from '../../../../components/ChoiceCard.vue'
import RunOnCards from './RunOnCards.vue'
import SetupCanvas from './SetupCanvas.vue'
import SetupSteps from './SetupSteps.vue'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import Button from '../../ui/Button.vue'
import Checkbox from '../../ui/Checkbox.vue'
import DialogContent from '../../ui/DialogContent.vue'
import Input from '../../ui/Input.vue'
import MediaCard from '../../ui/MediaCard.vue'
import Select from '../../ui/Select.vue'
import MarSeg from '../pages/MarSeg.vue'
import en from '@locales/en.json'
import { PORTAL_TO } from '../../ui/portal'
import { hostActions, toast } from '../../useProto'
import {
  DETECTED,
  STARTERS,
  backFromError,
  canvas,
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
import SetupLaptop from './SetupLaptop.vue'
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
// Continue is always on: without the terms it points at them instead.
const termsAsk = ref(false)
function continueFirst(): void {
  if (!terms.value) termsAsk.value = true
  else if (runOn.value === 'cloud') chooseCloud()
  else if (express.value && !unsupported.value) installWith(null)
  else chooseLocal()
}

// Today's estimate: the download, unpacked, takes about 2.25 times its size.
const REQUIRED_GB = (DETECTED.downloadGb * 2.25).toFixed(1)

// Set up › Install: low space asks first, as today, then the install. The
// starter workflow is no longer a step here: the Home offers them after the
// install, each marked Local (with its download) or Cloud (StarterShelf.vue).
function continueSetup(): void {
  if (lowSpace.value) flow.confirmLowDisk = true
  else toTemplates()
}
function toTemplates(): void {
  flow.confirmLowDisk = false
  installWith(null)
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
// The install wait's outputs: today's showcase clips, one at a time in a
// single panel.
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
// Remote Connection isn't a source of ComfyUI, so it's a link under the form.
const SOURCES = [
  { value: 'public' as const, label: 'Official release', meta: 'Public builds', icon: Package },
  {
    value: 'managed' as const,
    label: "Your team's builds",
    meta: 'Managed builds',
    icon: Users
  }
]
const serverUrl = ref('')
const version = ref(DETECTED.version)
const VERSIONS = [
  { value: DETECTED.version, label: DETECTED.version, hint: 'Latest stable' },
  { value: 'v0.42.3', label: 'v0.42.3' },
  { value: 'v0.42.2', label: 'v0.42.2' }
]

// Discard leaves Change setup as it found it; Save keeps the edits.
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
  { value: 'mps' as const, label: DETECTED.build, meta: 'Detected', icon: Zap },
  { value: 'cpu' as const, label: 'CPU', meta: 'No GPU acceleration', icon: Cpu }
]
const pickedHardware = computed(
  () => HARDWARE[hardware.value === 'cpu' ? 1 : 0] as (typeof HARDWARE)[number]
)

// The install wait's Cloud pitch, in the product's own strings.
const say = (key: string): string =>
  key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en) as string

const failed = computed(() => flow.step === 'error')

// Like today's stepper: no overall percent, since the whole install can't be
// timed. Only the download knows its size, so only it gets a detail line.
const nowIndex = computed(() => (phaseIndex.value < 0 ? phases.length - 1 : phaseIndex.value))
const DOWNLOAD_MB = Math.round(DETECTED.downloadGb * 1000)
const DOWNLOAD_SPEED = 18
const stepDetail = computed(() => {
  if (failed.value || nowIndex.value !== 0) return ''
  const mb = Math.round((flow.percent / phases[0].until) * DOWNLOAD_MB)
  const left = Math.max(1, Math.round((DOWNLOAD_MB - mb) / DOWNLOAD_SPEED))
  return `${mb} of ${DOWNLOAD_MB} MB · about ${left}s left`
})
const downloadPct = computed(() => Math.min(100, (flow.percent / phases[0].until) * 100))
function rowState(i: number): string {
  if (i < nowIndex.value) return 'is-done'
  if (i > nowIndex.value) return 'is-next'
  return failed.value ? 'is-fail' : 'is-now'
}
</script>

<template>
  <Teleport v-if="canvas" :to="PORTAL_TO"><SetupCanvas /></Teleport>
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
          <div v-if="!failed" class="mss-ambient"></div>
          <ComfyCLogo class="mss-first-mark" />
          <SetupSteps :now="1" />
          <div class="mss-col">
            <div class="mss-first-hero">
              <h1 id="mss-first-title" class="mss-first-title">How do you want to run Comfy?</h1>
              <p class="mss-first-lead">
                Choose the setup that fits how you work. You can switch later.
              </p>
              <!-- The Home's media cards (RunOnCards), or Desktop's own
                 ChoiceCard as on today's first screen. -->
              <RunOnCards
                v-if="localSetup.cards !== 'today'"
                v-model="runOn"
                :variant="localSetup.cards"
              />
              <div
                v-else
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
                  description="Best for **powerful GPUs** and popular custom nodes, ready anywhere."
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
                    <span class="mss-first-hint" :class="!express && 'is-off'"
                      >Detected: {{ DETECTED.build }} - if that's not your hardware, uncheck
                      Express</span
                    ></span
                  >
                </label>
              </div>
            </div>
            <div class="mss-first-bottom">
              <!-- Consent, one group at the foot of the screen: the terms
                 first, the one that gates, then usage data and beta, on by
                 default as today. -->
              <div class="mss-first-consent">
                <label class="mss-check mss-terms" :class="termsAsk && !terms && 'is-ask'">
                  <Checkbox v-model="terms" />
                  <span class="grid"
                    ><span
                      >I agree to the <a href="#" class="mss-link" @click.prevent>EULA</a> and
                      <a href="#" class="mss-link" @click.prevent>Terms of Service</a>.</span
                    ><span v-if="termsAsk && !terms" class="mss-terms-ask" role="alert"
                      >Agree to continue.</span
                    ></span
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
              <Button variant="primary" size="lg" @click="continueFirst">Continue</Button>
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
      <div class="mss-first-frame">
        <div v-if="!failed" class="mss-ambient"></div>
        <ComfyCLogo class="mss-first-mark" />
        <SetupSteps :now="flow.step === 'setup' || flow.step === 'change' ? 2 : 3" />
      </div>
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

            <!-- The machine it checked, drawn large: the subject of the
                 screen. What it gets is the list below. -->
            <div class="mss-machine is-hero">
              <SetupLaptop />
              <span class="grid min-w-0">
                <span class="mss-machine-kicker"
                  ><Check :size="11" :stroke-width="3" />Detected</span
                >
                <span class="mss-machine-title">{{ DETECTED.chip }}</span>
                <span class="mss-row-meta">{{ DETECTED.memGb }} GB memory</span>
              </span>
            </div>

            <!-- What gets installed: one grouped list, as the Home's settings,
                 each row with its own Change. Only a problem gets a mark. -->
            <dl class="mss-summary" aria-label="Install summary">
              <div class="mss-row is-change">
                <dt><Zap :size="15" />Hardware</dt>
                <dd>
                  <span class="text-base-foreground">{{ pickedHardware.label }}</span>
                  <span class="mss-row-meta">{{ pickedHardware.meta }}</span>
                </dd>
                <Button size="sm" variant="secondary" @click="changeSetup">Change</Button>
              </div>
              <div class="mss-row is-change" :class="lowSpace && 'is-bad'">
                <dt><HardDrive :size="15" />Location</dt>
                <dd>
                  <span class="truncate text-base-foreground">{{ where }}</span>
                  <span class="mss-row-meta"
                    ><TriangleAlert v-if="lowSpace" :size="13" aria-label="Low Disk Space" />{{
                      freeLabel(free)
                    }}
                    free · ~{{ REQUIRED_GB }} GB required</span
                  >
                </dd>
                <Button size="sm" variant="secondary" @click="changeSetup">Change</Button>
              </div>
              <div class="mss-row is-change">
                <dt><Package :size="15" />Version</dt>
                <dd>
                  <span class="text-base-foreground">ComfyUI {{ DETECTED.version }} · Stable</span>
                  <span class="mss-row-meta">{{ DETECTED.downloadGb }} GB download</span>
                </dd>
                <Button size="sm" variant="secondary" @click="changeSetup">Change</Button>
              </div>
              <!-- Migrate, ticked on the first screen: today's migrate op. -->
              <div
                v-if="localSetup.machine === 'legacy' && flow.bringOver"
                class="mss-row is-change"
              >
                <dt><ArrowLeftRight :size="15" />Migrate</dt>
                <dd>
                  <span class="text-base-foreground">Workflows, models, and settings</span>
                  <span class="mss-row-meta">From your existing ComfyUI instance</span>
                </dd>
                <span></span>
              </div>
            </dl>
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
            <div class="mss-machine is-bad">
              <SetupLaptop bad />
              <span class="mss-machine-title">Intel processor</span>
            </div>
          </template>
        </div>
        <footer class="mar-wizard-foot mss-foot">
          <Button v-if="flow.takeover" variant="ghost" size="lg" @click="flow.step = 'first'"
            ><ArrowLeft :size="14" />Back</Button
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
            <span v-if="!unsupported" class="mss-foot-sum tabular-nums"
              >{{ DETECTED.downloadGb }} GB download · ~{{ REQUIRED_GB }} GB required</span
            >
            <Button v-if="unsupported" size="lg" @click="changeSetup">Change</Button>
            <Button v-else variant="primary" size="lg" @click="continueSetup">Install</Button>
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
          <!-- A settings sheet: label on the left, control on the right,
               a hairline between rows. Picks are radio cards. -->
          <div v-if="method !== 'remote'" class="mss-form">
            <div class="mss-form-row">
              <span id="mss-from" class="mss-form-label">Get ComfyUI from</span>
              <RadioGroupRoot v-model="method" class="mss-opts" aria-labelledby="mss-from">
                <RadioGroupItem
                  v-for="m in SOURCES"
                  :key="m.value"
                  :value="m.value"
                  class="mss-opt"
                >
                  <span class="mss-opt-icon"><component :is="m.icon" :size="16" /></span>
                  <span class="mss-opt-text">
                    <span class="mss-opt-name">{{ m.label }}</span>
                    <span class="mss-opt-meta">{{ m.meta }}</span>
                  </span>
                  <span class="mss-opt-dot" aria-hidden="true"></span>
                </RadioGroupItem>
              </RadioGroupRoot>
            </div>
            <div v-if="method === 'managed'" class="mss-form-row">
              <span class="mss-form-label">Release</span>
              <div class="mss-form-note">
                <span>Sign in to see your workspace's builds.</span>
                <Button size="sm" variant="secondary" @click="hostActions.signIn()">Sign in</Button>
              </div>
            </div>
            <div v-else class="mss-form-row">
              <span class="mss-form-label">Release</span>
              <div class="flex flex-wrap items-center gap-2">
                <MarSeg v-model="channel" label="Release" :options="CHANNELS" />
                <Select
                  v-if="channel === 'stable'"
                  v-model="version"
                  label="ComfyUI"
                  :options="VERSIONS"
                />
              </div>
            </div>
            <div class="mss-form-row">
              <span class="mss-form-label">Name</span>
              <Input v-model="name" aria-label="Name" />
            </div>
            <div class="mss-form-row">
              <span class="mss-form-label">Location</span>
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
            <div class="mss-form-row">
              <span id="mss-hw" class="mss-form-label">Hardware</span>
              <RadioGroupRoot v-model="hardware" class="mss-opts" aria-labelledby="mss-hw">
                <RadioGroupItem
                  v-for="h in HARDWARE"
                  :key="h.value"
                  :value="h.value"
                  class="mss-opt"
                >
                  <span class="mss-opt-icon"><component :is="h.icon" :size="16" /></span>
                  <span class="mss-opt-text">
                    <span class="mss-opt-name">{{ h.label }}</span>
                    <span class="mss-opt-meta">{{ h.meta }}</span>
                  </span>
                  <span class="mss-opt-dot" aria-hidden="true"></span>
                </RadioGroupItem>
              </RadioGroupRoot>
            </div>
            <p class="mss-form-aside">
              Already running ComfyUI on another machine?
              <button type="button" class="mss-link" @click="method = 'remote'">
                Connect to a server instead
              </button>
            </p>
          </div>

          <!-- Remote Connection: today's third method, behind the link. -->
          <div v-else class="mss-form">
            <div class="mss-form-row">
              <span class="mss-form-label">Server URL</span>
              <Input
                v-model="serverUrl"
                placeholder="http://192.168.1.20:8188"
                aria-label="Server URL"
              />
            </div>
            <div class="mss-form-row">
              <span class="mss-form-label">Name</span>
              <Input v-model="name" aria-label="Name" />
            </div>
            <p class="mss-form-aside">
              <button type="button" class="mss-link" @click="method = 'public'">
                Install on this Mac instead
              </button>
            </p>
          </div>
        </div>
        <footer class="mar-wizard-foot mss-foot">
          <Button variant="ghost" size="lg" @click="discardChanges">Discard changes</Button>
          <span class="mr-auto"></span>
          <Button
            v-if="method === 'remote'"
            variant="primary"
            size="lg"
            :disabled="!serverUrl"
            @click="toast(`Connecting to ${serverUrl}`)"
            >Connect</Button
          >
          <Button v-else variant="primary" size="lg" @click="flow.step = 'setup'"
            >Save changes</Button
          >
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
            ><ArrowLeft :size="14" />Back</Button
          >
          <Button size="lg" @click="installWith(null)">Skip &amp; Install</Button>
          <Button variant="primary" size="lg" @click="installWith(flow.picked)">Install</Button>
        </footer>
      </template>

      <!-- Installing: the status first, then today's scene of Comfy outputs.
           The Cloud pitch is one line in the bar. Error: today's Operation
           failed, in place. -->
      <template v-else>
        <div :key="failed ? 'error' : 'installing'" class="mar-wizard-body mss-body">
          <DialogTitle as="h3" class="sr-only">{{
            failed ? 'Operation failed' : 'Installing ComfyUI'
          }}</DialogTitle>
          <!-- Status on the left: today's five steps, all in view, the
               running one open with its detail. On the right one calm panel:
               today's showcase clips, one at a time, in place of the scene. -->
          <section class="mss-inst" :class="failed && 'is-err'">
            <div class="mss-inst-main">
              <span class="mss-inst-count tabular-nums"
                >Step {{ nowIndex + 1 }} of {{ phases.length }}</span
              >
              <span class="mss-stage-title is-big">{{
                failed ? 'Operation failed' : 'Installing ComfyUI'
              }}</span>
              <ol class="mss-inst-steps" aria-live="polite">
                <li
                  v-for="(p, i) in phases"
                  :key="p.label"
                  class="mss-inst-step"
                  :class="rowState(i)"
                  :aria-current="i === nowIndex ? 'step' : undefined"
                >
                  <span class="mss-inst-icon" aria-hidden="true">
                    <Check v-if="i < nowIndex" :size="12" stroke-width="3" />
                    <TriangleAlert v-else-if="i === nowIndex && failed" :size="13" />
                    <LoaderCircle v-else-if="i === nowIndex" :size="14" class="mss-spin" />
                  </span>
                  <span class="mss-inst-text">
                    <!-- Only the download knows its size: it gets a percent
                         by its name and one quiet line of detail. -->
                    <span class="mss-inst-label"
                      >{{ p.label
                      }}<span v-if="i === nowIndex && stepDetail" class="mss-inst-pct tabular-nums"
                        >{{ Math.round(downloadPct) }}%</span
                      ></span
                    >
                    <span
                      v-if="i === nowIndex && stepDetail"
                      class="mss-inst-detail tabular-nums"
                      >{{ stepDetail }}</span
                    >
                  </span>
                </li>
              </ol>
              <button
                type="button"
                class="mss-logs-toggle justify-self-start"
                :aria-expanded="flow.logs"
                @click="flow.logs = !flow.logs"
              >
                <ChevronDown :size="14" :class="flow.logs && 'rotate-180'" />View logs
              </button>
              <pre v-if="flow.logs || failed" class="mss-logs">
[setup] Installing torch==2.7.1 …
[setup] Downloading torch-2.7.1-cp313-macosx_arm64.whl (74 MB)<template v-if="failed">
<span class="e">ERROR: ConnectionResetError(54, 'Connection reset by peer')</span>
<span class="e">pip exited with code 2</span></template></pre>
              <Button v-if="failed" size="sm" class="justify-self-start" @click="toast('Copied')"
                ><Copy :size="14" />Copy</Button
              >
            </div>
            <div v-if="!failed" class="mss-inst-media" aria-hidden="true">
              <video
                v-for="(c, i) in CLIPS"
                :key="c.id"
                :style="{ animationDelay: `${i * 6}s` }"
                :src="c.src"
                :poster="imgUrl(c.poster)"
                autoplay
                muted
                loop
                playsinline
              ></video>
            </div>
          </section>
        </div>

        <footer class="mar-wizard-foot mss-foot">
          <template v-if="failed">
            <Button variant="ghost" size="lg" class="mr-auto" @click="backFromError"
              ><ArrowLeft :size="14" />Back</Button
            >
            <Button variant="primary" size="lg" @click="retryInstall">Reboot</Button>
          </template>
          <template v-else-if="!flow.confirmCancel">
            <p class="mss-pitch" role="region" :aria-label="say('installShowcase.label')">
              <Cloud :size="14" class="shrink-0" />
              <b class="mss-pitch-line">{{ say('installShowcase.cloud.title') }}</b>
              <button type="button" class="mss-link" @click="toast('Opening Comfy Cloud')">
                {{ say('installShowcase.cloudCta') }}
              </button>
            </p>
            <Button
              v-if="flow.takeover"
              variant="ghost"
              size="lg"
              @click="flow.confirmCancel = true"
              >Cancel install</Button
            >
            <Button v-else variant="ghost" size="lg" @click="flow.confirmCancel = true"
              ><ArrowLeft :size="14" />Return to Dashboard</Button
            >
          </template>
          <!-- Today's in-flight confirm: returning cancels the install. -->
          <template v-else>
            <span class="mr-auto grid text-ui">
              <span class="font-medium text-base-foreground">Cancel current operation?</span>
              <span class="text-subtle-foreground"
                >Unfinished steps are rolled back where possible.</span
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
