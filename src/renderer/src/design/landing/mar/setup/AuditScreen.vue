<script setup lang="ts">
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Cloud,
  Cpu,
  HardDrive,
  Laptop,
  LoaderCircle,
  Package,
  SlidersHorizontal,
  Sparkles
} from 'lucide-vue-next'
import CvFrame from './CvFrame.vue'
import FirstOption from './FirstOption.vue'
import SetupBloom from './SetupBloom.vue'
import type { Starter } from './setupFlow'
import { D, IMAGE_STARTERS, REQUIRED_GB, imgUrl, totalGb } from './canvasData'
import en from '@locales/en.json'

/**
 * One setup screen for the audit pages of the canvas: `today` as the flow
 * draws it now, or the proposal (`proposed`), in the fixed frame with the
 * step indicator and the action bar. Copy is the flow's; proposed copy
 * changes are listed on the page to approve one by one.
 */
export type AuditScreenId =
  | 'first'
  | 'setup'
  | 'change'
  | 'workflow'
  | 'install'
  | 'two-workflow'
  | 'two-install'
const { screen, proposed = false } = defineProps<{
  screen: AuditScreenId
  proposed?: boolean
}>()

const pitch = en.installShowcase
const CLIPS = ['eye', 'clouds', 'dusk_mountains', 'flower']
const ZIT = IMAGE_STARTERS[0] as Starter
const SDXL = IMAGE_STARTERS[1] as Starter
const INSTALL_STEPS = [
  { label: 'Download', meta: `${D.downloadGb} GB` },
  { label: 'Extract', meta: '' },
  { label: 'Set up environment', meta: '' },
  { label: 'Clean up environment', meta: '' },
  { label: 'Update to latest stable', meta: '' }
]
const PROPOSED_STEPS = [...INSTALL_STEPS, { label: 'Download models', meta: `${ZIT.gb} GB` }]
const stepState = (i: number, now: number): string =>
  i < now ? 'is-done' : i === now ? 'is-now' : ''
</script>

