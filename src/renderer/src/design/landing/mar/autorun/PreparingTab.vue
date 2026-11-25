<script setup lang="ts">
import { computed, ref } from 'vue'
import { HardDrive, Pause, Play, RotateCw, TriangleAlert, X } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import LocationIcon from '../../ui/LocationIcon.vue'
import { hostActions, instances, proto, toast } from '../../useProto'
import { browserSignIn, SIGN_IN_COPY } from '../signIn/browserSignIn'
import MarRunCreditsSheet from '../MarRunCreditsSheet.vue'
import { runBlock } from '../runCredits'
import {
  cancel,
  copyFor,
  downloadFor,
  freeUpSpace,
  pause,
  progressOf,
  resume,
  retry
} from '../downloads/templateDownloads'
import {
  fmtGb,
  mediaFor,
  needsFor,
  targetFor,
  totalGb,
  tplById
} from '../templateModal/templateData'
import { runTemplate, shortName } from './autorun'
import type { PrepTab } from './prepTabs'
import { BUILD_INSTALLING, cancelInstall, installPhase } from './installThenRun'

const { prep } = defineProps<{ prep: PrepTab }>()

const t = computed(() => tplById(prep.templateId))
const d = computed(() => downloadFor(prep.templateId))
const copy = computed(() => (d.value ? copyFor(d.value) : undefined))
const installing = computed(() => prep.install)
const installLine = computed(() => {
  const i = installing.value
  if (!i || !t.value) return ''
  const phase = installPhase(i.percent)
  return needsFor(t.value).length ? `${phase} · then ${fmtGb(totalGb(t.value))} of models` : phase
})
const line = computed(() =>
  installing.value
    ? installLine.value
    : d.value?.status === 'downloading'
      ? copy.value?.detail.replace(/ · \d+ MB\/s/, '')
      : copy.value?.detail
)
const title = computed(() => {
  if (installing.value) return BUILD_INSTALLING
  const s = d.value?.status
  const name = t.value ? shortName(t.value) : ''
  if (s === 'failed') return `${name} · download stopped`
  if (s === 'disk') return `${name} · not enough disk space`
  if (s === 'paused') return `${name} · paused`
  return `Preparing ${name}`
})
const live = computed(() => d.value?.status === 'downloading' || d.value?.status === 'paused')
const progress = computed(() =>
  installing.value ? installing.value.percent / 100 : d.value ? progressOf(d.value) : 0
)

const cloud = computed(() => instances.value.find((i) => i.kind === 'cloud' && !i.deployment))
const cloudTarget = computed(() =>
  t.value && cloud.value ? targetFor(t.value, cloud.value, proto.signedIn) : undefined
)
const cloudOffer = computed(
  () => cloudTarget.value && !cloudTarget.value.disabled && cloudTarget.value.state !== 'blocked'
)
const creditsSheet = ref(false)
function tryCloud(): void {
  const c = cloudTarget.value
  if (!c || !t.value) return
  if (c.state === 'login') {
    hostActions.signIn(tryCloud)
    return
  }
  if (c.state === 'credits' || c.state === 'plan') {
    toast(
      c.state === 'credits' ? 'Add credits opens in your browser' : 'Plans open in your browser'
    )
    return
  }
  if (runBlock.value) {
    creditsSheet.value = true
    return
  }
  runTemplate(t.value, c.inst)
}
</script>

<template>
  <div
    v-if="t && (d || installing)"
    class="flex min-h-0 flex-1 items-center justify-center px-6"
    data-preparing-tab
    :data-download="installing ? 'install' : d?.status"
  >
    <div class="flex w-full max-w-100 flex-col gap-5">
      <div class="flex items-center gap-3">
        <img
          :src="mediaFor(t).output"
          alt=""
          class="size-12 shrink-0 rounded-control object-cover"
        />
        <div class="min-w-0">
          <p class="m-0 flex items-center gap-1.5 truncate text-body font-medium">
            <TriangleAlert
              v-if="d?.status === 'failed'"
              :size="14"
              class="shrink-0 text-status-danger"
            />
            <HardDrive
              v-else-if="d?.status === 'disk'"
              :size="14"
              class="shrink-0 text-comfy-yellow"
            />{{ title }}
          </p>
          <p class="m-0 text-ui text-muted-foreground tabular-nums">{{ line }}</p>
        </div>
      </div>
      <div
        class="h-1 overflow-hidden rounded-full bg-secondary-background-hover"
        aria-hidden="true"
      >
        <div
          class="h-full origin-left rounded-full transition-transform duration-200 ease-linear motion-reduce:transition-none"
          :class="
            d?.status === 'failed'
              ? 'bg-status-danger'
              : d?.status === 'disk'
                ? 'bg-comfy-yellow'
                : d?.status === 'paused'
                  ? 'bg-muted-foreground'
                  : 'bg-base-foreground'
          "
          :style="{ transform: `scaleX(${progress})` }"
        />
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button v-if="installing" variant="ghost" size="md" @click="cancelInstall(prep.tabId)"
          ><X :size="14" />Cancel</Button
        >
        <Button v-else-if="d?.status === 'failed'" variant="primary" size="md" @click="retry(d.id)">
          <RotateCw :size="14" />Retry
        </Button>
        <Button
          v-else-if="d?.status === 'disk'"
          variant="primary"
          size="md"
          @click="freeUpSpace(d.id)"
        >
          <HardDrive :size="14" />Free up space
        </Button>
        <Button
          v-else-if="live && d"
          variant="secondary"
          size="md"
          @click="d.status === 'paused' ? resume(d.id) : pause(d.id)"
        >
          <Play v-if="d.status === 'paused'" :size="14" />
          <Pause v-else :size="14" />{{ d.status === 'paused' ? 'Resume' : 'Pause' }}
        </Button>
        <Button v-if="d && !installing" variant="ghost" size="md" @click="cancel(d.id)"
          ><X :size="14" />Cancel</Button
        >
        <span class="flex-1" />
        <Button
          v-if="cloudOffer"
          variant="secondary"
          size="md"
          data-tab-cloud
          :disabled="browserSignIn.pending"
          @click="tryCloud"
        >
          <LocationIcon kind="cloud" :size="14" />{{
            browserSignIn.pending && cloudTarget?.state === 'login'
              ? SIGN_IN_COPY.waiting
              : 'Try it now on Cloud'
          }}
        </Button>
      </div>
    </div>
    <MarRunCreditsSheet v-model:open="creditsSheet" @resolved="tryCloud" />
  </div>
</template>
