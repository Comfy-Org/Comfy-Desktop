<script setup lang="ts">
import type { CoachmarkBeakPayload } from '../../../types/ipc'
import { nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'

/**
 * Title-tooltip popup renderer. Renders the hover bubble (and onboarding
 * coachmark) and reports its rendered size to main on each config update so
 * main resizes the popup view before showing it. Used because macOS doesn't
 * reliably surface native `title` tooltips for unfocused sibling chrome views.
 */

interface TooltipConfig {
  /** `'tooltip'` (default) for the hover bubble; `'coachmark'` for the
   *  onboarding card. */
  variant?: 'tooltip' | 'coachmark'
  /** Hover-bubble body (tooltip variant). */
  text?: string
  /** Coachmark title + body + dismiss label (coachmark variant). */
  title?: string
  body?: string
  dismissLabel?: string
  /** Secondary action beside dismiss, when the card has one. Absent = dismiss-only. */
  actionLabel?: string
  theme: { bg: string; text: string; border: string; accent?: string }
  configToken: string
}

interface Bridge {
  ready(): void
  notifyRendered(payload: { width: number; height: number; configToken: string }): void
  onConfig(cb: (config: TooltipConfig) => void): () => void
  /** Coachmark dismiss button — tells main to hide + persist the
   *  once-ever flag. No-op for the tooltip variant. */
  dismissCoachmark?(configToken: string): void
  /** Beak position as a fraction of the card's width, pushed once main has measured the card
   *  and settled its final bounds. */
  onBeak?(cb: (payload: CoachmarkBeakPayload) => void): () => void
  /** Coachmark secondary action — retires the card the same way dismiss does, and lets the
   *  owning feature run its follow-up (e.g. opening Settings). */
  actionCoachmark?(configToken: string): void
}

const bridge = (window as unknown as { __comfyTitleTooltip?: Bridge }).__comfyTitleTooltip

const variant = ref<'tooltip' | 'coachmark'>('tooltip')
const text = ref<string>('')
const cmTitle = ref<string>('')
const cmBody = ref<string>('')
const cmDismissLabel = ref<string>('Got it')
const cmActionLabel = ref<string>('')
/** Defaults to centred, which is what a card with no clamp and a correct anchor resolves to
 *  anyway — so a missed push degrades to the old behaviour rather than to a detached beak. */
const cmBeakFraction = ref<number>(0.5)
/** Where the card's midpoint belongs inside the view, as MAIN computed it — `null` until it
 *  arrives, and on an older main that never sends it, which falls back to the CSS centring.
 *
 *  Placement comes from main because centring here measures this page's own width, and that
 *  width is sometimes still the pre-resize value: the view has new bounds and the page has not
 *  processed them. Centring against it puts the card one gutter off the anchor, and the beak
 *  is pinned to the card, so the whole thing points beside the bell. Measured at 8px, with the
 *  page reporting 300 inside a 316-wide view.
 *
 *  A centre rather than a left edge, so it stays correct at whatever width the card actually
 *  renders — `translateX(-50%)` offsets by half of the real card, not half of an assumed one. */
const cmCardCentre = ref<number | null>(null)
// Until main's config arrives: the Void tooltip (main/popups/titleTooltip.ts).
const themeBg = ref<string>('#f0f0f1')
const themeText = ref<string>('#141415')
const themeBorder = ref<string>('#f0f0f1')
const themeAccent = ref<string>('#f0f0f1')
const coachmarkBorder = 'rgba(255, 255, 255, 0.22)'
/** Token of the latest config, echoed in every render-ack so main can discard
 *  stale acks. */
let currentConfigToken = ''

const bubbleRef = useTemplateRef<HTMLElement>('bubble')

let unsubConfig: (() => void) | undefined
let unsubBeak: (() => void) | undefined

/** Wait for the Inter web font before measuring, else the first show measures in
 *  the fallback font and reports a wrong size, making the bubble visibly
 *  re-size when the real font paints. */
async function measureAndAck(): Promise<void> {
  // Capture the token now; a config change mid-await produces a stale ack that
  // main ignores because the token won't match.
  const token = currentConfigToken
  if (document.fonts && typeof document.fonts.ready?.then === 'function') {
    try {
      await document.fonts.ready
    } catch {
      // Best-effort — fall through to measuring with whatever's loaded.
    }
  }
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const el = bubbleRef.value
  if (!el) {
    bridge?.notifyRendered({ width: 0, height: 0, configToken: token })
    return
  }
  const rect = el.getBoundingClientRect()
  bridge?.notifyRendered({
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height),
    configToken: token
  })
}

