<script setup lang="ts">
import { ArrowLeft, Check, Cpu, HardDrive, Package, Sparkles } from 'lucide-vue-next'
import CvFrame from './CvFrame.vue'
import { D, REQUIRED_GB } from './canvasData'

/**
 * One take on Set up ("Install ComfyUI on this Mac") for the canvas, in
 * place of the gradient machine card and the two rows. Same copy and data
 * as the flow; the takes differ in how the machine is shown and how each
 * line is changed.
 */
const { option } = defineProps<{ option: number }>()
</script>

<template>
  <CvFrame :layout="option === 9 ? 'wide' : 'center'">
    <div :class="option === 9 && 'cv-2col is-even'">
      <div>
        <h1 class="fo-title">Install ComfyUI on this Mac</h1>
        <p class="fo-lead">Checked for your {{ D.chip }}. Change anything before you install.</p>

        <!-- 1 · Spec line: the machine as one line, its own Change. -->
        <div v-if="option === 1" class="cv-row" style="margin-top: 20px; padding: 0">
          <dt><Cpu :size="15" />This Mac</dt>
          <dd>
            <span class="cv-val">{{ D.chip }} · {{ D.memGb }} GB · {{ D.build }}</span>
          </dd>
          <span class="cv-btn is-ghost is-sm">Change</span>
        </div>

        <!-- 4 · Drawn machine: a compact card, no gradient. -->
        <div
          v-if="option === 4 || option === 9"
          class="cv-tile"
          style="display: flex; align-items: center; gap: 18px; margin-top: 24px"
        >
          <span class="cv-laptop" aria-hidden="true"></span>
          <span class="grid cv-grow">
            <span class="cv-val" style="font-size: 15px; font-weight: 600"
              >{{ D.chip }} · {{ D.memGb }} GB</span
            >
            <span class="cv-meta">Detected. Uses the {{ D.build }} build.</span>
          </span>
          <span v-if="option === 4" class="cv-btn is-sm">Change</span>
        </div>
      </div>

      <div>
        <!-- 8 · Stat tiles: the three numbers that matter. -->
        <div v-if="option === 8" class="cv-tiles">
          <div class="cv-tile">
            <b>{{ D.memGb }} GB</b><span>{{ D.chip }}</span>
          </div>
          <div class="cv-tile">
            <b>{{ D.freeGb }} GB</b><span>free · ~{{ REQUIRED_GB }} GB required</span>
          </div>
          <div class="cv-tile">
            <b>{{ D.downloadGb }} GB</b><span>download · {{ D.version }}</span>
          </div>
        </div>

        <!-- 7 · Checked: what the checks found, in the voice of the lead. -->
        <dl v-if="option === 7" class="cv-check-list">
          <div class="cv-check-row">
            <dt class="cv-ok"><Check :size="12" :stroke-width="3" /></dt>
            <dd>
              <span class="cv-val">{{ D.chip }} · {{ D.memGb }} GB</span
              ><span class="cv-meta">Uses the {{ D.build }} build</span>
            </dd>
            <span class="cv-btn is-ghost is-sm">Change</span>
          </div>
          <div class="cv-check-row">
            <dt class="cv-ok"><Check :size="12" :stroke-width="3" /></dt>
            <dd>
              <span class="cv-val">{{ D.freeGb }} GB free in {{ D.path }}</span
              ><span class="cv-meta">~{{ REQUIRED_GB }} GB required</span>
            </dd>
            <span class="cv-btn is-ghost is-sm">Change</span>
          </div>
          <div class="cv-check-row">
            <dt class="cv-ok"><Check :size="12" :stroke-width="3" /></dt>
            <dd>
              <span class="cv-val">ComfyUI {{ D.version }} · Stable</span
              ><span class="cv-meta">{{ D.downloadGb }} GB download</span>
            </dd>
            <span class="cv-btn is-ghost is-sm">Change</span>
          </div>
        </dl>

        <!-- 10 · One sentence: each value is the control that changes it. -->
        <p v-if="option === 10" class="cv-sentence">
          ComfyUI <span class="cv-token">{{ D.version }} Stable</span> installs to
          <span class="cv-token">{{ D.path }}</span> and runs on
          <span class="cv-token">{{ D.build }}</span> on your {{ D.chip }}.
          <span class="cv-meta" style="display: block; margin-top: 8px; font-size: 13px"
            >{{ D.downloadGb }} GB download · ~{{ REQUIRED_GB }} GB required · {{ D.freeGb }} GB
            free</span
          >
        </p>

        <!-- The grouped list most takes share. -->
        <dl v-if="![7, 10].includes(option)" class="cv-list">
          <div v-if="[2, 3, 5, 6].includes(option)" class="cv-row">
            <dt><Cpu :size="15" />Machine</dt>
            <dd>
              <span class="cv-val">{{ D.chip }} · {{ D.memGb }} GB</span
              ><span class="cv-meta">{{ D.build }} · Detected</span>
            </dd>
            <span class="cv-btn is-ghost is-sm">Change</span>
          </div>
          <div class="cv-row" :class="option === 3 && 'is-open'">
            <dt><HardDrive :size="15" />Location</dt>
            <dd v-if="option === 3">
              <span class="cv-input"
                ><span>{{ D.path }}</span
                ><span class="cv-meta">{{ D.freeGb }} GB free</span
                ><span class="cv-btn is-sm">Browse…</span></span
              >
              <span class="cv-meta">~{{ REQUIRED_GB }} GB required</span>
            </dd>
            <dd v-else>
              <span class="cv-val">{{ D.path }}</span
              ><span class="cv-meta">{{ D.freeGb }} GB free · ~{{ REQUIRED_GB }} GB required</span>
            </dd>
            <span v-if="option === 3" class="cv-btn is-sm">Done</span>
            <span v-else class="cv-btn is-ghost is-sm">Change</span>
          </div>
          <div class="cv-row">
            <dt><Package :size="15" />Version</dt>
            <dd>
              <span class="cv-val">ComfyUI {{ D.version }} · Stable</span
              ><span class="cv-meta">{{ D.downloadGb }} GB download</span>
            </dd>
            <span class="cv-btn is-ghost is-sm">Change</span>
          </div>
          <div v-if="option === 6" class="cv-row">
            <dt><Sparkles :size="15" />Workflow</dt>
            <dd>
              <span class="cv-val">None</span
              ><span class="cv-meta">Open a ready-to-run workflow after install</span>
            </dd>
            <span class="cv-btn is-sm">Choose</span>
          </div>
          <div v-if="option === 5" class="cv-total">
            <span class="cv-grow"
              ><b>{{ D.downloadGb }} GB</b> download · <b>~{{ REQUIRED_GB }} GB</b> on disk</span
            >
            <span>{{ D.freeGb }} GB free</span>
          </div>
        </dl>
        <p v-if="option === 8" class="cv-meta" style="margin-top: 12px">
          Installs to {{ D.path }} · {{ D.build }}
        </p>
      </div>
    </div>

    <div class="cv-foot">
      <span class="cv-btn is-ghost"><ArrowLeft :size="14" />Back</span>
      <span class="cv-grow"></span>
      <span v-if="[8, 10].includes(option)" class="cv-btn">Change</span>
      <span class="cv-btn is-primary">Continue</span>
    </div>
  </CvFrame>
</template>
