<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { Check, Volume2, VolumeX, X } from 'lucide-vue-next'
import { emitTelemetryAction } from '../lib/telemetry'

/**
 * One-off announcement modal (currently the Comfy API launch).
 * Deliberately mirrors `WhyTryCloudModal.vue`'s layout and styling so it feels
 * native. Swapping to the next announcement means changing ANNOUNCEMENT_ID, the
 * URLs, the hero media and the i18n namespace below, plus a new seen-flag in
 * settings so previously-dismissed users still get the bell.
 *
 * Strings live in `announcement.comfyApi.*` (locales/en.json).
 */

// Announcement id, carried in telemetry so this component can be reused for a
// future announcement by swapping the id + copy.
const ANNOUNCEMENT_ID = 'comfy_api'

// CTA destination. The UTM tags clicks as Desktop-origin so they're
// attributable in analytics.
const UTM = '?utm_source=comfy_desktop&utm_medium=announcement&utm_campaign=comfy_api'
const PRIMARY_CTA_URL = `https://comfy.org/platform/comfy-api${UTM}`

// Comfy API launch hero on media.comfy.org. media.comfy.org caches for an
// hour, so bump the version in the filename rather than re-uploading a key.
// Poster paints immediately; the video muted-autoplays + loops.
// TODO: no hero asset has been provided for Comfy API yet (tracked the same
// way #1560 tracked the Router hero) - this path 404s until it's uploaded, so
// the modal falls back to the `.announce-media` gradient in the meantime.
const HERO_VIDEO_URL = 'https://media.comfy.org/website/comfy-api/hero_v1.mp4'
const HERO_POSTER_URL = 'https://media.comfy.org/website/comfy-api/hero-poster_v1.webp'

const emit = defineEmits<{ close: [] }>()
const { tm } = useI18n()

const highlights = computed<string[]>(() => {
  const raw = tm('announcement.comfyApi.highlights')
  return Array.isArray(raw) ? (raw as unknown as string[]) : []
})

const overlayRef = ref<HTMLDivElement | null>(null)
const mouseDownOnOverlay = ref(false)

// Video autoplays muted (browsers block audible autoplay); users opt into sound.
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
// Element focused before open; restored on close to return focus to the trigger.
let returnFocusTo: HTMLElement | null = null

function dismiss(): void {
  emitTelemetryAction('comfy.desktop.announcement.dismissed', { id: ANNOUNCEMENT_ID })
  emit('close')
}
function openCta(cta: string, url: string): void {
  emitTelemetryAction('comfy.desktop.announcement.cta_clicked', { id: ANNOUNCEMENT_ID, cta })
  window.api?.openExternal?.(url)
}

function onOverlayMouseDown(e: MouseEvent) {
  mouseDownOnOverlay.value = e.target === overlayRef.value
}
function onOverlayClick(e: MouseEvent) {
  if (e.target === overlayRef.value && mouseDownOnOverlay.value) dismiss()
  mouseDownOnOverlay.value = false
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') dismiss()
}

onMounted(() => {
  emitTelemetryAction('comfy.desktop.announcement.shown', { id: ANNOUNCEMENT_ID })
  document.addEventListener('keydown', onKeydown)
  returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  // Focus the dialog container, not a button. Traps focus without a ring on open.
  void nextTick(() => overlayRef.value?.focus())
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  returnFocusTo?.focus()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade" appear>
      <div
        ref="overlayRef"
        class="announce-overlay fixed inset-0 z-60 grid place-items-center px-[clamp(32px,5vw,80px)] pt-[clamp(72px,10vh,132px)] pb-[clamp(80px,11vh,140px)] bg-neutral-800/70 backdrop-blur-[8px] backdrop-saturate-[115%]"
        role="dialog"
        aria-modal="true"
        :aria-label="$t('announcement.comfyApi.title')"
        tabindex="-1"
        @mousedown="onOverlayMouseDown"
        @click="onOverlayClick"
      >
        <div
          class="announce-content modal-fade-panel relative flex w-[min(100%,calc((100vh_-_clamp(152px,21vh,272px))_*_(916_/_445)))] max-w-full max-h-full aspect-[916/445] overflow-hidden rounded-panel border border-solid border-border bg-neutral-900 max-[800px]:h-full max-[800px]:aspect-auto"
        >
          <button
            class="announce-close absolute top-4 right-4 z-2 inline-flex size-8 items-center justify-center rounded-lg border border-solid border-[var(--border)] bg-text/4 p-0 text-neutral-100 opacity-70 cursor-pointer transition-[border-color,opacity] duration-120 ease-[ease] hover:border-neutral-100/44 hover:opacity-100 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] [&_svg]:size-[18px] [&_svg]:flex-none [&_svg]:stroke-current"
            type="button"
            :aria-label="$t('common.close')"
            data-testid="announcement-close"
            @click="dismiss"
          >
            <X :size="18" />
          </button>
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
              <button
                class="announce-sound absolute bottom-4 left-4 z-2 inline-flex size-8 items-center justify-center rounded-lg border border-solid border-[var(--border)] bg-neutral-900/55 p-0 text-neutral-100 opacity-85 cursor-pointer transition-[border-color,opacity] duration-120 ease-[ease] hover:border-neutral-100/44 hover:opacity-100 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] [&_svg]:size-4 [&_svg]:flex-none [&_svg]:stroke-current"
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
              </button>
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
                <ul
                  v-if="highlights.length"
                  class="announce-list mt-1 mr-0 mb-0 ml-0 flex list-none flex-col gap-2.5 p-0 [&>li]:grid [&>li]:grid-cols-[auto_1fr] [&>li]:items-start [&>li]:gap-3 [&>li]:text-[length:var(--takeover-fs-lead)] [&>li]:leading-[normal] [&>li]:text-neutral-100"
                >
                  <li v-for="h in highlights" :key="h">
                    <Check :size="16" class="announce-check mt-[3px] text-comfy-yellow" />
                    <span>{{ h }}</span>
                  </li>
                </ul>
              </div>
              <footer
                class="announce-footer flex items-center justify-end gap-4 border-t border-solid border-neutral-100/8 pt-[clamp(1rem,1.5vw,1.5rem)]"
              >
                <Button
                  size="unset"
                  variant="textonly"
                  class="announce-primary static inline-flex touch-auto items-center justify-center gap-0 rounded-[var(--radius-control)] border border-solid border-comfy-yellow bg-comfy-yellow px-4 py-2.5 font-sans text-[length:var(--takeover-fs-body)] leading-[inherit] font-medium whitespace-normal text-neutral-900 cursor-pointer transition-[background,border-color,color] duration-120 ease-[ease] [&]:[appearance:button] enabled:hover:border-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] enabled:hover:bg-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] focus-visible:ring-0 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--comfy-yellow)_80%,var(--neutral-100))] disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-55"
                  type="button"
                  data-testid="announcement-primary-cta"
                  @click="openCta('learn_more', PRIMARY_CTA_URL)"
                >
                  {{ $t('announcement.comfyApi.primaryCta') }}
                </Button>
              </footer>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