onMounted(() => {
  unsubConfig = bridge?.onConfig((cfg) => {
    currentConfigToken = cfg.configToken
    variant.value = cfg.variant === 'coachmark' ? 'coachmark' : 'tooltip'
    text.value = cfg.text ?? ''
    cmTitle.value = cfg.title ?? ''
    cmBody.value = cfg.body ?? ''
    cmDismissLabel.value = cfg.dismissLabel ?? cmDismissLabel.value
    // Reset rather than retain: one popup serves several cards, so a dismiss-only card
    // following an actioned one must not inherit the previous card's button.
    cmActionLabel.value = cfg.actionLabel ?? ''
    themeBg.value = cfg.theme.bg
    themeText.value = cfg.theme.text
    themeBorder.value = cfg.theme.border
    if (cfg.theme.accent) themeAccent.value = cfg.theme.accent
    void measureAndAck()
  })
  unsubBeak = bridge?.onBeak?.(({ beakFraction, cardCentreInView }) => {
    cmBeakFraction.value = Math.min(1, Math.max(0, beakFraction))
    // `?? null` and a finiteness guard, not a `=== null` test: an older preload sends
    // `undefined`, which would otherwise reach the style binding and emit `undefinedpx`.
    cmCardCentre.value =
      typeof cardCentreInView === 'number' && Number.isFinite(cardCentreInView)
        ? Math.max(0, cardCentreInView)
        : null
  })
  bridge?.ready()
  // Re-measure if Inter loads mid-session (after the initial ack) so main can
  // resize to the new metrics.
  if (document.fonts && typeof document.fonts.addEventListener === 'function') {
    document.fonts.addEventListener('loadingdone', () => {
      if (text.value) void measureAndAck()
    })
  }
})

// Defensive re-measure if rendered text changes outside the config push (HMR,
// future mutations that bypass `onConfig`). `cmActionLabel` is in here because adding or
// dropping the action button changes the card's measured width.
watch([text, cmTitle, cmBody, cmActionLabel], () => {
  void measureAndAck()
})

function onDismiss(): void {
  bridge?.dismissCoachmark?.(currentConfigToken)
}

function onAction(): void {
  bridge?.actionCoachmark?.(currentConfigToken)
}

onUnmounted(() => {
  unsubConfig?.()
  unsubBeak?.()
})
</script>

<template>
  <div
    v-if="variant === 'coachmark'"
    ref="bubble"
    class="coachmark relative mx-auto mt-[7px] box-border block w-max max-w-[280px] select-none rounded-[10px] border border-solid px-3.5 py-3 font-sans text-[13px] leading-[1.45] font-normal [box-shadow:inset_0_0_0_1px_rgba(255,255,255,0.04),0_8px_24px_rgba(0,0,0,0.5)]"
    role="dialog"
    aria-modal="false"
    :aria-label="cmTitle"
    :style="{
      background: themeBg,
      color: themeText,
      borderColor: coachmarkBorder,
      ...(cmCardCentre === null
        ? {}
        : {
            marginLeft: '0',
            marginRight: '0',
            position: 'relative',
            left: `${cmCardCentre}px`,
            transform: 'translateX(-50%)'
          })
    }"
  >
    <span
      class="coachmark-beak absolute -top-1.5 left-1/2 size-3 rounded-tl-[3px] border-t border-l border-solid [transform:translateX(-50%)_rotate(45deg)]"
      :style="{
        background: themeBg,
        borderColor: coachmarkBorder,
        left: `${cmBeakFraction * 100}%`
      }"
    />
    <div class="coachmark-body">
      <div
        class="coachmark-title text-[13px] font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]"
        :style="{ color: themeAccent }"
      >
        {{ cmTitle }}
      </div>
      <p
        class="coachmark-text mt-1 mr-0 mb-2.5 ml-0 text-[12px] leading-[1.5] opacity-88 [overflow-wrap:anywhere]"
      >
        {{ cmBody }}
      </p>
      <div class="coachmark-actions flex items-center gap-3.5">
        <button
          v-if="cmActionLabel"
          type="button"
          class="coachmark-action appearance-none border-0 border-none border-current bg-transparent px-0 py-0.5 font-[inherit] text-[12px] leading-[inherit] font-semibold cursor-pointer hover:underline"
          :style="{ color: themeAccent }"
          @click="onAction"
        >
          {{ cmActionLabel }}
        </button>
        <button
          type="button"
          class="coachmark-dismiss appearance-none border-0 border-none border-current bg-transparent px-0 py-0.5 font-[inherit] text-[12px] leading-[inherit] font-semibold cursor-pointer hover:underline"
          :style="{ color: themeAccent }"
          @click="onDismiss"
        >
          {{ cmDismissLabel }}
        </button>
      </div>
    </div>
  </div>
  <!-- No empty light bubble while main's first config is on its way. -->
  <span
    v-else-if="text"
    ref="bubble"
    class="bubble pointer-events-none box-border inline-block w-max max-w-[260px] select-none rounded-md border border-solid px-2.5 py-1.5 font-sans text-[12px] leading-[1.4] font-normal tracking-normal whitespace-normal [box-shadow:0_4px_12px_rgba(0,0,0,0.35)]"
    :style="{
      background: themeBg,
      color: themeText,
      borderColor: themeBorder
    }"
    >{{ text }}</span
  >
</template>
