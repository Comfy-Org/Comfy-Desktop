<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  ArrowLeftRight,
  Check,
  ChevronDown,
  Cloud,
  Copy,
  Cpu,
  Crown,
  Ellipsis,
  FolderArchive,
  Gpu,
  HardDrive,
  LoaderCircle,
  Package,
  SlidersHorizontal,
  TriangleAlert,
  Users,
  Zap
} from 'lucide-vue-next'
import {
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  RadioGroupItem,
  RadioGroupRoot
} from 'reka-ui'
import ChoiceCard from '../../../../components/ChoiceCard.vue'
import RunOnCards from './RunOnCards.vue'
import SetupCanvas from './SetupCanvas.vue'
import SetupCancelConfirm from './SetupCancelConfirm.vue'
import SetupNodes from './SetupNodes.vue'
import SetupSteps from './SetupSteps.vue'
import ComfyWordmark from '../../../../components/icons/ComfyWordmark.vue'
import Button from '../../ui/Button.vue'
import Checkbox from '../../ui/Checkbox.vue'
import DialogContent from '../../ui/DialogContent.vue'
import DropdownMenuContent from '../../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../../ui/DropdownMenuItem.vue'
import DropdownMenuLabel from '../../ui/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../../ui/DropdownMenuSeparator.vue'
import Input from '../../ui/Input.vue'
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
  chooseCloud,
  chooseLocal,
  closeSetup,
  createBuild,
  flow,
  homeFirst,
  homeDirect,
  homeOneClick,
  homeRunning,
  installInBackground,
  landHomeCloud,
  landHomeInstalling,
  landHomeLocal,
  nextBuildName,
  localSetup,
  lowSpace,
  nodesInBuild,
  packsMb,
  phaseIndex,
  phases,
  retryInstall,
  setupOn,
  newBuildModal,
  startInstall,
  unsupported,
  type Starter,
  AFTER_INSTALLS,
  ONBOARDINGS
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
  get: () =>
    newBuildModal.value && flow.open && flow.step !== 'first' && !flow.arriving && !flow.landing,
  set: (v: boolean) => {
    if (!v) closeSetup()
  }
})

const where = computed(() => (flow.movedDisk ? DETECTED.otherPath : DETECTED.path))
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
// Continue is always on: without the terms it points at them instead.
const termsAsk = ref(false)
function continueFirst(): void {
  if (!terms.value) termsAsk.value = true
  // Home first: Run on is the only step, and Local lands on the Home with
  // the install waiting on its card; with the install running behind, Set up
  // still comes first.
  // Run on only: Local installs right away, unless the computer needs a
  // decision first; then the card waits in Builds with its Change.
  else if (homeDirect.value)
    (runOn.value === 'cloud'
      ? landHomeCloud
      : lowSpace.value || unsupported.value
        ? landHomeLocal
        : landHomeInstalling)()
  else if (homeFirst.value && !homeRunning.value)
    (runOn.value === 'cloud' ? landHomeCloud : landHomeLocal)()
  else if (homeFirst.value && runOn.value === 'cloud') landHomeCloud()
  else if (runOn.value === 'cloud') chooseCloud()
  else chooseLocal()
}

// Today's estimate: the download, unpacked, takes about 2.25 times its size.
const REQUIRED_GB = (DETECTED.downloadGb * 2.25).toFixed(1)

