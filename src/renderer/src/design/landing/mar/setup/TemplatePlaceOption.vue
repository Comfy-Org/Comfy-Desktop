<script setup lang="ts">
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Cloud,
  Cpu,
  HardDrive,
  Laptop,
  LoaderCircle,
  Package,
  Sparkles
} from 'lucide-vue-next'
import CvFrame from './CvFrame.vue'
import { D, IMAGE_STARTERS, imgUrl, REQUIRED_GB, totalGb } from './canvasData'
import type { Starter } from './setupFlow'

/**
 * Where the starter workflow goes once the setup is three steps and M1 has
 * no Home. Today's step lets a template bring its models with the install;
 * every take keeps that, and differs in when the user is asked: 1 a row of
 * Set up, 2 today's own step, 3 during the wait, 4 on Builds afterwards,
 * 5 a closing screen. Same starters and sizes as the flow.
 */
const { option } = defineProps<{ option: number }>()

const THREE = ['Run on', 'Set up', 'Install']
const ZIT = IMAGE_STARTERS[0] as Starter
const size = (s: Starter): string => (s.credits ? 'No download' : `${s.gb} GB`)
const PHASES = [
  'Download',
  'Extract',
  'Set up environment',
  'Clean up environment',
  'Update to latest stable'
]
</script>