<template>
  <!-- ============ First screen ============ -->
  <FirstOption v-if="screen === 'first' && !proposed" :option="0" />
  <CvFrame v-else-if="screen === 'first'" :step="1" class="v1">
    <h1 class="fo-title">How do you want to run Comfy?</h1>
    <p class="fo-lead">Choose the setup that fits how you work. You can switch later.</p>
    <div class="fo-ways">
      <div class="fo-card">
        <span class="fo-icon"><Cloud :size="17" /></span>
        <span class="fo-text">
          <span class="fo-name">Cloud</span><span class="fo-tag">Full power. Instant setup.</span>
          <span class="fo-desc"
            >Best for <b>powerful GPUs</b> and popular custom nodes, ready anywhere.</span
          >
        </span>
      </div>
      <div class="fo-card" aria-checked="true">
        <span class="fo-icon"><Laptop :size="17" /></span>
        <span class="fo-text">
          <span class="fo-name">Local</span><span class="fo-tag">Full control. Your hardware.</span>
          <span class="fo-desc"
            >Best for <b>full manual control</b> of versions, custom nodes, and offline
            workflows.</span
          >
        </span>
      </div>
    </div>
    <span class="fo-check fo-express"
      ><span class="cv-box"></span
      ><span><span class="fo-strong">Express Install with recommended settings</span></span></span
    >
    <div class="fo-consent" style="margin-top: 28px">
      <span class="fo-check"
        ><span class="cv-box is-on"><Check :size="11" :stroke-width="3" /></span
        ><span>Help improve Comfy by sharing anonymous usage data. <u>Learn more</u></span></span
      >
      <span class="fo-check"
        ><span class="cv-box is-on"><Check :size="11" :stroke-width="3" /></span
        ><span>Opt in to beta features and help test what ships next</span></span
      >
    </div>
    <template #bar>
      <span class="fo-check cv-grow"
        ><span class="cv-box is-ask"></span
        ><span class="grid"
          ><span class="text-base-foreground"
            >I agree to the <u class="cv-link">EULA</u> and
            <u class="cv-link">Terms of Service</u>.</span
          ><span class="cv-meta">Agree to continue.</span></span
        ></span
      >
      <span class="cv-btn is-primary">Continue</span>
    </template>
  </CvFrame>

  <!-- ============ Set up ============ -->
  <CvFrame v-else-if="screen === 'setup' && !proposed" layout="today">
    <h1 class="fo-title">Install ComfyUI on this Mac</h1>
    <p class="fo-lead">Checked for your {{ D.chip }}. Change anything before you install.</p>
    <div class="mss-stage" style="margin-top: 20px">
      <SetupBloom />
      <div class="mss-stage-ui">
        <div class="mss-stage-top">
          <span></span>
          <span class="mss-chip is-btn"><SlidersHorizontal :size="12" />Change</span>
        </div>
        <div class="mss-stage-subject">
          <span class="mss-stage-glyph"><Laptop :size="20" /></span>
          <span class="grid">
            <span class="mss-stage-title">{{ D.chip }} · {{ D.memGb }} GB</span>
            <span class="mss-stage-sub">Detected. Uses the {{ D.build }} build.</span>
          </span>
        </div>
      </div>
    </div>
    <dl class="mss-summary">
      <div class="mss-row">
        <dt><HardDrive :size="15" />Location</dt>
        <dd>
          <span class="truncate text-base-foreground">{{ D.path }}</span>
          <span class="mss-row-meta">{{ D.freeGb }} GB free · ~{{ REQUIRED_GB }} GB required</span>
        </dd>
      </div>
      <div class="mss-row">
        <dt><Package :size="15" />Version</dt>
        <dd>
          <span class="text-base-foreground">ComfyUI {{ D.version }} · Stable</span>
          <span class="mss-row-meta">{{ D.downloadGb }} GB download</span>
        </dd>
      </div>
    </dl>
    <div class="cv-foot">
      <span class="cv-btn is-ghost"><ArrowLeft :size="14" />Back</span>
      <span class="cv-grow"></span><span class="cv-btn is-primary">Continue</span>
    </div>
  </CvFrame>
  <CvFrame v-else-if="screen === 'setup'" :step="2">
    <h1 class="fo-title">Install ComfyUI on this Mac</h1>
    <p class="fo-lead">Checked for your {{ D.chip }}. Change anything before you install.</p>
    <dl class="cv-list">
      <div class="cv-row">
        <dt><Cpu :size="15" />Machine</dt>
        <dd>
          <span class="cv-val">{{ D.chip }} · {{ D.memGb }} GB</span
          ><span class="cv-meta">{{ D.build }} · Detected</span>
        </dd>
        <span class="cv-btn is-ghost is-sm">Change</span>
      </div>
      <div class="cv-row is-open">
        <dt><HardDrive :size="15" />Location</dt>
        <dd>
          <span class="cv-input"
            ><span>{{ D.path }}</span
            ><span class="cv-meta">{{ D.freeGb }} GB free</span
            ><span class="cv-btn is-sm">Browse…</span></span
          >
          <span class="cv-meta">~{{ REQUIRED_GB }} GB required</span>
        </dd>
        <span class="cv-btn is-sm">Done</span>
      </div>
      <div class="cv-row">
        <dt><Package :size="15" />Version</dt>
        <dd>
          <span class="cv-val">ComfyUI {{ D.version }} · Stable</span
          ><span class="cv-meta">{{ D.downloadGb }} GB download</span>
        </dd>
        <span class="cv-btn is-ghost is-sm">Change</span>
      </div>
    </dl>
    <template #bar>
      <span class="cv-btn is-ghost"><ArrowLeft :size="14" />Back</span>
      <span class="cv-grow"></span><span class="cv-btn is-primary">Continue</span>
    </template>
  </CvFrame>

  <!-- ============ Change setup ============ -->
  <CvFrame
    v-else-if="screen === 'change'"
    :layout="proposed ? 'center' : 'today'"
    :step="proposed ? 2 : undefined"
  >
    <h1 class="fo-title">Change setup</h1>
    <p class="fo-lead">Everything here is already set to what fits this computer.</p>
    <div class="cv-fields">
      <div class="cv-field">
        <span class="cv-label">{{ proposed ? 'Get ComfyUI from' : 'Install method' }}</span>
        <div v-if="!proposed" class="cv-seg">
          <span class="is-on">Public Builds</span><span>Managed Builds</span
          ><span>Remote Connection</span>
        </div>
        <div v-else class="cv-opts">
          <span class="cv-opt is-on"
            ><span class="cv-dot is-on"></span
            ><span class="cv-grow"
              ><span>Official release</span><span class="cv-meta">Public builds</span></span
            ></span
          >
          <span class="cv-opt"
            ><span class="cv-dot"></span
            ><span class="cv-grow"
              ><span>Your team's builds</span
              ><span class="cv-meta">Managed builds · Sign in</span></span
            ></span
          >
        </div>
      </div>
      <div class="cv-field">
        <span class="cv-label">Name</span>
        <span class="cv-input"><span>ComfyUI</span></span>
      </div>
      <div class="cv-field">
        <span class="cv-label">Location</span>
        <span class="cv-input"
          ><span>{{ D.path }}</span
          ><span class="cv-meta">{{ D.freeGb }} GB free</span
          ><span class="cv-btn is-sm">Browse…</span></span
        >
      </div>
      <div class="cv-field">
        <span class="cv-label">Release</span>
        <div class="flex items-center gap-3">
          <div class="cv-seg is-fit">
            <span class="is-on">Stable</span><span>Latest on GitHub</span>
          </div>
          <span class="cv-input" style="width: 200px"
            ><span>ComfyUI {{ D.version }}</span
            ><ChevronDown :size="14"
          /></span>
        </div>
      </div>
      <div class="cv-field">
        <span class="cv-label">Hardware</span>
        <div class="cv-opts">
          <span class="cv-opt is-on"
            ><span v-if="proposed" class="cv-dot is-on"></span
            ><span class="cv-grow">{{ D.build }}</span
            ><span class="cv-badge">Detected</span></span
          >
          <span v-if="proposed" class="cv-opt"
            ><span class="cv-dot"></span><span class="cv-grow">CPU</span></span
          >
          <span v-else style="align-self: center; padding-left: 12px; color: var(--ink)">CPU</span>
        </div>
      </div>
      <p v-if="proposed" class="cv-meta" style="font-size: 13px">
        Already running ComfyUI on another machine?
        <u class="cv-link">Connect to a server instead</u>
      </p>
    </div>
    <div v-if="!proposed" class="cv-foot">
      <span class="cv-btn is-ghost"><ArrowLeft :size="14" />Back</span>
      <span class="cv-grow"></span><span class="cv-btn is-primary">Done</span>
    </div>
    <template v-if="proposed" #bar>
      <span class="cv-btn is-ghost">Discard changes</span>
      <span class="cv-grow"></span><span class="cv-btn is-primary">Save changes</span>
    </template>
  </CvFrame>

  <!-- ============ Starter workflow ============ -->
  <CvFrame v-else-if="screen === 'workflow' && !proposed" layout="today">
    <h1 class="fo-title">Choose a starter workflow</h1>
    <p class="fo-lead">Opens a ready-to-run workflow. Models download during setup.</p>
    <div class="cv-seg" style="margin: 20px 7px 0">
      <span class="is-on">Image</span><span>Video</span><span>3D</span><span>Audio</span>
    </div>
    <div class="cv-cards">
      <div v-for="s in IMAGE_STARTERS" :key="s.id" class="cv-card" :class="s === ZIT && 'is-on'">
        <img :src="imgUrl(s.img)" alt="" />
        <span v-if="s === ZIT" class="cv-card-check"><Check :size="10" :stroke-width="3" /></span>
        <span class="cv-card-name">{{ s.title }}</span>
        <span class="cv-meta">{{ s.credits ? 'No download' : `${s.gb} GB` }}</span>
      </div>
    </div>
    <div class="cv-foot">
      <span class="cv-btn is-ghost"><ArrowLeft :size="14" />Back</span>
      <span class="cv-grow"></span><span class="cv-btn">Skip &amp; Install</span
      ><span class="cv-btn is-primary">Install</span>
    </div>
  </CvFrame>
  <CvFrame v-else-if="screen === 'workflow'" :step="3">
    <h1 class="fo-title">Choose a starter workflow</h1>
    <p class="fo-lead">Opens a ready-to-run workflow. Models download during setup.</p>
    <div class="cv-seg" style="margin-top: 20px">
      <span class="is-on">Image</span><span>Video</span><span>3D</span><span>Audio</span>
    </div>
    <div class="cv-cards">
      <div v-for="s in IMAGE_STARTERS" :key="s.id" class="cv-card" :class="s === SDXL && 'is-on'">
        <img :src="imgUrl(s.img)" alt="" />
        <span class="cv-card-name">{{ s.title }}</span>
        <span class="cv-card-foot"
          ><span class="cv-dot" :class="s === SDXL && 'is-on'"></span
          ><span class="cv-meta">{{ s.credits ? 'No download' : `${s.gb} GB` }}</span
          ><span v-if="s.credits" class="cv-badge"><Cloud :size="11" />Runs on Cloud</span></span
        >
      </div>
    </div>
    <template #bar>
      <span class="cv-btn is-ghost"><ArrowLeft :size="14" />Back</span>
      <span class="cv-grow"></span><span class="cv-btn">Skip workflow</span
      ><span class="cv-btn is-primary"
        >Install<span class="cv-n">· {{ totalGb(SDXL.gb) }}</span></span
      >
    </template>
  </CvFrame>

  <!-- ============ Install ============ -->
  <CvFrame v-else-if="screen === 'install' && !proposed" layout="today">
    <div class="cv-pitch" style="justify-content: space-between">
      <span
        ><b>{{ pitch.cloud.title }}</b> · {{ pitch.cloud.body }}</span
      ><span class="cv-btn is-ghost is-sm">{{ pitch.cloudCta }}<ArrowRight :size="12" /></span>
    </div>
    <div class="cv-clips">
      <video
        v-for="c in CLIPS"
        :key="c"
        :src="`./install-showcase-scene/Assets/${c}.webm`"
        autoplay
        muted
        loop
        playsinline
      ></video>
    </div>
    <div class="flex items-center justify-between" style="margin-top: 20px">
      <span class="fo-name" style="font-size: 17px">Installing ComfyUI</span>
      <span class="cv-meta flex items-center gap-1"><ChevronDown :size="14" />View logs</span>
    </div>
    <div class="cv-steplist">
      <div
        v-for="(s, i) in INSTALL_STEPS.slice(0, 3)"
        :key="s.label"
        class="cv-sl"
        :class="stepState(i, 1)"
      >
        <span
          ><Check v-if="i < 1" :size="13" /><LoaderCircle
            v-else-if="i === 1"
            :size="14"
            class="cv-spin" /><i v-else></i
        ></span>
        <span>{{ s.label }}</span
        ><span></span>
      </div>
    </div>
    <div class="cv-foot">
      <span class="cv-btn is-ghost"><ArrowLeft :size="14" />Return to Dashboard</span>
    </div>
  </CvFrame>
  <CvFrame v-else-if="screen === 'install'" :step="4">
    <div class="flex items-center gap-4">
      <img :src="imgUrl(ZIT.img)" alt="" class="cv-thumb" />
      <span class="grid">
        <span class="fo-title">Getting {{ ZIT.title }} ready</span>
        <span class="fo-lead" style="margin: 2px 0 0"
          >Installing ComfyUI and the workflow's models.</span
        >
      </span>
    </div>
    <div class="cv-steplist" style="margin-top: 24px">
      <div v-for="(s, i) in PROPOSED_STEPS" :key="s.label" class="cv-sl" :class="stepState(i, 2)">
        <span
          ><Check v-if="i < 2" :size="13" /><LoaderCircle
            v-else-if="i === 2"
            :size="14"
            class="cv-spin" /><i v-else></i
        ></span>
        <span>{{ s.label }}</span
        ><span class="cv-meta">{{ s.meta }}</span>
      </div>
    </div>
    <span class="cv-meta flex items-center gap-1" style="margin-top: 12px"
      ><ChevronDown :size="14" />View logs</span
    >
    <template #bar>
      <span class="cv-pitch cv-grow"
        ><Cloud :size="14" /><span
          ><b>{{ pitch.cloud.title }}</b> · No install, no drivers, no GPU.</span
        ><u class="cv-link">{{ pitch.cloudCta }}</u></span
      >
      <span class="cv-btn is-ghost">Cancel install</span>
    </template>
  </CvFrame>

  <!-- ============ Two columns: the summary that becomes the progress ============ -->
  <CvFrame v-else :step="screen === 'two-workflow' ? 3 : 4" layout="wide">
    <div class="cv-2col">
      <div>
        <template v-if="screen === 'two-workflow'">
          <h1 class="fo-title">Choose a starter workflow</h1>
          <p class="fo-lead">Opens a ready-to-run workflow. Models download during setup.</p>
          <div class="cv-seg" style="margin-top: 20px">
            <span class="is-on">Image</span><span>Video</span><span>3D</span><span>Audio</span>
          </div>
          <div class="cv-cards is-2">
            <div
              v-for="s in IMAGE_STARTERS"
              :key="s.id"
              class="cv-card"
              :class="s === ZIT && 'is-on'"
            >
              <img :src="imgUrl(s.img)" alt="" style="aspect-ratio: 16 / 7" />
              <span class="cv-card-name">{{ s.title }}</span>
              <span class="cv-card-foot"
                ><span class="cv-dot" :class="s === ZIT && 'is-on'"></span
                ><span class="cv-meta">{{ s.credits ? 'No download' : `${s.gb} GB` }}</span
                ><span v-if="s.credits" class="cv-badge"
                  ><Cloud :size="11" />Runs on Cloud</span
                ></span
              >
            </div>
          </div>
        </template>
        <template v-else>
          <h1 class="fo-title">Getting {{ ZIT.title }} ready</h1>
          <p class="fo-lead">Installing ComfyUI and the workflow's models.</p>
          <img :src="imgUrl(ZIT.img)" alt="" class="cv-hero" />
        </template>
      </div>
      <aside class="cv-card-sum">
        <header>{{ screen === 'two-workflow' ? 'Your setup' : 'Installing' }}</header>
        <dl>
          <div class="cv-row">
            <dt><Cpu :size="15" />Machine</dt>
            <dd>
              <span class="cv-val">{{ D.chip }}</span
              ><span class="cv-meta">{{ D.build }}</span>
            </dd>
            <Check v-if="screen === 'two-install'" :size="14" /><span v-else></span>
          </div>
          <div class="cv-row">
            <dt><HardDrive :size="15" />Location</dt>
            <dd>
              <span class="cv-val">{{ D.path }}</span
              ><span class="cv-meta">{{ D.freeGb }} GB free</span>
            </dd>
            <Check v-if="screen === 'two-install'" :size="14" /><span v-else></span>
          </div>
          <div class="cv-row">
            <dt><Package :size="15" />Version</dt>
            <dd>
              <span class="cv-val">ComfyUI {{ D.version }}</span
              ><span class="cv-meta">{{
                screen === 'two-install' ? 'Setting up environment' : `${D.downloadGb} GB download`
              }}</span>
            </dd>
            <LoaderCircle v-if="screen === 'two-install'" :size="14" class="cv-spin" /><span
              v-else
            ></span>
          </div>
          <div class="cv-row">
            <dt><Sparkles :size="15" />Workflow</dt>
            <dd>
              <span class="cv-val">{{ ZIT.title }}</span
              ><span class="cv-meta">{{
                screen === 'two-install'
                  ? `Next · ${ZIT.gb} GB of models`
                  : `${ZIT.gb} GB of models`
              }}</span>
            </dd>
            <span></span>
          </div>
        </dl>
        <div class="cv-total">
          <span class="cv-grow">Total</span><b>{{ totalGb(ZIT.gb) }}</b>
        </div>
      </aside>
    </div>
    <template #bar>
      <template v-if="screen === 'two-workflow'">
        <span class="cv-btn is-ghost"><ArrowLeft :size="14" />Back</span>
        <span class="cv-grow"></span><span class="cv-btn">Skip workflow</span
        ><span class="cv-btn is-primary"
          >Install<span class="cv-n">· {{ totalGb(ZIT.gb) }}</span></span
        >
      </template>
      <template v-else>
        <span class="cv-pitch cv-grow"
          ><Cloud :size="14" /><span
            ><b>{{ pitch.cloud.title }}</b> · No install, no drivers, no GPU.</span
          ><u class="cv-link">{{ pitch.cloudCta }}</u></span
        >
        <span class="cv-btn is-ghost">Cancel install</span>
      </template>
    </template>
  </CvFrame>
</template>