// Set up › Continue: low space asks first, as today. M1 has no Home, so the
// starter workflow stays a step here, as today. Once the Home exists it
// offers the apps on the Home instead (setup/HomeInstall.vue).
const workflowStep = computed(() => localSetup.scope === 'm1')
function continueSetup(): void {
  // One-click install: the consent sits on this screen; the terms gate.
  if (homeOneClick.value && flow.takeover && !terms.value) {
    termsAsk.value = true
    return
  }
  if (lowSpace.value) flow.confirmLowDisk = true
  else toTemplates()
}
// A new build, not the first install: its custom nodes come after Set up
// (UI Playground › Start › Custom nodes).
const nodesStep = computed(() => nodesInBuild.value && !flow.takeover && !flow.homeCard)
// The Home card's Edit packs: the same list, Done goes back to the card.
const nodesFromHome = computed(() => flow.homeCard && !flow.takeover)
function toTemplates(): void {
  flow.confirmLowDisk = false
  if (nodesStep.value) flow.step = 'nodes'
  else afterNodes()
}
function skipNodes(): void {
  flow.packs = []
  afterNodes()
}
function afterNodes(): void {
  if (workflowStep.value) flow.step = 'template'
  // Home first › Install runs behind: Install lands on the Home, installing.
  else if ((homeRunning.value || homeOneClick.value) && flow.takeover) landHomeInstalling()
  else installWith(null)
}
const stepNow = computed(() => {
  if (flow.step === 'setup' || flow.step === 'change') return 2
  return flow.step === 'template' || !workflowStep.value ? 3 : 4
})
const pickedGb = computed(() =>
  (DETECTED.downloadGb + (flow.picked?.credits ? 0 : (flow.picked?.gb ?? 0))).toFixed(1)
)
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
// Template pictures where the workflow has one; a stock photo otherwise.
const THUMBS = import.meta.glob<string>('../assets/templates/*.webp', {
  eager: true,
  import: 'default'
})
const starterImg = (s: Starter): string =>
  (s.thumb && THUMBS[`../assets/templates/${s.thumb}.webp`]) || imgUrl(s.img)
// Three to a tab, so the cards have Explore's room: the recommended one, a
// lighter one and the one that runs on credits.
const shownStarters = computed(() => {
  const all = STARTERS[flow.tab]
  return [...all.filter((s) => !s.credits).slice(0, 2), ...all.filter((s) => s.credits)]
})
// Today's card: the model's name over its task, split from the title.
const starterName = (s: Starter): string => s.title.split(': ')[0] ?? s.title
const starterTask = (s: Starter): string => s.title.split(': ')[1] ?? s.task ?? ''
// Today's disk check: a workflow whose models don't fit can't be installed.
const starterBlocked = computed(() => lowSpace.value && !!flow.picked && !flow.picked.credits)
function installWith(s: Starter | null): void {
  flow.picked = s
  // Home first: from the Home's card, the install goes back behind the Home.
  if (homeFirst.value && flow.homeCard && !flow.takeover) installInBackground()
  else startInstall()
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
// New build (every build after the first): its name, the next number
// unless renamed; Install closes the modal and installs in Builds.
const newBuild = computed(() => flow.step === 'setup' && !flow.takeover && !flow.homeCard)
const buildName = ref('')
watch(
  newBuild,
  (v) => {
    if (v) buildName.value = nextBuildName.value
  },
  { immediate: true }
)
const channel = ref<'stable' | 'latest'>('stable')
const hardware = ref<'mps' | 'cpu'>('mps')
// Today's install methods on a Mac (Portable is Windows only). Managed
// builds need a sign-in; a remote server needs only its address.
const method = ref<'public' | 'managed' | 'portable' | 'remote'>('public')
// Remote Connection isn't a source of ComfyUI, so it's a link under the form.
const SOURCES = computed(() => [
  { value: 'public' as const, label: 'Official release', meta: 'Public builds', icon: Package },
  {
    value: 'managed' as const,
    label: "Your team's builds",
    meta: 'Managed builds',
    icon: Users
  },
  // Today's Portable, in its own words; Windows only.
  ...(localSetup.os === 'windows'
    ? [
        {
          value: 'portable' as const,
          label: say('portable.label'),
          meta: say('portable.desc'),
          icon: FolderArchive
        }
      ]
    : [])
])
const serverUrl = ref('')
const version = ref(DETECTED.version)
const CPU_MB = 480
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
// Home first: the Home's card opens Change setup on its own, and on a first
// install it asks only what can be wrong for this computer: where it goes and
// which hardware. Source, release and name are New Build's.
const simple = computed(() => homeFirst.value && flow.homeCard && !flow.takeover)
watch(
  () => flow.open && flow.step === 'change',
  (on) => {
    if (on) saved = draft()
  }
)
function saveChanges(): void {
  if (simple.value) flow.open = false
  else flow.step = 'setup'
}
function discardChanges(): void {
  method.value = saved.method
  serverUrl.value = saved.serverUrl
  name.value = saved.name
  channel.value = saved.channel
  version.value = saved.version
  hardware.value = saved.hardware
  flow.movedDisk = saved.movedDisk
  saveChanges()
}
const CHANNELS = [
  { value: 'stable' as const, label: 'Stable' },
  { value: 'latest' as const, label: 'Latest on GitHub' }
]
// A computer with no GPU has one choice: the CPU it found.
// Each card says what today's does: ComfyUI, Python and the download, with
// Recommended on the one that fits. Python and the sizes are mock values.
const hardwareDetail = (mb: number): string => `ComfyUI ${version.value} · Python 3.12 · ${mb} MB`
const HARDWARE = computed(() =>
  DETECTED.build === 'CPU'
    ? [
        {
          value: 'mps' as const,
          label: 'CPU',
          meta: hardwareDetail(CPU_MB),
          summary: 'No GPU acceleration',
          recommended: true,
          icon: Cpu
        }
      ]
    : [
        {
          value: 'mps' as const,
          label: DETECTED.build,
          meta: hardwareDetail(Math.round(DETECTED.downloadGb * 1000)),
          summary: 'Detected',
          recommended: true,
          icon: Gpu
        },
        {
          value: 'cpu' as const,
          label: 'CPU',
          meta: hardwareDetail(CPU_MB),
          summary: 'No GPU acceleration',
          recommended: false,
          icon: Cpu
        }
      ]
)
const pickedHardware = computed(
  () => HARDWARE.value.find((h) => h.value === hardware.value) ?? HARDWARE.value[0]!
)

// The install wait's Cloud pitch, in the product's own strings.
const say = (key: string): string =>
  key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en) as string

