<script setup lang="ts">
import { onMounted, ref } from 'vue'
import DesktopDialogSurface from './ui/DesktopDialogSurface.vue'
import Button from '@comfyorg/design-system/button/Button'
import { Volume2, VolumeX, X } from 'lucide-vue-next'
import { emitTelemetryAction } from '../lib/telemetry'

const ANNOUNCEMENT_ID = 'comfy_api'

const UTM = '?utm_source=comfy_desktop&utm_medium=announcement&utm_campaign=comfy_api'
const PRIMARY_CTA_URL = `https://comfy.org/platform/comfy-api${UTM}`

const HERO_VIDEO_URL = 'https://media.comfy.org/website/comfy-api/hero_v1.mp4'
const HERO_POSTER_URL = 'https://media.comfy.org/website/comfy-api/hero-poster_v1.webp'

const emit = defineEmits<{ close: [] }>()

const videoRef = ref<HTMLVideoElement | null>(null)
const isMuted = ref(true)
function toggleSound(): void {
  const v = videoRef.value
  if (!v) return
  v.muted = !v.muted
  isMuted.value = v.muted
  if (!v.muted) void v.play().catch(() => {})
  emitTelemetryAction('comfy.desktop.announcement.sound_toggled', {
    id: ANNOUNCEMENT_ID,
    muted: v.muted
  })
}
function dismiss(): void {
  emitTelemetryAction('comfy.desktop.announcement.dismissed', { id: ANNOUNCEMENT_ID })
  emit('close')
}
function openCta(cta: string, url: string): void {
  emitTelemetryAction('comfy.desktop.announcement.cta_clicked', { id: ANNOUNCEMENT_ID, cta })
  window.api?.openExternal?.(url)
}

onMounted(() => {
  emitTelemetryAction('comfy.desktop.announcement.shown', { id: ANNOUNCEMENT_ID })
})
</script>

<template>
  <DesktopDialogSurface
    :open="true"
    :aria-label="$t('announcement.comfyApi.title')"
    overlay-class="announce-overlay fixed inset-0 z-60 grid place-items-center px-[clamp(32px,5vw,80px)] pt-[clamp(72px,10vh,132px)] pb-[clamp(80px,11vh,140px)] bg-neutral-800/70"
    content-class="announce-content relative flex w-[min(100%,calc((100vh_-_clamp(152px,21vh,272px))_*_(916_/_445)))] max-w-full max-h-full aspect-[916/445] overflow-hidden rounded-panel border border-solid border-border bg-neutral-900 max-[800px]:h-full max-[800px]:aspect-auto"
    @close="dismiss"
  >
    <Button
      variant="muted-textonly"
      size="icon"
      class="announce-close absolute top-4 right-4 z-2"
      type="button"
      :aria-label="$t('common.close')"
      data-testid="announcement-close"
      @click="dismiss"
    >
      <X :size="18" />
    </Button>
    <div
      class="announce-grid flex-auto grid size-full grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] overflow-y-auto max-[800px]:grid-rows-[minmax(0,1fr)_auto]"
    >
      <div
        class="announce-media-wrap relative aspect-video w-full self-center max-[800px]:min-h-0 max-[800px]:aspect-auto max-[800px]:self-stretch"
      >
        <video
          ref="videoRef"
          class="announce-media block size-full object-cover bg-[linear-gradient(135deg,var(--neutral-800)_0%,var(--neutral-900)_100%)]"
          :poster="HERO_POSTER_URL"
          autoplay
          muted
          loop
          playsinline
          :aria-label="$t('announcement.comfyApi.imageAlt')"
        >
          <source :src="HERO_VIDEO_URL" type="video/mp4" />
        </video>
        <Button
          variant="secondary"
          size="icon"
          class="announce-sound absolute bottom-4 left-4 z-2"
          type="button"
          :aria-label="
            isMuted ? $t('announcement.comfyApi.unmute') : $t('announcement.comfyApi.mute')
          "
          :aria-pressed="!isMuted"
          data-testid="announcement-sound-toggle"
          @click="toggleSound"
        >
          <VolumeX v-if="isMuted" :size="16" />
          <Volume2 v-else :size="16" />
        </Button>
      </div>
      <div
        class="announce-body flex flex-col justify-between overflow-auto p-[clamp(1.5rem,2.5vw,2.5rem)] max-[800px]:overflow-visible"
      >
        <div
          class="announce-body-main flex flex-auto flex-col justify-center gap-[clamp(0.75rem,1.2vw,1.25rem)]"
        >
          <header class="announce-header flex flex-wrap items-center gap-3">
            <h2
              class="announce-title m-0 font-display text-[length:var(--takeover-fs-h2)] leading-8 font-extrabold tracking-normal text-neutral-100"
            >
              {{ $t('announcement.comfyApi.title') }}
            </h2>
          </header>
          <p
            class="announce-lead m-0 font-sans text-[length:var(--takeover-fs-lead)] leading-[normal] font-normal text-neutral-300"
          >
            {{ $t('announcement.comfyApi.lead') }}
          </p>
        </div>
        <footer
          class="announce-footer flex items-center justify-end gap-4 border-t border-solid border-neutral-100/8 pt-[clamp(1rem,1.5vw,1.5rem)]"
        >
          <Button
            size="lg"
            variant="inverted"
            class="announce-primary whitespace-normal"
            type="button"
            data-testid="announcement-primary-cta"
            @click="openCta('learn_more', PRIMARY_CTA_URL)"
          >
            {{ $t('announcement.comfyApi.primaryCta') }}
          </Button>
        </footer>
      </div>
    </div>
  </DesktopDialogSurface>
</template>
