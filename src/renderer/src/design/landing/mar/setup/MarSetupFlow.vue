<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowDownToLine,
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Cloud,
  Copy,
  FolderOpen,
  HardDrive,
  History,
  Laptop,
  Package,
  SlidersHorizontal,
  TriangleAlert,
  X
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
import { cn } from '../../ui/cn'
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
  dismissReady,
  fits,
  flow,
  localSetup,
  lowSpace,
  openReady,
  phaseIndex,
  phases,
  retryInstall,
  setupOn,
  startInstall,
  toBackground,
  toForeground,
  unsupported,
  type Starter
} from './setupFlow'
import SetupBloom from './SetupBloom.vue'
import './setup.css'

/**
 * Mar's proposed local setup (UI Playground › Local setup › Proposal), in
 * her step-modal family (New space): one smoked-glass modal over the app,
 * the content, then a footer bar with the actions. Set up shows what the
 * checks found and installs in one click; the install shows its progress
 * with the workflow pick in the wait. Copy is the product's, in English.
 */
const open = computed({
  get: () => setupOn.value && flow.open && flow.step !== 'first',
  set: (v: boolean) => {
    if (!v) closeSetup()
  }
})

const imgUrl = (f: string): string => new URL(`../assets/${f}`, import.meta.url).href

const where = computed(() =>
  flow.movedDisk ? `/Volumes/${DETECTED.otherDisk.name}/ComfyUI` : DETECTED.path
)
const free = computed(() =>
  flow.movedDisk ? DETECTED.otherDisk.freeGb : lowSpace.value ? DETECTED.lowFreeGb : DETECTED.freeGb
)
const freeLabel = (gb: number): string => (gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${gb} GB`)

// First launch, as shipped today: Local picked, terms off until ticked,
// usage data and beta on. Consent is asked here once, not in Set up. No
// Express Install: Set up is already the one-click path, with what it will
// install in view.
const firstOpen = computed(() => setupOn.value && flow.open && flow.step === 'first')
const runOn = ref<'cloud' | 'local'>('local')
const terms = ref(false)
const usage = ref(true)
const beta = ref(true)
function continueFirst(): void {
  if (runOn.value === 'cloud') chooseCloud()
  else chooseLocal()
}

// Today's estimate: the download, unpacked, takes about 2.25 times its size.
const REQUIRED_GB = (DETECTED.downloadGb * 2.25).toFixed(1)

const canInstall = computed(() => !lowSpace.value && !unsupported.value)

// Intel Mac: pick the way to run it, then one action follows the pick.
const intelWay = ref<'cloud' | 'server'>('cloud')
function continueIntel(): void {
  if (intelWay.value === 'cloud') hostActions.signIn()
  else toast('Connect: enter the server address')
}

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
  { value: 'mps' as const, label: DETECTED.build, hint: `Matches your ${DETECTED.chip}` },
  { value: 'cpu' as const, label: 'CPU only', hint: 'Slow. For testing.' }
]

const TABS = [
  { value: 'image' as const, label: 'Image' },
  { value: 'video' as const, label: 'Video' },
  { value: '3d' as const, label: '3D' },
  { value: 'audio' as const, label: 'Audio' }
]

function pick(s: Starter): void {
  if (!fits(s)) return
  flow.picked = flow.picked?.id === s.id ? null : s
}
const sizeOf = (s: Starter): string => (s.credits ? 'No download' : `${s.gb} GB of models`)
const freeAfter = computed(() =>
  Math.round(free.value - DETECTED.downloadGb - (flow.picked?.gb ?? 0))
)

const failed = computed(() => flow.step === 'error')
</script>

<template>
  <!-- Background install: a quiet pill, the install keeps going. When it
       finishes it turns into a ready pill and waits: opening ComfyUI on
       its own would take the window from whatever the user is doing. -->
  <Teleport :to="PORTAL_TO">
    <Transition name="mss-pill" mode="out-in">
      <div
        v-if="setupOn && flow.background && flow.ready"
        key="ready"
        class="proto-ui mss-pill-wrap"
        role="status"
      >
        <div class="mss-pill is-ready">
          <span class="mss-pill-done" aria-hidden="true"><Check :size="13" stroke-width="2.5" /></span>
          <span class="flex flex-col text-left">
            <span class="text-ui font-medium text-base-foreground">ComfyUI is ready</span>
            <span class="text-ui text-subtle-foreground">{{
              flow.picked ? `Opens ${flow.picked.title}` : 'Opens a blank canvas'
            }}</span>
          </span>
          <Button size="sm" variant="primary" class="ml-2" @click="openReady">Open</Button>
          <button type="button" class="mss-pill-x" aria-label="Dismiss" @click="dismissReady">
            <X :size="14" />
          </button>
        </div>
      </div>
      <div
        v-else-if="setupOn && flow.background && flow.running"
        key="running"
        class="proto-ui mss-pill-wrap"
      >
        <button type="button" class="mss-pill" aria-label="Show the install" @click="toForeground">
          <span class="mss-pill-ring" :style="{ '--p': flow.percent }" aria-hidden="true"></span>
          <span class="flex flex-col text-left">
            <span class="text-ui font-medium text-base-foreground tabular-nums"
              >Installing ComfyUI · {{ flow.percent }}%</span
            >
            <span class="text-ui text-subtle-foreground">You can keep working</span>
          </span>
        </button>
      </div>
    </Transition>
  </Teleport>

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
            <!-- Migrate is a Local option; it keeps its room while Cloud is
                 picked, so switching cards doesn't move the screen. -->
            <div
              v-if="localSetup.machine === 'legacy'"
              class="mss-first-mods"
              :class="runOn !== 'local' && 'is-off'"
              :aria-hidden="runOn !== 'local'"
            >
              <label class="mss-check">
                <Checkbox v-model="flow.bringOver" />
                <span
                  ><span class="text-base-foreground">Migrate existing instance</span>
                  <span class="mss-first-hint"
                    >Bring over <b>workflows, models, and settings</b> from your existing ComfyUI
                    instance.</span
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
      <!-- New Instance, when ComfyUI already runs here: every way in. -->
      <template v-if="flow.step === 'chooser'">
        <div :key="flow.step" class="mar-wizard-body mss-body">
          <DialogTitle as="h3" class="text-title font-semibold">New Instance</DialogTitle>
          <DialogDescription>Add another place to run ComfyUI.</DialogDescription>
          <div class="mss-opts">
            <button type="button" class="mss-opt" @click="flow.step = 'setup'">
              <span class="mss-opt-icon is-bloom"><ArrowDownToLine :size="18" /></span>
              <span class="mss-opt-text">
                <span class="text-ui font-medium text-base-foreground">Install ComfyUI</span>
                <span class="text-ui text-subtle-foreground"
                  >Set up for your {{ DETECTED.chip }}. {{ DETECTED.downloadGb }} GB.</span
                >
              </span>
              <ChevronRight :size="16" class="mss-opt-arrow" />
            </button>
            <button
              type="button"
              class="mss-opt"
              @click="toast('Add a folder: pick an existing ComfyUI folder')"
            >
              <span class="mss-opt-icon"><FolderOpen :size="18" /></span>
              <span class="mss-opt-text">
                <span class="text-ui font-medium text-base-foreground"
                  >Add a folder you already have</span
                >
                <span class="text-ui text-subtle-foreground"
                  >Use an existing ComfyUI install without reinstalling it.</span
                >
              </span>
              <ChevronRight :size="16" class="mss-opt-arrow" />
            </button>
            <button type="button" class="mss-opt" @click="toast('Restore: drop a snapshot .json')">
              <span class="mss-opt-icon"><History :size="18" /></span>
              <span class="mss-opt-text">
                <span class="text-ui font-medium text-base-foreground"
                  >Restore from a snapshot</span
                >
                <span class="text-ui text-subtle-foreground"
                  >Rebuild an instance from a saved .json snapshot.</span
                >
              </span>
              <ChevronRight :size="16" class="mss-opt-arrow" />
            </button>
            <button
              type="button"
              class="mss-opt"
              @click="toast('Connect: enter the server address')"
            >
              <span class="mss-opt-icon"><ArrowLeftRight :size="18" /></span>
              <span class="mss-opt-text">
                <span class="text-ui font-medium text-base-foreground">Connect to a server</span>
                <span class="text-ui text-subtle-foreground"
                  >ComfyUI running on another computer or on your network.</span
                >
              </span>
              <ChevronRight :size="16" class="mss-opt-arrow" />
            </button>
          </div>
        </div>
      </template>

      <!-- Set up: the checks already ran, one Install. -->
      <template v-else-if="flow.step === 'setup'">
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
                  <span class="mss-chip" :class="lowSpace ? 'is-bad' : 'is-ok'">
                    <TriangleAlert v-if="lowSpace" :size="12" />
                    <Check v-else :size="12" :stroke-width="2.5" />{{
                      lowSpace ? 'One thing to fix before installing' : 'Ready to install'
                    }}
                  </span>
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

            <section
              class="mss-tiles"
              :aria-label="lowSpace ? 'One thing to fix' : 'Ready to install'"
            >
              <div class="mss-tile" :class="lowSpace && 'is-bad'">
                <span class="mss-tile-icon"><HardDrive :size="16" /></span>
                <span class="mss-sum-val">
                  <span class="mss-sum-key">Location</span>
                  <span class="truncate">{{ where }}</span>
                  <span v-if="!lowSpace" class="text-subtle-foreground"
                    >{{ freeLabel(free) }} free{{
                      flow.movedDisk ? ` on ${DETECTED.otherDisk.name}` : ''
                    }}</span
                  >
                  <span v-else class="text-status-danger"
                    >Only {{ DETECTED.lowFreeGb }} GB free. The install needs
                    {{ DETECTED.downloadGb }} GB, plus room for models.</span
                  >
                  <span v-if="lowSpace" class="mss-fix">
                    <Button size="sm" variant="secondary" @click="flow.movedDisk = true"
                      ><HardDrive :size="14" />Install on {{ DETECTED.otherDisk.name }} ·
                      {{ freeLabel(DETECTED.otherDisk.freeGb) }} free</Button
                    >
                    <Button size="sm" variant="ghost" @click="changeSetup">Choose a folder…</Button>
                  </span>
                </span>
                <TriangleAlert
                  v-if="lowSpace"
                  :size="16"
                  class="mss-bad"
                  aria-label="Needs a fix"
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

          <!-- Intel Mac: no local install, so the way forward is here. -->
          <template v-else>
            <DialogTitle as="h3" class="text-title font-semibold"
              >ComfyUI can't run on this Mac</DialogTitle
            >
            <DialogDescription
              >It needs a Mac with Apple Silicon (M1 or later). This Mac has an Intel
              processor.</DialogDescription
            >
            <div class="mss-stage is-short">
              <SetupBloom tone="err" />
              <div class="mss-stage-ui">
                <div class="mss-stage-subject">
                  <span class="mss-stage-glyph"><Laptop :size="20" /></span>
                  <span class="mss-stage-title">Intel processor</span>
                  <span class="mss-chip is-bad ml-auto"
                    ><TriangleAlert :size="12" />Not supported</span
                  >
                </div>
              </div>
            </div>
            <RadioGroupRoot v-model="intelWay" class="mss-opts" aria-label="Run ComfyUI">
              <RadioGroupItem value="cloud" class="mss-opt">
                <span class="mss-opt-icon is-cloud"><Cloud :size="18" /></span>
                <span class="mss-opt-text">
                  <span class="flex items-center gap-2">
                    <span class="text-ui font-medium text-base-foreground">Comfy Cloud</span>
                    <Badge>For this Mac</Badge>
                  </span>
                  <span class="text-ui text-subtle-foreground"
                    >Nothing to install. Runs on our GPUs.</span
                  >
                </span>
                <span class="mss-opt-radio"></span>
              </RadioGroupItem>
              <RadioGroupItem value="server" class="mss-opt">
                <span class="mss-opt-icon"><ArrowLeftRight :size="18" /></span>
                <span class="mss-opt-text">
                  <span class="text-ui font-medium text-base-foreground">Connect to a server</span>
                  <span class="text-ui text-subtle-foreground"
                    >Already run ComfyUI on another machine? Use this Mac as the screen.</span
                  >
                </span>
                <span class="mss-opt-radio"></span>
              </RadioGroupItem>
            </RadioGroupRoot>
          </template>
        </div>
        <footer class="mar-wizard-foot mss-foot">
          <Button v-if="flow.takeover" variant="ghost" size="lg" @click="flow.step = 'first'"
            >Back</Button
          >
          <span class="flex-1 text-ui text-subtle-foreground">{{
            unsupported ? '' : `${freeLabel(free)} free · ~${REQUIRED_GB} GB required`
          }}</span>
          <Button
            v-if="!unsupported"
            variant="primary"
            size="lg"
            :disabled="!canInstall"
            @click="startInstall"
            >Install</Button
          >
          <Button v-else variant="primary" size="lg" @click="continueIntel">{{
            intelWay === 'cloud' ? 'Continue with Cloud' : 'Connect to a server…'
          }}</Button>
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
                  <span class="text-ui text-subtle-foreground">{{ h.hint }}</span>
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

      <!-- Installing, with the workflow pick in the wait; Error, in place. -->
      <template v-else>
        <div :key="failed ? 'error' : 'installing'" class="mar-wizard-body mss-body">
          <DialogTitle as="h3" class="sr-only">{{
            failed ? 'The install stopped' : 'Installing ComfyUI'
          }}</DialogTitle>
          <section class="mss-prog" :class="failed && 'is-err'">
            <!-- The bloom resolves with the install, toward what opens first. -->
            <div class="mss-stage is-tall">
              <SetupBloom
                :resolve="flow.percent / 100"
                :src="flow.picked ? imgUrl(flow.picked.img) : undefined"
                :tone="failed ? 'err' : 'idle'"
              />
              <div class="mss-stage-ui">
                <div class="mss-stage-top">
                  <Transition name="mss-fade" mode="out-in">
                    <span v-if="!failed" :key="flow.picked?.id ?? 'blank'" class="mss-chip">{{
                      flow.picked ? `Opens with ${flow.picked.title}` : 'Opens with a blank canvas'
                    }}</span>
                  </Transition>
                </div>
                <div class="mss-stage-foot">
                  <div class="mss-prog-head">
                    <span class="mss-stage-title is-big">{{
                      failed ? 'The install stopped' : 'Installing ComfyUI'
                    }}</span>
                    <span v-if="!failed" class="mss-stage-sub tabular-nums"
                      >{{ flow.percent }}%</span
                    >
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
                </div>
              </div>
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
                  <span class="truncate"
                    >{{ p.label }}{{ i === 0 ? ` · ${DETECTED.downloadGb} GB` : '' }}</span
                  >
                </li>
              </ol>
              <button
                v-if="!failed"
                type="button"
                class="mss-logs-toggle"
                :aria-expanded="flow.logs"
                @click="flow.logs = !flow.logs"
              >
                <ChevronDown :size="14" :class="flow.logs && 'rotate-180'" />{{
                  flow.logs ? 'Hide logs' : 'View logs'
                }}
              </button>
            </div>
            <pre v-if="flow.logs && !failed" class="mss-logs">
[setup] Installing torch==2.7.1 …
[setup] Downloading torch-2.7.1-cp313-macosx_arm64.whl (74 MB)</pre
            >
          </section>

          <!-- Error: what happened and what to do next. -->
          <template v-if="failed">
            <div class="mss-callout is-err" role="alert">
              <span class="mss-tile-icon"><TriangleAlert :size="16" /></span>
              <div class="grid gap-1">
                <p class="text-ui font-medium text-base-foreground">
                  The network connection dropped while downloading packages.
                </p>
                <p class="text-ui text-muted-foreground">Check that you are online, then retry.</p>
              </div>
            </div>
            <pre class="mss-logs">
[setup] Installing torch==2.7.1 …
[setup] Downloading torch-2.7.1-cp313-macosx_arm64.whl (74 MB)
<span class="e">ERROR: ConnectionResetError(54, 'Connection reset by peer')</span>
<span class="e">pip exited with code 2</span></pre>
          </template>

          <!-- The pick: optional, nothing chosen until you choose. -->
          <section v-else class="mss-pick" aria-labelledby="mss-pick-title">
            <!-- Title and tabs share one row; the lead runs under both. -->
            <div class="mss-pick-head">
              <h4 id="mss-pick-title" class="text-heading font-semibold text-base-foreground">
                While it installs, pick something to make first
              </h4>
              <MarSeg v-model="flow.tab" label="Workflow type" :options="TABS" />
              <p class="mss-pick-lead text-ui text-muted-foreground">
                ComfyUI opens as soon as it is ready. Models keep downloading in the background.
              </p>
            </div>
            <div class="mss-cards">
              <!-- Card corners as on Mar's pages: the check top-left, the
                   chip bottom-left. -->
              <MediaCard
                v-for="s in STARTERS[flow.tab]"
                :key="s.id"
                ratio="4/3"
                :selected="flow.picked?.id === s.id"
                :aria-pressed="flow.picked?.id === s.id"
                :aria-disabled="!fits(s) || undefined"
                :class="cn('mss-card', !fits(s) && 'is-nofit')"
                @click="pick(s)"
                @keydown.enter.prevent="pick(s)"
                @keydown.space.prevent="pick(s)"
              >
                <template #media>
                  <img :src="imgUrl(s.img)" alt="" loading="lazy" class="mss-card-img" />
                  <span v-if="s.tag || s.credits" class="mss-card-chip">
                    <Badge variant="overlay">{{ s.credits ? 'Uses credits' : s.tag }}</Badge>
                  </span>
                </template>
                <template v-if="flow.picked?.id === s.id" #top-left>
                  <span class="mss-card-check"><Check :size="12" :stroke-width="3" /></span>
                </template>
                <span class="line-clamp-2 text-ui font-medium text-base-foreground">{{
                  s.title
                }}</span>
                <span
                  class="text-ui tabular-nums"
                  :class="fits(s) ? 'text-subtle-foreground' : 'text-status-danger'"
                  >{{ fits(s) ? sizeOf(s) : `Needs ${s.gb} GB, not enough space` }}</span
                >
              </MediaCard>
            </div>
            <p class="text-ui text-subtle-foreground tabular-nums" aria-live="polite">
              <template v-if="flow.picked && !flow.picked.credits"
                >{{ freeAfter }} GB free on this disk after its models download.</template
              >
              <template v-else-if="!flow.picked"
                >Optional. Without a pick, it opens a blank canvas.</template
              >
            </p>
          </section>
        </div>

        <footer class="mar-wizard-foot mss-foot">
          <template v-if="failed">
            <Button variant="ghost" size="lg" class="mr-auto" @click="backFromError">Back</Button>
            <Button size="lg" @click="toast('Error details copied')"
              ><Copy :size="14" />Copy error details</Button
            >
            <Button variant="primary" size="lg" @click="retryInstall">Retry install</Button>
          </template>
          <template v-else-if="!flow.confirmCancel">
            <Button
              variant="ghost"
              size="lg"
              class="mr-auto text-status-danger hover:bg-status-danger/10 hover:text-status-danger"
              @click="flow.confirmCancel = true"
              >Cancel install</Button
            >
            <Button size="lg" @click="toBackground">Continue in background</Button>
          </template>
          <template v-else>
            <span class="mr-auto text-ui text-base-foreground">Cancel the install?</span>
            <Button variant="ghost" size="lg" @click="flow.confirmCancel = false"
              >Keep installing</Button
            >
            <Button variant="destructive" size="lg" @click="cancelInstall">Cancel install</Button>
          </template>
        </footer>
      </template>
    </DialogContent>
  </DialogRoot>
</template>
