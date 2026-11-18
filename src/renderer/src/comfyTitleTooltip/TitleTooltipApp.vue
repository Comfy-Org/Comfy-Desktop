<script setup lang="ts">
import type { CoachmarkBeakPayload } from '../../../types/ipc'
import { nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'

interface TooltipConfig {
  variant?: 'tooltip' | 'coachmark'
  text?: string
  title?: string
  body?: string
  dismissLabel?: string
  actionLabel?: string
  theme: { bg: string; text: string; border: string; accent?: string }
  configToken: string
}

interface Bridge {
  ready(): void
  notifyRendered(payload: { width: number; height: number; configToken: string }): void
  onConfig(cb: (config: TooltipConfig) => void): () => void
  dismissCoachmark?(configToken: string): void
  onBeak?(cb: (payload: CoachmarkBeakPayload) => void): () => void
  actionCoachmark?(configToken: string): void
}

const bridge = (window as unknown as { __comfyTitleTooltip?: Bridge }).__comfyTitleTooltip

const variant = ref<'tooltip' | 'coachmark'>('tooltip')
const text = ref<string>('')
const cmTitle = ref<string>('')
const cmBody = ref<string>('')
const cmDismissLabel = ref<string>('Got it')
const cmActionLabel = ref<string>('')
const cmBeakFraction = ref<number>(0.5)
const cmCardCentre = ref<number | null>(null)
const themeBg = ref<string>('rgba(42, 42, 42, 0.94)')
const themeText = ref<string>('#f0f0f0')
const themeBorder = ref<string>('rgba(241, 241, 241, 0.07)')
const themeAccent = ref<string>('#f0f0f1')
const coachmarkBorder = 'rgba(255, 255, 255, 0.22)'
let currentConfigToken = ''

const bubbleRef = useTemplateRef<HTMLElement>('bubble')

let unsubConfig: (() => void) | undefined
let unsubBeak: (() => void) | undefined

async function measureAndAck(): Promise<void> {
  const token = currentConfigToken
  if (document.fonts && typeof document.fonts.ready?.then === 'function') {
    try {
      await document.fonts.ready
    } catch {}
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
    cmActionLabel.value = cfg.actionLabel ?? ''
    themeBg.value = cfg.theme.bg
    themeText.value = cfg.theme.text
    themeBorder.value = cfg.theme.border
    if (cfg.theme.accent) themeAccent.value = cfg.theme.accent
    void measureAndAck()
  })
  unsubBeak = bridge?.onBeak?.(({ beakFraction, cardCentreInView }) => {
    cmBeakFraction.value = Math.min(1, Math.max(0, beakFraction))
    cmCardCentre.value =
      typeof cardCentreInView === 'number' && Number.isFinite(cardCentreInView)
        ? Math.max(0, cardCentreInView)
        : null
  })
  bridge?.ready()
  if (document.fonts && typeof document.fonts.addEventListener === 'function') {
    document.fonts.addEventListener('loadingdone', () => {
      if (text.value) void measureAndAck()
    })
  }
})

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
          class="coachmark-action rounded-lg appearance-none border-0 border-none border-current bg-transparent px-0 py-0.5 font-[inherit] text-[12px] leading-[inherit] font-semibold cursor-pointer hover:underline"
          :style="{ color: themeAccent }"
          @click="onAction"
        >
          {{ cmActionLabel }}
        </button>
        <button
          type="button"
          class="coachmark-dismiss rounded-lg appearance-none border-0 border-none border-current bg-transparent px-0 py-0.5 font-[inherit] text-[12px] leading-[inherit] font-semibold cursor-pointer hover:underline"
          :style="{ color: themeAccent }"
          @click="onDismiss"
        >
          {{ cmDismissLabel }}
        </button>
      </div>
    </div>
  </div>
  <span
    v-else-if="text"
    ref="bubble"
    class="bubble pointer-events-none box-border inline-block w-max max-w-[256px] select-none rounded-control border border-solid px-[9px] py-[5px] font-sans text-[12px] leading-[16.2px] font-medium tracking-normal whitespace-normal [box-shadow:0_8px_12px_rgba(0,0,0,0.5)]"
    :style="{
      background: themeBg,
      color: themeText,
      borderColor: themeBorder
    }"
    >{{ text }}</span
  >
</template>
