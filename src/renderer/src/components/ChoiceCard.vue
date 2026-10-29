<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import InlineRichText from './InlineRichText.vue'

withDefaults(
  defineProps<{
    label: string
    description: string
    tagline?: string
    disabled?: boolean
    glow?: boolean
    /** Renders as a radio option (no arrow); click selects rather than
     *  commits, leaving the commit to a parent Continue button. Selection
     *  reads from the card border/background — there is no radio glyph. */
    selectable?: boolean
    selected?: boolean
    /** Hold the group's tab stop while unselected. A radiogroup with
     *  nothing checked still needs one Tab-reachable radio (WAI-ARIA APG
     *  §3.15) or it drops out of the tab order entirely; the parent picks
     *  which card — see `keyboardEntryChoice` in FirstUseTakeover. */
    tabStop?: boolean
  }>(),
  {
    tagline: '',
    disabled: false,
    glow: false,
    selectable: false,
    selected: false,
    tabStop: false
  }
)

defineEmits<{ click: [] }>()
</script>

<template>
  <Button
    size="unset"
    variant="textonly"
    type="button"
    :class="[
      'choice-card group/choice static flex appearance-auto flex-col items-stretch justify-start gap-0 overflow-hidden rounded-[10px] border border-solid p-0 [font:inherit] whitespace-normal text-neutral-100 text-left touch-auto [backdrop-filter:blur(var(--brand-surface-blur))] transition-[border-color,background] duration-120 ease-[ease] [&]:[appearance:button] focus-visible:ring-0 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[var(--brand-surface-bg-hover)]',
      { 'choice-card--glow': glow, 'choice-card--selected': selectable && selected },
      selectable && selected
        ? 'disabled:hover:bg-[color-mix(in_oklab,var(--neutral-100)_6%,var(--brand-surface-bg-hover))] border-[color-mix(in_oklab,var(--neutral-100)_60%,transparent)] bg-[color-mix(in_oklab,var(--neutral-100)_6%,var(--brand-surface-bg-hover))] [box-shadow:0_0_0_1px_color-mix(in_oklab,var(--neutral-100)_40%,transparent)_inset] focus-visible:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--neutral-100)_40%,transparent)] enabled:hover:border-[color-mix(in_oklab,var(--neutral-100)_75%,transparent)] enabled:hover:bg-[color-mix(in_oklab,var(--neutral-100)_9%,rgba(137,137,137,0.13))]'
        : 'border-[var(--brand-surface-border)] bg-[var(--brand-surface-bg-hover)] enabled:hover:border-[var(--brand-surface-border-hover)] enabled:hover:bg-[rgba(137,137,137,0.13)]'
    ]"
    :role="selectable ? 'radio' : undefined"
    :aria-checked="selectable ? selected : undefined"
    :tabindex="selectable ? (selected || tabStop ? 0 : -1) : undefined"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <div
      v-if="tagline"
      class="choice-card__tagline relative z-1 border-b border-solid border-[var(--brand-surface-border)] bg-[linear-gradient(90deg,rgba(255,255,255,0.12)_0%,rgba(255,255,255,0.02)_100%)] px-5 py-2.5 text-[length:var(--takeover-fs-body)] leading-[normal] font-medium text-neutral-100"
    >
      {{ tagline }}
    </div>
    <div
      class="choice-card__body relative z-1 flex flex-row items-center gap-4 px-5 pt-[18px] pb-5"
    >
      <div class="choice-card__text flex min-w-0 flex-auto flex-col gap-2">
        <div
          :class="{ 'group-hover/choice:text-text': !disabled }"
          class="choice-card__label flex w-full flex-wrap items-center justify-start gap-1 font-sans text-[length:var(--takeover-fs-lead)] leading-[normal] font-bold text-neutral-100 transition-colors duration-120 ease-[ease]"
        >
          <span class="choice-card__label-text flex-none">{{ label }}</span>
          <span
            v-if="$slots['label-trailing']"
            class="choice-card__label-trailing inline-flex flex-none items-center gap-2"
          >
            <slot name="label-trailing" />
          </span>
        </div>
        <div
          class="choice-card__desc font-sans text-[length:var(--takeover-fs-body)] leading-[normal] font-normal text-neutral-300 [&_strong]:font-normal [&_strong]:text-neutral-100"
        >
          <InlineRichText :text="description" />
          <div v-if="$slots['desc-trailing']" class="choice-card__desc-trailing mt-3.5">
            <slot name="desc-trailing" />
          </div>
        </div>
      </div>
      <ArrowRight
        v-if="!selectable"
        :size="18"
        :class="{
          'group-hover/choice:opacity-100 group-hover/choice:[transform:translateX(0)] motion-reduce:group-hover/choice:[transform:none]':
            !disabled
        }"
        class="choice-card__arrow flex-none text-neutral-100 opacity-0 [transform:translateX(-4px)] [transition:opacity_140ms_ease,transform_140ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:[transform:none] motion-reduce:[transition:opacity_100ms_ease]"
        aria-hidden="true"
      />
    </div>
  </Button>
</template>
