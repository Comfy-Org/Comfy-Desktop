<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { Check, X } from 'lucide-vue-next'
import heroUrl from '../assets/first-use/why-cloud-hero.svg'

const emit = defineEmits<{
  close: []
  'try-cloud': []
}>()

const { tm } = useI18n()

const benefits = computed<string[]>(() => {
  const raw = tm('firstUse.whyCloud.benefits')
  return Array.isArray(raw) ? (raw as unknown as string[]) : []
})

const overlayRef = ref<HTMLDivElement | null>(null)
const mouseDownOnOverlay = ref(false)
// Element focused before open; restored on close to return focus to the trigger.
let returnFocusTo: HTMLElement | null = null

function onOverlayMouseDown(e: MouseEvent) {
  mouseDownOnOverlay.value = e.target === overlayRef.value
}
function onOverlayClick(e: MouseEvent) {
  if (e.target === overlayRef.value && mouseDownOnOverlay.value) emit('close')
  mouseDownOnOverlay.value = false
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  // Focus the dialog container, not the close button — keeps focus trapped for
  // keyboard/AT without painting a focus-visible ring on open.
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
        class="why-cloud-overlay fixed inset-0 z-60 grid place-items-center px-[clamp(32px,5vw,80px)] pt-[clamp(72px,10vh,132px)] pb-[clamp(80px,11vh,140px)] bg-neutral-800/70 backdrop-blur-[8px] backdrop-saturate-[115%]"
        role="dialog"
        aria-modal="true"
        :aria-label="$t('firstUse.whyCloud.title')"
        tabindex="-1"
        @mousedown="onOverlayMouseDown"
        @click="onOverlayClick"
      >
        <div
          class="why-cloud-content modal-fade-panel relative flex w-[min(100%,calc((100vh_-_clamp(152px,21vh,272px))_*_(916_/_445)))] max-w-full max-h-full aspect-[916/445] overflow-hidden rounded-panel border border-solid border-neutral-100/8 bg-neutral-900"
        >
          <button
            class="why-cloud-close absolute top-4 right-4 z-2 inline-flex size-8 items-center justify-center rounded-lg border border-solid border-[var(--border)] bg-text/4 p-0 text-neutral-100 opacity-70 cursor-pointer transition-[border-color,opacity] duration-120 ease-[ease] hover:border-neutral-100/44 hover:opacity-100 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] [&_svg]:size-[18px] [&_svg]:flex-none [&_svg]:stroke-current"
            type="button"
            :aria-label="$t('common.close')"
            data-testid="why-cloud-close"
            @click="emit('close')"
          >
            <X :size="18" />
          </button>
          <div
            class="why-cloud-grid flex-auto grid size-full grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))]"
          >
            <img
              :src="heroUrl"
              class="why-cloud-image block size-full object-cover object-center bg-[linear-gradient(135deg,var(--neutral-800)_0%,var(--neutral-900)_100%)]"
              :alt="$t('firstUse.whyCloud.imageAlt')"
            />
            <div
              class="why-cloud-body flex flex-col justify-between overflow-auto p-[clamp(1.5rem,2.5vw,2.5rem)]"
            >
              <div
                class="why-cloud-body-main flex flex-auto flex-col justify-center gap-[clamp(0.75rem,1.2vw,1.25rem)]"
              >
                <header class="why-cloud-header flex flex-wrap items-center gap-3">
                  <h2
                    class="why-cloud-title m-0 font-display text-[length:var(--takeover-fs-h2)] leading-8 font-extrabold tracking-normal text-neutral-100"
                  >
                    {{ $t('firstUse.whyCloud.title') }}
                  </h2>
                </header>
                <p
                  class="why-cloud-lead m-0 font-sans text-[length:var(--takeover-fs-lead)] leading-[normal] font-normal text-neutral-300"
                >
                  {{ $t('firstUse.whyCloud.lead') }}
                </p>
                <ul
                  class="why-cloud-list mt-1 mr-0 mb-0 ml-0 flex list-none flex-col gap-2.5 p-0 [&>li]:grid [&>li]:grid-cols-[auto_1fr] [&>li]:items-start [&>li]:gap-3 [&>li]:text-[length:var(--takeover-fs-lead)] [&>li]:leading-[normal] [&>li]:text-neutral-100"
                >
                  <li v-for="b in benefits" :key="b">
                    <Check :size="16" class="why-cloud-check mt-[3px] text-comfy-yellow" />
                    <span>{{ b }}</span>
                  </li>
                </ul>
              </div>
              <footer
                class="why-cloud-footer flex items-center justify-end gap-4 border-t border-solid border-neutral-100/8 pt-[clamp(1rem,1.5vw,1.5rem)]"
              >
                <Button
                  size="unset"
                  variant="textonly"
                  class="why-cloud-maybe static inline-flex touch-auto items-center justify-center gap-0 rounded-md border border-solid border-transparent bg-transparent px-4 py-2.5 font-sans text-[length:var(--takeover-fs-body)] leading-[inherit] font-medium whitespace-normal text-neutral-300 cursor-pointer transition-[background,border-color,color] duration-120 ease-[ease] [&]:[appearance:button] enabled:hover:bg-[var(--brand-surface-bg)] enabled:hover:text-neutral-100 focus-visible:ring-0 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-55"
                  type="button"
                  data-testid="why-cloud-maybe"
                  @click="emit('close')"
                >
                  {{ $t('firstUse.whyCloud.maybeLater') }}
                </Button>
                <Button
                  size="unset"
                  variant="textonly"
                  class="why-cloud-primary static inline-flex touch-auto items-center justify-center gap-0 rounded-[var(--radius-control)] border border-solid border-comfy-yellow bg-comfy-yellow px-4 py-2.5 font-sans text-[length:var(--takeover-fs-body)] leading-[inherit] font-medium whitespace-normal text-neutral-900 cursor-pointer transition-[background,border-color,color] duration-120 ease-[ease] [&]:[appearance:button] enabled:hover:border-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] enabled:hover:bg-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] focus-visible:ring-0 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--comfy-yellow)_80%,var(--neutral-100))] disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-55"
                  type="button"
                  data-testid="why-cloud-try"
                  @click="emit('try-cloud')"
                >
                  {{ $t('firstUse.whyCloud.tryCta') }}
                </Button>
              </footer>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