<template>
  <!-- 1 · A row of Set up: the picker opens from Choose. -->
  <CvFrame v-if="option === 1" :step="2" :steps="THREE">
    <h1 class="fo-title">Install ComfyUI on this Mac</h1>
    <p class="fo-lead">Checked for your {{ D.chip }}. Change anything before you install.</p>
    <dl class="cv-list">
      <div class="cv-row">
        <dt><Cpu :size="15" />Hardware</dt>
        <dd>
          <span class="cv-val">{{ D.build }}</span
          ><span class="cv-meta">Detected</span>
        </dd>
        <span class="cv-btn is-sm">Change</span>
      </div>
      <div class="cv-row">
        <dt><HardDrive :size="15" />Location</dt>
        <dd>
          <span class="cv-val">{{ D.path }}</span
          ><span class="cv-meta">{{ D.freeGb }} GB free · ~{{ REQUIRED_GB }} GB required</span>
        </dd>
        <span class="cv-btn is-sm">Change</span>
      </div>
      <div class="cv-row">
        <dt><Package :size="15" />Version</dt>
        <dd>
          <span class="cv-val">ComfyUI {{ D.version }} · Stable</span
          ><span class="cv-meta">{{ D.downloadGb }} GB download</span>
        </dd>
        <span class="cv-btn is-sm">Change</span>
      </div>
      <div class="cv-row">
        <dt><Sparkles :size="15" />Workflow</dt>
        <dd>
          <span class="cv-val">None</span
          ><span class="cv-meta">Open a ready-to-run workflow after the install</span>
        </dd>
        <span class="cv-btn is-sm">Choose</span>
      </div>
    </dl>
    <template #bar>
      <span class="cv-btn is-ghost"><ArrowLeft :size="14" />Back</span>
      <span class="cv-grow"></span>
      <span class="cv-meta">{{ D.downloadGb }} GB download · ~{{ REQUIRED_GB }} GB required</span>
      <span class="cv-btn is-primary">Install</span>
    </template>
  </CvFrame>

  <!-- 2 · Its own step, as today: between Set up and Install. -->
  <CvFrame v-else-if="option === 2" :step="3" layout="wide">
    <h1 class="fo-title">Choose a starter workflow</h1>
    <p class="fo-lead">Opens a ready-to-run workflow. Models download during setup.</p>
    <div class="cv-seg is-fit" style="margin-top: 20px; width: 360px">
      <span class="is-on">Image</span><span>Video</span><span>3D</span><span>Audio</span>
    </div>
    <div class="sx is-1">
      <div
        v-for="(s, i) in IMAGE_STARTERS"
        :key="s.id"
        class="sx-card"
        role="radio"
        :aria-checked="i === 0"
      >
        <img :src="imgUrl(s.img)" alt="" />
        <span class="sx-chips">
          <span class="sx-chip">{{ size(s) }}</span>
          <span v-if="s.credits" class="sx-chip"><Cloud :size="11" />Runs on Cloud</span>
          <span v-else-if="s.tag" class="sx-chip">{{ s.tag }}</span>
        </span>
        <span class="sx-pick" aria-hidden="true"><Check :size="12" :stroke-width="3" /></span>
        <span class="sx-name">{{ s.title }}</span>
      </div>
    </div>
    <template #bar>
      <span class="cv-btn is-ghost"><ArrowLeft :size="14" />Back</span>
      <span class="cv-grow"></span>
      <span class="cv-btn">Skip &amp; Install</span
      ><span class="cv-btn is-primary"
        >Install<span class="cv-n">· {{ totalGb(ZIT.gb) }}</span></span
      >
    </template>
  </CvFrame>

  <!-- 3 · During the wait: the picker takes the showcase panel. -->
  <CvFrame v-else-if="option === 3" :step="3" :steps="THREE" layout="wide">
    <div class="cv-2col" style="grid-template-columns: minmax(0, 1fr) 520px; align-items: start">
      <div>
        <h1 class="fo-title">Installing ComfyUI</h1>
        <div class="cv-steplist" style="margin-top: 24px">
          <div
            v-for="(p, i) in PHASES"
            :key="p"
            class="cv-sl"
            :class="i === 0 ? 'is-now' : undefined"
          >
            <span><LoaderCircle v-if="i === 0" :size="14" class="cv-spin" /><i v-else></i></span>
            <span>{{ p }}</span
            ><span v-if="i === 0" class="cv-meta">40%</span>
          </div>
          <div class="cv-sl">
            <span><i></i></span><span>Download {{ ZIT.title }} models</span
            ><span class="cv-meta">{{ ZIT.gb }} GB</span>
          </div>
        </div>
        <span class="cv-meta flex items-center gap-1" style="margin-top: 12px"
          ><ChevronDown :size="14" />View logs</span
        >
      </div>
      <div>
        <span class="cv-val" style="font-weight: 500">Start from a workflow</span>
        <p class="cv-meta" style="margin-top: 2px">
          Pick one while you wait. Its models download next and it opens when ready.
        </p>
        <div class="sx" style="grid-template-columns: repeat(2, 1fr)">
          <div
            v-for="(s, i) in IMAGE_STARTERS"
            :key="s.id"
            class="sx-card"
            role="radio"
            :aria-checked="i === 0"
            style="aspect-ratio: 16 / 10"
          >
            <img :src="imgUrl(s.img)" alt="" />
            <span class="sx-chips"
              ><span class="sx-chip">{{ size(s) }}</span></span
            >
            <span class="sx-pick" aria-hidden="true"><Check :size="12" :stroke-width="3" /></span>
            <span class="sx-name">{{ s.title }}</span>
          </div>
        </div>
      </div>
    </div>
    <template #bar>
      <span class="cv-grow"></span><span class="cv-btn is-ghost">Cancel install</span>
    </template>
  </CvFrame>

  <!-- 4 · On Builds, after the install: a shelf under the new build. -->
  <CvFrame v-else-if="option === 4" layout="wide">
    <h1 class="fo-title">Builds</h1>
    <dl class="cv-list" style="margin-top: 20px">
      <div class="cv-row" style="grid-template-columns: 1fr auto auto">
        <dd style="display: flex; align-items: center; gap: 10px">
          <Laptop :size="15" /><span class="cv-val" style="font-weight: 500">My Local 1</span
          ><span class="cv-meta">Stable · {{ D.version }}</span>
        </dd>
        <span class="cv-meta">Stopped</span>
        <span class="cv-btn is-sm">Start on this computer</span>
      </div>
      <div class="cv-row" style="grid-template-columns: 1fr auto auto">
        <dd style="display: flex; align-items: center; gap: 10px">
          <Cloud :size="15" /><span class="cv-val" style="font-weight: 500">Comfy Cloud</span
          ><span class="cv-meta">cloud.comfy.org</span>
        </dd>
        <span class="cv-meta">Asleep</span>
        <span class="cv-btn is-sm">Open on Cloud</span>
      </div>
    </dl>
    <span class="cv-val" style="margin-top: 32px; font-weight: 500">Start from a workflow</span>
    <p class="cv-meta" style="margin-top: 2px">Opens on My Local 1. Its models download first.</p>
    <div class="sx is-1">
      <div
        v-for="s in IMAGE_STARTERS"
        :key="s.id"
        class="sx-card tp-plain"
        role="radio"
        aria-checked="true"
        style="aspect-ratio: 4 / 3"
      >
        <img :src="imgUrl(s.img)" alt="" />
        <span class="sx-chips">
          <span class="sx-chip">{{ size(s) }}</span>
          <span v-if="s.credits" class="sx-chip"><Cloud :size="11" />Runs on Cloud</span>
        </span>
        <span class="sx-name">{{ s.title }}</span>
      </div>
    </div>
  </CvFrame>

  <!-- 5 · A closing screen: open empty, or with a workflow. -->
  <CvFrame v-else :step="3" :steps="THREE" layout="wide">
    <h1 class="fo-title">ComfyUI is installed</h1>
    <p class="fo-lead">Open it empty, or start from a workflow. Its models download first.</p>
    <div class="sx is-1" style="margin-top: 24px">
      <div
        v-for="(s, i) in IMAGE_STARTERS"
        :key="s.id"
        class="sx-card"
        role="radio"
        :aria-checked="i === 0"
        style="aspect-ratio: 1"
      >
        <img :src="imgUrl(s.img)" alt="" />
        <span class="sx-chips">
          <span class="sx-chip">{{ size(s) }}</span>
          <span v-if="s.credits" class="sx-chip"><Cloud :size="11" />Runs on Cloud</span>
          <span v-else-if="s.tag" class="sx-chip">{{ s.tag }}</span>
        </span>
        <span class="sx-pick" aria-hidden="true"><Check :size="12" :stroke-width="3" /></span>
        <span class="sx-name">{{ s.title }}</span>
      </div>
    </div>
    <template #bar>
      <span class="cv-grow"></span>
      <span class="cv-btn">Open ComfyUI</span
      ><span class="cv-btn is-primary"
        >Open with {{ ZIT.title }}<span class="cv-n">· {{ ZIT.gb }} GB</span></span
      >
    </template>
  </CvFrame>
</template>

<style>
/* A shelf to browse, nothing picked yet: full colour, no ring. */
.sx-card.tp-plain::after {
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.08);
}
</style>