// It rotates as production's showcase does (useShowcaseCarousel.ts): the
// nine cards in its order, one every 7 s, held while hovered or focused.
const PITCHES = ['cloud', 'gpu', 'models', 'partner', 'license', 'nodes', 'loras', 'queue', 'idle']
const PITCH_MS = 7000
const pitchAt = ref(0)
const pitchHeld = ref(false)
const pitch = computed(() => PITCHES[pitchAt.value % PITCHES.length])
let pitchTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  pitchTimer = setInterval(() => {
    if (flow.step === 'installing' && !pitchHeld.value) pitchAt.value++
  }, PITCH_MS)
})
onBeforeUnmount(() => clearInterval(pitchTimer))

const failed = computed(() => flow.step === 'error')

// Like today's stepper: no overall percent, since the whole install can't be
// timed. Only the download knows its size, so only it gets a detail line.
const nowIndex = computed(() => (phaseIndex.value < 0 ? phases.value.length - 1 : phaseIndex.value))
const DOWNLOAD_UNTIL = computed(() => phases.value[0]?.until ?? 100)
const DOWNLOAD_MB = Math.round(DETECTED.downloadGb * 1000)
const DOWNLOAD_SPEED = 18
const stepDetail = computed(() => {
  if (failed.value || nowIndex.value !== 0) return ''
  const mb = Math.round((flow.percent / DOWNLOAD_UNTIL.value) * DOWNLOAD_MB)
  const left = Math.max(1, Math.round((DOWNLOAD_MB - mb) / DOWNLOAD_SPEED))
  return `${mb} of ${DOWNLOAD_MB} MB · about ${left}s left`
})
const downloadPct = computed(() => Math.min(100, (flow.percent / DOWNLOAD_UNTIL.value) * 100))
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
        :class="homeFirst && !homeRunning && 'is-alone'"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mss-first-title"
      >
        <div class="mss-first-frame">
          <div v-if="!failed" class="mss-ambient"></div>
          <ComfyWordmark class="mss-first-mark" />
          <!-- Review only (not product): which version of the first launch
               this is, switchable here as in UI Playground › Local setup.
               Folded behind a dots button so the preview stays clean. -->
          <DropdownMenuRoot v-if="localSetup.scope === 'next'" :modal="false">
            <DropdownMenuTrigger as-child>
              <button type="button" class="mss-version" aria-label="Prototype version">
                <Ellipsis :size="16" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" class="mss-version-menu">
              <DropdownMenuLabel>Onboarding</DropdownMenuLabel>
              <DropdownMenuItem
                v-for="o in ONBOARDINGS"
                :key="o.value"
                @select="localSetup.onboarding = o.value"
              >
                <span class="flex-1">{{ o.label }}</span>
                <Check v-if="localSetup.onboarding === o.value" :size="14" />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>After the install</DropdownMenuLabel>
              <DropdownMenuItem
                v-for="a in AFTER_INSTALLS"
                :key="a.value"
                @select="localSetup.after = a.value"
              >
                <span class="flex-1">{{ a.label }}</span>
                <Check v-if="localSetup.after === a.value" :size="14" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuRoot>
          <SetupSteps
            v-if="!homeFirst || homeRunning"
            :now="1"
            :workflow="workflowStep"
            :short="homeRunning"
          />
          <div class="mss-col">
            <div class="mss-first-hero">
              <h1 id="mss-first-title" class="mss-first-title">How do you want to run ComfyUI?</h1>
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
                aria-label="How do you want to run ComfyUI?"
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
                  description="Best for **full manual control** of versions, custom nodes, and offline workflows."
                  @click="runOn = 'local'"
                />
              </div>
              <!-- Migrate is a Local option; it keeps its room while Cloud is
                 picked, so switching cards doesn't move the screen. No
                 Express: the hardware is detected up front, for everyone. -->
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
              <!-- Consent, one group at the foot of the screen: the terms
                 first, the one that gates, then usage data and beta, on by
                 default as today. -->
              <div class="mss-first-consent">
                <label class="mss-check mss-terms" :class="termsAsk && !terms && 'is-ask'">
                  <Checkbox v-model="terms" />
                  <!-- The nudge sits on the same line, so nothing on the
                     screen moves when it appears. -->
                  <span
                    >I agree to the <a href="#" class="mss-link" @click.prevent>EULA</a> and
                    <a href="#" class="mss-link" @click.prevent>Terms of Service</a>.<span
                      v-if="termsAsk && !terms"
                      class="mss-terms-ask"
                      role="alert"
                      >Agree to continue.</span
                    ></span
                  >
                </label>
                <label class="mss-check">
                  <Checkbox v-model="usage" />
                  <span
                    >Help improve ComfyUI by sharing anonymous usage data.
                    <a href="#" class="mss-link" @click.prevent>Learn more</a></span
                  >
                </label>
                <label class="mss-check">
                  <Checkbox v-model="beta" :disabled="!usage" />
                  <span>Opt-in to beta features and help test what ships next</span>
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
       frame, above the scrim, so the Home never shows behind them. The
       very first open starts with only the wordmark on it, centred. -->
  <Teleport :to="PORTAL_TO">
    <div
      v-if="(open || flow.arriving || flow.landing) && flow.takeover"
      class="proto-ui mss-first is-backdrop"
      :class="[homeOneClick && 'is-alone', flow.arriving && 'is-arriving']"
      aria-hidden="true"
    >
      <div class="mss-first-frame">
        <div v-if="!failed" class="mss-ambient"></div>
        <ComfyWordmark class="mss-first-mark" />
        <!-- The beat: one white glint across the mark. -->
        <ComfyWordmark v-if="flow.arriving" class="mss-first-mark mss-first-glint" />
        <SetupSteps
          v-if="!homeOneClick"
          :now="stepNow"
          :workflow="workflowStep"
          :short="homeRunning"
        />
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
            <DialogTitle as="h3" class="text-title font-semibold">{{
              newBuild ? 'New build' : `Install ComfyUI on ${DETECTED.noun}`
            }}</DialogTitle>
            <DialogDescription>{{
              newBuild
                ? `Another ComfyUI on ${DETECTED.noun}, with its own version and nodes. It installs in Builds while you keep working.`
                : `Checked for your ${DETECTED.chip}. Change anything before you install.`
            }}</DialogDescription>
            <!-- New build: the name, the one thing the first install never
                 asked; the rest is the same list. -->
            <div v-if="newBuild" class="mss-newbuild-name">
              <span class="mss-form-label">Name</span>
              <Input v-model="buildName" aria-label="Build name" />
            </div>

            <!-- The machine it checked, drawn large: the subject of the
                 screen. What it gets is the list below. -->
            <div class="mss-machine is-hero">
              <SetupLaptop :os="localSetup.os" />
              <span class="grid min-w-0">
                <span class="mss-machine-kicker"
                  ><Check :size="11" :stroke-width="3" />Detected</span
                >
                <span class="mss-machine-title">{{ DETECTED.chip }}</span>
                <span class="mss-row-meta">{{ DETECTED.memGb }} GB memory</span>
              </span>
              <!-- One Change: every setting opens the same sheet. -->
              <Button variant="secondary" class="mss-machine-change" @click="changeSetup"
                >Change</Button
              >
            </div>

            <!-- What gets installed: one grouped list, as the Home's settings,
                 a line each: what it is, its value, its detail. Only a problem
                 gets a mark. -->
            <dl class="mss-summary is-stacked" aria-label="Install summary">
              <div class="mss-row">
                <dt><Package :size="15" />Release</dt>
                <dd>
                  <span class="text-base-foreground">{{
                    channel === 'stable' ? 'Stable' : 'Latest on GitHub'
                  }}</span>
                  <span class="mss-row-meta">{{
                    channel === 'stable'
                      ? 'Tested releases, recommended for most users'
                      : 'The newest changes, before they are released'
                  }}</span>
                </dd>
              </div>
              <div class="mss-row">
                <dt><SlidersHorizontal :size="15" />ComfyUI version</dt>
                <dd>
                  <span class="text-base-foreground">{{
                    channel === 'stable' ? version : 'latest'
                  }}</span>
                  <span class="mss-row-meta"
                    >{{ version === DETECTED.version ? 'Latest stable' : 'Older stable' }} ·
                    {{ DETECTED.downloadGb }} GB download</span
                  >
                </dd>
              </div>
              <div class="mss-row">
                <dt><Zap :size="15" />Hardware</dt>
                <dd>
                  <span class="text-base-foreground">{{ pickedHardware.label }}</span>
                  <span class="mss-row-meta">{{ pickedHardware.summary }}</span>
                </dd>
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
                <Button size="sm" variant="ghost" @click="flow.movedDisk = true">Browse…</Button>
              </div>
              <!-- Migrate, ticked on the first screen: today's migrate op. -->
              <div v-if="localSetup.machine === 'legacy' && flow.bringOver" class="mss-row">
                <dt><ArrowLeftRight :size="15" />Migrate</dt>
                <dd>
                  <span class="text-base-foreground">Workflows, models, and settings</span>
                  <span class="mss-row-meta">From your existing ComfyUI instance</span>
                </dd>
              </div>
            </dl>
            <!-- One-click install: this is the first screen, so the consent
                 sits here, under the list, the terms gating Install. -->
            <div v-if="homeOneClick && flow.takeover" class="mss-first-consent mss-setup-consent">
              <label class="mss-check mss-terms" :class="termsAsk && !terms && 'is-ask'">
                <Checkbox v-model="terms" />
                <span
                  >I agree to the <a href="#" class="mss-link" @click.prevent>EULA</a> and
                  <a href="#" class="mss-link" @click.prevent>Terms of Service</a>.<span
                    v-if="termsAsk && !terms"
                    class="mss-terms-ask"
                    role="alert"
                    >Agree to install.</span
                  ></span
                >
              </label>
              <label class="mss-check">
                <Checkbox v-model="usage" />
                <span
                  >Help improve ComfyUI by sharing anonymous usage data.
                  <a href="#" class="mss-link" @click.prevent>Learn more</a></span
                >
              </label>
              <label class="mss-check">
                <Checkbox v-model="beta" :disabled="!usage" />
                <span>Opt-in to beta features and help test what ships next</span>
              </label>
            </div>
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
          <Button
            v-if="flow.takeover && !homeOneClick"
            variant="ghost"
            size="lg"
            @click="flow.step = 'first'"
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
            <Button v-if="unsupported" size="lg" @click="changeSetup">Change</Button>
            <Button v-else-if="newBuild" variant="primary" size="lg" @click="createBuild(buildName)"
              >Install</Button
            >
            <Button v-else variant="primary" size="lg" @click="continueSetup">{{
              workflowStep || nodesStep ? 'Continue' : 'Install'
            }}</Button>
          </template>
        </footer>
      </template>

      <!-- Change: every field filled in with what fits this computer. -->
      <template v-else-if="flow.step === 'change'">
        <div :key="flow.step" class="mar-wizard-body mss-body">
          <DialogTitle as="h3" class="text-title font-semibold">Change setup</DialogTitle>
          <DialogDescription
            >Everything here is already set to what fits this computer. Back keeps it as it
            was.</DialogDescription
          >
          <!-- A settings sheet: label on the left, control on the right,
               a hairline between rows. Picks are radio cards. -->
          <div v-if="method !== 'remote'" class="mss-form">
            <div v-if="!simple" class="mss-form-row">
              <span id="mss-from" class="mss-form-label">Get ComfyUI from</span>
              <!-- Cards, not tabs: no sliding pill (tabSlide). -->
              <RadioGroupRoot
                v-model="method"
                class="mss-opts"
                aria-labelledby="mss-from"
                data-no-pill
              >
                <RadioGroupItem
                  v-for="m in SOURCES"
                  :key="m.value"
                  :value="m.value"
                  class="mss-opt"
                  :class="m.value === 'portable' && 'is-wide'"
                >
                  <span class="mss-opt-icon"><component :is="m.icon" :size="16" /></span>
                  <span class="mss-opt-text">
                    <span class="mss-opt-name">{{ m.label }}</span>
                    <span class="mss-opt-meta">{{ m.meta }}</span>
                  </span>
                  <span class="mss-opt-check" aria-hidden="true"
                    ><Check :size="15" :stroke-width="2.5"
                  /></span>
                </RadioGroupItem>
              </RadioGroupRoot>
            </div>
            <template v-if="simple"></template>
            <div v-else-if="method === 'managed'" class="mss-form-row">
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
            <!-- New build asks its name on the summary, in its own card. -->
            <div v-if="!simple && (flow.takeover || flow.homeCard)" class="mss-form-row">
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
                    >Browse</Button
                  >
                </template>
              </Input>
            </div>
            <div class="mss-form-row">
              <span id="mss-hw" class="mss-form-label">Hardware</span>
              <RadioGroupRoot
                v-model="hardware"
                class="mss-opts is-list"
                aria-labelledby="mss-hw"
                data-no-pill
              >
                <RadioGroupItem
                  v-for="h in HARDWARE"
                  :key="h.value"
                  :value="h.value"
                  class="mss-opt"
                >
                  <span class="mss-opt-icon"><component :is="h.icon" :size="16" /></span>
                  <span class="mss-opt-text">
                    <span class="mss-opt-name"
                      >{{ h.label
                      }}<span v-if="h.recommended" class="mss-opt-tag">{{
                        say('newInstall.recommended')
                      }}</span></span
                    >
                    <span class="mss-opt-meta">{{ h.meta }}</span>
                  </span>
                  <span class="mss-opt-check" aria-hidden="true"
                    ><Check :size="15" :stroke-width="2.5"
                  /></span>
                </RadioGroupItem>
              </RadioGroupRoot>
            </div>
            <!-- The other ways in, one quiet line under the sheet: a remote
                 server, and today's two from the File menu. -->
            <p v-if="!simple" class="mss-form-aside">
              Already have ComfyUI?
              <button type="button" class="mss-link" @click="method = 'remote'">
                Connect to a server
              </button>
              <span class="mss-form-aside-sep">·</span>
              <button
                type="button"
                class="mss-link"
                @click="toast(`Opening ${say('fileMenu.addExistingInstall')}`)"
              >
                {{ say('fileMenu.addExistingInstall') }}
              </button>
              <span class="mss-form-aside-sep">·</span>
              <button
                type="button"
                class="mss-link"
                @click="toast(`Opening ${say('fileMenu.loadSnapshot')}`)"
              >
                {{ say('fileMenu.loadSnapshot') }}
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
                Install on {{ DETECTED.noun }} instead
              </button>
            </p>
          </div>
        </div>
        <footer class="mar-wizard-foot mss-foot">
          <!-- Back is the way out: it leaves things as they were. -->
          <Button variant="ghost" size="lg" @click="discardChanges"
            ><ArrowLeft :size="16" />Back</Button
          >
          <span class="mr-auto"></span>
          <Button
            v-if="method === 'remote'"
            variant="primary"
            size="lg"
            :disabled="!serverUrl"
            @click="toast(`Connecting to ${serverUrl}`)"
            >Connect</Button
          >
          <Button v-else variant="primary" size="lg" @click="saveChanges">Save changes</Button>
        </footer>
      </template>

      <!-- Custom nodes (DESK-243): a new build's recommended packs, ticked,
           with the registry a search away. Skip installs plain ComfyUI. -->
      <template v-else-if="flow.step === 'nodes'">
        <div :key="flow.step" class="mar-wizard-body mss-body">
          <DialogTitle as="h3" class="text-title font-semibold">Add custom nodes</DialogTitle>
          <DialogDescription
            >The most used node packs, tested on {{ DETECTED.noun }}, are picked. Add more now or
            later from the Manager.</DialogDescription
          >
          <SetupNodes />
        </div>
        <footer class="mar-wizard-foot mss-foot">
          <Button v-if="!nodesFromHome" variant="ghost" size="lg" @click="flow.step = 'setup'"
            ><ArrowLeft :size="14" />Back</Button
          >
          <span class="flex-1"></span>
          <span class="mss-foot-sum tabular-nums">{{
            flow.packs.length
              ? `${flow.packs.length} node pack${flow.packs.length === 1 ? '' : 's'} · ${packsMb} MB`
              : 'Plain ComfyUI'
          }}</span>
          <Button v-if="nodesFromHome" variant="primary" size="lg" @click="flow.open = false"
            >Done</Button
          >
          <template v-else>
            <Button size="lg" @click="skipNodes">Skip</Button>
            <Button variant="primary" size="lg" @click="afterNodes">{{
              workflowStep ? 'Continue' : 'Install'
            }}</Button>
          </template>
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
          <div class="mss-pick">
            <MarSeg
              v-model="flow.tab"
              label="Workflow type"
              :options="TABS"
              class="mss-pick-tabs"
            />
            <!-- Explore's template card, with what today's step says on it:
                 Recommended, Requires credits, the task and the download. -->
            <div class="mss-cards" role="radiogroup" aria-label="Choose a starter workflow">
              <button
                v-for="s in shownStarters"
                :key="s.id"
                type="button"
                role="radio"
                :aria-checked="flow.picked?.id === s.id"
                class="mss-wf"
                @click="pick(s)"
              >
                <span class="mss-wf-media">
                  <img :src="starterImg(s)" alt="" loading="lazy" />
                  <span v-if="s.tag === 'Recommended'" class="mss-wf-badge">Recommended</span>
                  <span v-else-if="s.credits" class="mss-wf-badge is-credits"
                    ><Crown :size="12" :stroke-width="2.5" />Requires credits</span
                  >
                  <span v-if="!s.credits" class="mss-wf-badge is-size tabular-nums"
                    >~{{ s.gb }} GB</span
                  >
                </span>
                <span class="mss-wf-text">
                  <span class="mss-wf-name">{{ starterName(s) }}</span>
                  <span class="mss-wf-task">{{ starterTask(s) }}</span>
                  <span class="mss-wf-check" aria-hidden="true"
                    ><Check :size="15" :stroke-width="2.5"
                  /></span>
                </span>
              </button>
            </div>
          </div>
          <Checkbox v-if="!flow.takeover" v-model="dontShowTemplates"
            >Don't show this template step again</Checkbox
          >
        </div>
        <footer class="mar-wizard-foot mss-foot">
          <Button variant="ghost" size="lg" @click="flow.step = nodesStep ? 'nodes' : 'setup'"
            ><ArrowLeft :size="14" />Back</Button
          >
          <!-- Today's block: the picked workflow's models don't fit. -->
          <span v-if="starterBlocked" class="mx-2 grid min-w-0 flex-1 text-ui">
            <span class="font-medium text-base-foreground"
              >Not Enough Space for Template Models</span
            >
            <span class="text-subtle-foreground"
              >Needs ~{{ pickedGb }} GB, only {{ freeLabel(free) }} free. Free up space or pick a
              lighter workflow.</span
            >
          </span>
          <template v-else>
            <span class="flex-1"></span>
            <span class="mss-foot-sum tabular-nums">{{ pickedGb }} GB download</span>
          </template>
          <Button size="lg" @click="installWith(null)">Skip &amp; Install</Button>
          <Button
            variant="primary"
            size="lg"
            :disabled="starterBlocked"
            @click="installWith(flow.picked)"
            >Install</Button
          >
        </footer>
      </template>

      <!-- Installing: the status first, then today's scene of Comfy outputs.
           The Cloud pitch is one line in the bar. Error: today's Operation
           failed, in place. -->
      <template v-else>
        <div :key="failed ? 'error' : 'installing'" class="mar-wizard-body mss-body mss-body-inst">
          <DialogTitle as="h3" class="text-title font-semibold">{{
            failed ? 'Operation failed' : 'Installing ComfyUI'
          }}</DialogTitle>
          <!-- Status on the left: today's five steps, all in view, the
               running one open with its detail. On the right one calm panel:
               today's showcase clips, one at a time, in place of the scene. -->
          <section class="mss-inst" :class="failed && 'is-err'">
            <div class="mss-inst-main">
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
          <template v-else>
            <p
              class="mss-pitch"
              role="region"
              :aria-label="say('installShowcase.label')"
              @mouseenter="pitchHeld = true"
              @mouseleave="pitchHeld = false"
              @focusin="pitchHeld = true"
              @focusout="pitchHeld = false"
            >
              <Cloud :size="14" class="shrink-0" />
              <Transition name="mss-pitch-swap" mode="out-in">
                <span :key="pitch" class="mss-pitch-line"
                  ><b>{{ say(`installShowcase.${pitch}.title`) }}</b
                  ><span class="mss-pitch-sep">{{
                    say(`installShowcase.${pitch}.body`)
                  }}</span></span
                >
              </Transition>
            </p>
            <Button variant="secondary" size="lg" @click="toast('Opening Comfy Cloud')">{{
              say('installShowcase.cloudCta')
            }}</Button>
            <Button
              v-if="flow.takeover || flow.background"
              variant="ghost"
              size="lg"
              @click="flow.confirmCancel = true"
              >Cancel install</Button
            >
            <Button v-else variant="ghost" size="lg" @click="flow.confirmCancel = true"
              ><ArrowLeft :size="14" />Return to Dashboard</Button
            >
          </template>
        </footer>
      </template>
      <SetupCancelConfirm />
    </DialogContent>
  </DialogRoot>
</template>
