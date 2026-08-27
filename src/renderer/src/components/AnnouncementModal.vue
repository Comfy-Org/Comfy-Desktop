<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Volume2, VolumeX, X } from 'lucide-vue-next'
import { emitTelemetryAction } from '../lib/telemetry'

/**
 * One-off announcement modal (MiniMax license launch). Deliberately mirrors
 * `WhyTryCloudModal.vue`'s layout and styling so it feels native.
 *
 * DRAFT COPY: strings live in `announcement.minimax.*` (locales/en.json) for nav to finalize.
 */

// Announcement id — carried in telemetry so this component can be reused for a
// future announcement by swapping the id + copy.
const ANNOUNCEMENT_ID = 'minimax_license'

// CTA destinations (from #desktop thread). Confirm the final URLs before merge.
const REQUEST_LICENSE_URL = 'https://comfy.org/minimax/license'
const LEARN_MORE_URL = 'https://blog.comfy.org/p/2ec77c32-7dd6-4a99-b763-fffe1580b842'

// Hero video (from nav's MiniMax license LP, ComfyUI_frontend#16118) hosted on
// media.comfy.org. Poster paints immediately; the video muted-autoplays + loops.
const HERO_VIDEO_URL = 'https://media.comfy.org/website/minimax-license/hero.mp4'
const HERO_POSTER_URL = 'https://media.comfy.org/website/minimax-license/hero-poster.jpg'

const emit = defineEmits<{ close: [] }>()
const { tm } = useI18n()

const highlights = computed<string[]>(() => {
  const raw = tm('announcement.minimax.highlights')
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
  // Focus the dialog container, not a button — traps focus without a ring on open.
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
        class="announce-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="$t('announcement.minimax.title')"
        tabindex="-1"
        @mousedown="onOverlayMouseDown"
        @click="onOverlayClick"
      >
        <div class="announce-content modal-fade-panel">
          <button
            class="announce-close"
            type="button"
            :aria-label="$t('common.close')"
            data-testid="announcement-close"
            @click="dismiss"
          >
            <X :size="18" />
          </button>
          <div class="announce-grid">
            <div class="announce-media-wrap">
              <video
                ref="videoRef"
                class="announce-media"
                :poster="HERO_POSTER_URL"
                autoplay
                muted
                loop
                playsinline
                :aria-label="$t('announcement.minimax.imageAlt')"
              >
                <source :src="HERO_VIDEO_URL" type="video/mp4" />
              </video>
              <button
                class="announce-sound"
                type="button"
                :aria-label="
                  isMuted ? $t('announcement.minimax.unmute') : $t('announcement.minimax.mute')
                "
                :aria-pressed="!isMuted"
                data-testid="announcement-sound-toggle"
                @click="toggleSound"
              >
                <VolumeX v-if="isMuted" :size="16" />
                <Volume2 v-else :size="16" />
              </button>
            </div>
            <div class="announce-body">
              <div class="announce-body-main">
                <header class="announce-header">
                  <h2 class="announce-title">{{ $t('announcement.minimax.title') }}</h2>
                </header>
                <p class="announce-lead">{{ $t('announcement.minimax.lead') }}</p>
                <ul v-if="highlights.length" class="announce-list">
                  <li v-for="h in highlights" :key="h">
                    <Check :size="16" class="announce-check" />
                    <span>{{ h }}</span>
                  </li>
                </ul>
              </div>
              <footer class="announce-footer">
                <button
                  class="brand-ghost"
                  type="button"
                  data-testid="announcement-learn-more"
                  @click="openCta('learn_more', LEARN_MORE_URL)"
                >
                  {{ $t('announcement.minimax.learnMoreCta') }}
                </button>
                <button
                  class="brand-primary"
                  type="button"
                  data-testid="announcement-request-license"
                  @click="openCta('request_license', REQUEST_LICENSE_URL)"
                >
                  {{ $t('announcement.minimax.requestLicenseCta') }}
                </button>
              </footer>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Mirrors WhyTryCloudModal.vue — keep the two visually consistent. */
.announce-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: clamp(72px, 10vh, 132px) clamp(32px, 5vw, 80px) clamp(80px, 11vh, 140px);
  background: color-mix(in oklab, var(--neutral-800) 70%, transparent);
  backdrop-filter: blur(8px) saturate(115%);
  -webkit-backdrop-filter: blur(8px) saturate(115%);
}

.announce-content {
  position: relative;
  display: flex;
  width: min(100%, calc((100vh - clamp(152px, 21vh, 272px)) * (916 / 445)));
  max-width: 100%;
  max-height: 100%;
  aspect-ratio: 916 / 445;
  border-radius: 16px;
  overflow: hidden;
  background: var(--neutral-900);
  border: 1px solid color-mix(in oklab, var(--neutral-100) 8%, transparent);
}

.announce-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 8px;
  background: color-mix(in oklab, var(--text) 4%, transparent);
  opacity: 0.7;
  color: var(--neutral-100);
  cursor: pointer;
  transition:
    border-color 120ms ease,
    opacity 120ms ease;
}
.announce-close:hover {
  border-color: color-mix(in oklab, var(--neutral-100) 44%, transparent);
  opacity: 1;
}
.announce-close:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.announce-close :deep(svg) {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  stroke: currentColor;
}

.announce-grid {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr));
  width: 100%;
  height: 100%;
}

.announce-media-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}
.announce-media {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: linear-gradient(135deg, var(--neutral-800) 0%, var(--neutral-900) 100%);
}

/* Sound toggle — mirrors .announce-close, pinned to the video's lower-left. */
.announce-sound {
  position: absolute;
  bottom: 16px;
  left: 16px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 8px;
  background: color-mix(in oklab, var(--neutral-900) 55%, transparent);
  opacity: 0.85;
  color: var(--neutral-100);
  cursor: pointer;
  transition:
    border-color 120ms ease,
    opacity 120ms ease;
}
.announce-sound:hover {
  border-color: color-mix(in oklab, var(--neutral-100) 44%, transparent);
  opacity: 1;
}
.announce-sound:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.announce-sound :deep(svg) {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  stroke: currentColor;
}

.announce-body {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: clamp(1.5rem, 2.5vw, 2.5rem);
  overflow: auto;
}
.announce-body-main {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(0.75rem, 1.2vw, 1.25rem);
}

.announce-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.announce-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--takeover-fs-h2);
  font-weight: 800;
  letter-spacing: 0;
  color: var(--neutral-100);
  line-height: 32px;
}
.announce-lead {
  margin: 0;
  font-size: var(--takeover-fs-lead);
  color: var(--neutral-300);
  font-weight: 400;
  font-family: var(--font-sans);
  line-height: normal;
}

.announce-list {
  list-style: none;
  margin: 4px 0 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.announce-list li {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: start;
  gap: 12px;
  font-size: var(--takeover-fs-lead);
  color: var(--neutral-100);
  line-height: normal;
}
.announce-check {
  color: var(--comfy-yellow);
  margin-top: 3px;
}

.announce-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 16px;
  padding-top: clamp(1rem, 1.5vw, 1.5rem);
  border-top: 1px solid color-mix(in oklab, var(--neutral-100) 8%, transparent);
}
</style>
