<script setup lang="ts">
// Terminal takeover surface for the lifecycle view, serving both the crash
// (`tone="error"`) and clean-stop (`tone="neutral"`) states. The
// `brand-progress__*` class names are layout-only and shared with ProgressModal
// so the surfaces stay visually identical; keep them in sync.
import { ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { X, Power, ChevronDown } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import BrandTakeoverLayout from './BrandTakeoverLayout.vue'
import BrandProgressGlyph from './icons/BrandProgressGlyph.vue'
import ComfyWordmark from './icons/ComfyWordmark.vue'
import BaseAccordion from './ui/BaseAccordion.vue'
import BaseCopyButton from './ui/BaseCopyButton.vue'

interface Props {
  title: string
  message?: string
  /** When set, renders a collapsible logs accordion above the footer. */
  logs?: string
  /** Override for the "View logs" label; defaults to `launch.viewLogs`. */
  logsLabel?: string
  ariaLabel?: string
  /** `'error'` (default) is the red crash chrome; `'neutral'` is the calm
   *  surface for a deliberate stop. */
  tone?: 'error' | 'neutral'
}

// Slot actions share the finished surface's responsive control recipe. Keeping
// it here lets their owners preserve click handlers without global button CSS.
const footerButtonClass =
  'static inline-flex min-w-auto appearance-auto items-center gap-1.5 rounded-md border border-solid px-3.5 py-[7px] font-sans text-[13px] leading-[inherit] font-medium whitespace-nowrap touch-auto transition-[background,border-color,color] duration-120 ease-[ease] [&]:[appearance:button] focus-visible:ring-0 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-55 [@media(max-width:720px)]:px-2.5 [@media(max-width:720px)]:py-1.5 [@media(max-width:720px)]:text-[12px]'
const buttonClass = `${footerButtonClass} flex-1 justify-center`
const secondaryClass =
  'border-neutral-500 bg-transparent text-neutral-100 hover:bg-[var(--brand-surface-bg)] hover:text-neutral-100'
const primaryClass =
  'rounded-[var(--radius-control)] border-comfy-yellow bg-comfy-yellow text-neutral-900 enabled:hover:border-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] enabled:hover:bg-[color-mix(in_srgb,var(--comfy-yellow)_88%,#000)] disabled:hover:bg-comfy-yellow focus-visible:outline-[color-mix(in_srgb,var(--comfy-yellow)_80%,var(--neutral-100))]'

const props = withDefaults(defineProps<Props>(), {
  message: undefined,
  logs: undefined,
  logsLabel: undefined,
  ariaLabel: undefined,
  tone: 'error'
})

const { t } = useI18n()
const logsExpanded = ref(false)
// Per-instance id so simultaneous surfaces don't collide on aria-controls.
const logsId = useId()

function toggleLogs(): void {
  logsExpanded.value = !logsExpanded.value
}

// Resolves logs at click time since the terminal buffer can grow after mount.
function getLogText(): string {
  return props.logs ?? ''
}
</script>

<template>
  <BrandTakeoverLayout :aria-label="ariaLabel">
    <div
      class="brand-progress relative flex w-full flex-auto items-center justify-center self-stretch"
    >
      <BrandProgressGlyph
        class="brand-progress__glyph pointer-events-none absolute top-1/2 left-[60%] z-0 h-screen w-auto opacity-90 [transform:translate(-50%,-50%)]"
        aria-hidden="true"
      />
      <div
        class="brand-progress__stack relative z-2 flex w-[min(85%,880px)] max-w-[calc(100vw-48px)] flex-col items-center gap-[clamp(1rem,3vh,2rem)] overflow-hidden text-center before:pointer-events-none before:absolute before:top-1/2 before:left-1/2 before:-z-1 before:h-[160%] before:w-[130%] before:rounded-[50%] before:bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--neutral-800)_60%,transparent)_0%,color-mix(in_srgb,var(--neutral-800)_40%,transparent)_35%,transparent_60%)] before:content-[''] before:[transform:translate(-50%,-50%)]"
      >
        <ComfyWordmark
          class="brand-progress__wordmark h-auto w-[clamp(140px,9.7vw,240px)] text-comfy-yellow [anchor-name:--brand-beam-target]"
        />
        <div
          class="brand-progress__banner inline-flex min-h-[1.5em] items-center gap-2.5 text-[length:var(--takeover-fs-body)] tracking-[0.01em] [&_svg]:flex-none"
          :class="
            tone === 'error'
              ? 'brand-progress__banner--error text-[var(--semantic-danger,#ff7a7a)]'
              : 'brand-progress__banner--neutral text-text'
          "
          aria-live="polite"
        >
          <X v-if="tone === 'error'" :size="20" />
          <Power v-else :size="20" />
          <span>{{ title }}</span>
        </div>
        <div
          v-if="message"
          class="brand-progress__error-row -mt-1 flex w-full max-w-[640px] items-start gap-2"
        >
          <div
            class="brand-progress__error-message mt-0 max-h-[clamp(120px,22vh,240px)] w-full max-w-[640px] flex-auto overflow-y-auto overscroll-contain rounded-lg border border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] px-3.5 py-3 text-left text-[13px] leading-[1.55] whitespace-pre-wrap text-neutral-200 select-text [word-break:break-word]"
          >
            {{ message }}
          </div>
          <!-- Copy only makes sense for an error message worth pasting into a
               bug report — a neutral status line ("ComfyUI is stopped") doesn't. -->
          <BaseCopyButton
            v-if="tone === 'error'"
            :value="message"
            :aria-label="t('common.copy')"
            class="brand-progress__error-copy mt-1 flex-none"
          />
        </div>
        <!-- Actions live in the hero stack (under the message), matching
             ProgressModal, so the CTAs stay with the failure context. -->
        <div
          v-if="$slots.actions"
          class="brand-progress__error-actions flex w-full max-w-[420px] flex-row items-stretch gap-3"
        >
          <slot name="actions" v-bind="{ buttonClass, secondaryClass, primaryClass }" />
        </div>
      </div>
    </div>
    <template v-if="logs" #footer>
      <div
        class="brand-progress__footer pointer-events-none absolute top-[clamp(72px,14vh,160px)] right-[clamp(16px,2.5vw,32px)] bottom-[clamp(16px,2.5vh,32px)] left-[clamp(16px,2.5vw,32px)] z-3 flex min-h-0 flex-col justify-end gap-2 [&>*]:pointer-events-auto"
      >
        <BaseAccordion
          :open="logsExpanded"
          class="brand-progress__logs-wrap min-h-0 overflow-hidden rounded-[10px]"
          :class="{
            'is-expanded border border-solid border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg)] backdrop-blur-[8px]':
              logsExpanded
          }"
        >
          <div
            class="brand-progress__logs-panel-header flex items-center justify-between border-b border-solid border-[var(--brand-surface-border)] px-3 py-2"
          >
            <span
              class="brand-progress__logs-panel-title text-[length:var(--takeover-fs-caption,12px)] font-medium text-neutral-200"
            >
              {{ logsLabel ?? t('launch.viewLogs') }}
            </span>
            <BaseCopyButton
              :get-value="getLogText"
              :aria-label="t('common.copy')"
              class="brand-progress__logs-copy flex-none"
            />
          </div>
          <div
            :id="logsId"
            class="brand-progress__logs min-h-0 max-h-[clamp(88px,25vh,260px)] w-full overflow-y-auto overscroll-contain px-3.5 py-3 text-left text-[11px] leading-[1.55] whitespace-pre-wrap text-neutral-300 select-text [font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] [word-break:break-word]"
          >
            {{ logs }}
          </div>
        </BaseAccordion>
        <div class="brand-progress__footer-bar flex flex-wrap items-center justify-end gap-3">
          <Button
            size="unset"
            variant="textonly"
            type="button"
            class="brand-progress__footer-btn brand-progress__logs-toggle justify-center border-neutral-500 bg-[rgba(138,134,136,0.1)] text-neutral-100 backdrop-blur-[75px] [box-shadow:0_1px_0_0_rgba(255,255,255,0.1)_inset] hover:bg-[var(--brand-surface-bg)] focus-visible:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]"
            :class="footerButtonClass"
            :aria-expanded="logsExpanded"
            :aria-controls="logsId"
            @click="toggleLogs"
          >
            <ChevronDown
              :size="14"
              class="brand-progress__logs-chevron transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
              :class="
                logsExpanded ? 'is-open [transform:rotate(0deg)]' : '[transform:rotate(180deg)]'
              "
            />
            {{ logsLabel ?? t('launch.viewLogs') }}
          </Button>
        </div>
      </div>
    </template>
  </BrandTakeoverLayout>
</template>
