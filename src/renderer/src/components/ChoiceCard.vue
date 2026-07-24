<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
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
    /** Hold the radiogroup's single tab stop even though this card isn't
     *  selected. WAI-ARIA APG §3.15: a radiogroup with nothing checked
     *  still needs exactly one Tab-reachable radio, otherwise the whole
     *  group drops out of the tab order and keyboard users can't pick at
     *  all. The parent decides which card that is — see
     *  `keyboardEntryChoice` in FirstUseTakeover. Ignored when `selected`
     *  is already true (that card is the tab stop by definition). */
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
  <button
    type="button"
    :class="[
      'choice-card',
      { 'choice-card--glow': glow, 'choice-card--selected': selectable && selected }
    ]"
    :role="selectable ? 'radio' : undefined"
    :aria-checked="selectable ? selected : undefined"
    :tabindex="selectable ? (selected || tabStop ? 0 : -1) : undefined"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <div v-if="tagline" class="choice-card__tagline">{{ tagline }}</div>
    <div class="choice-card__body">
      <div class="choice-card__text">
        <div class="choice-card__label">
          <span class="choice-card__label-text">{{ label }}</span>
          <span v-if="$slots['label-trailing']" class="choice-card__label-trailing">
            <slot name="label-trailing" />
          </span>
        </div>
        <div class="choice-card__desc">
          <InlineRichText :text="description" />
          <div v-if="$slots['desc-trailing']" class="choice-card__desc-trailing">
            <slot name="desc-trailing" />
          </div>
        </div>
      </div>
      <ArrowRight v-if="!selectable" :size="18" class="choice-card__arrow" aria-hidden="true" />
    </div>
  </button>
</template>

<style scoped>
.choice-card {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: stretch;
  gap: 0;
  padding: 0;
  border: 1px solid var(--brand-surface-border);
  border-radius: 10px;
  /* Resting bg uses the hover token so cards separate from the takeover
   * surface even at rest. */
  background: var(--brand-surface-bg-hover);
  backdrop-filter: blur(var(--brand-surface-blur));
  color: var(--neutral-100);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition:
    border-color 120ms ease,
    background 120ms ease;
  font: inherit;
}
.choice-card:hover:not(:disabled) {
  border-color: var(--brand-surface-border-hover);
  background: rgba(137, 137, 137, 0.13);
}
.choice-card:hover:not(:disabled) .choice-card__label {
  color: var(--text);
}
.choice-card:hover:not(:disabled) .choice-card__arrow {
  opacity: 1;
  transform: translateX(0);
}
.choice-card:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.choice-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
/* Selected uses neutral-100, not blue or yellow — border-only selection
 * language, no accent color competing with the yellow Continue CTA. */
.choice-card--selected {
  border-color: color-mix(in oklab, var(--neutral-100) 60%, transparent);
  background: color-mix(in oklab, var(--neutral-100) 6%, var(--brand-surface-bg-hover));
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--neutral-100) 40%, transparent) inset;
}
.choice-card--selected:hover:not(:disabled) {
  border-color: color-mix(in oklab, var(--neutral-100) 75%, transparent);
  background: color-mix(in oklab, var(--neutral-100) 9%, rgba(137, 137, 137, 0.13));
}

.choice-card__tagline {
  position: relative;
  z-index: 1;
  padding: 10px 20px;
  font-size: var(--takeover-fs-body);
  font-weight: 500;
  line-height: normal;
  color: var(--neutral-100);
  /* Gradient + bottom rule so the tagline reads as a header band, not a
   * watermark on the card surface. */
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.02) 100%);
  border-bottom: 1px solid var(--brand-surface-border);
}
.choice-card__body {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
  padding: 18px 20px 20px 20px;
}
.choice-card__text {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.choice-card__label {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  /* Tight against the label text: the first trailing item is an inline
   * (i) affordance that belongs to the title, not a separate column. */
  gap: 4px;
  width: 100%;
  font-family: var(--font-sans);
  font-size: var(--takeover-fs-lead);
  font-weight: 700;
  line-height: normal;
  color: var(--neutral-100);
  transition: color 120ms ease;
}
.choice-card__label-text {
  flex: 0 0 auto;
}
/* Trailing items separate from each other more than they do from the
 * label — an (i) icon and a badge are peers, not one run of text. */
.choice-card__label-trailing {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.choice-card__desc-trailing {
  margin-top: 14px;
}
.choice-card__desc {
  font-family: var(--font-sans);
  font-size: var(--takeover-fs-body);
  font-weight: 400;
  line-height: normal;
  color: var(--neutral-300);
}
.choice-card__desc :deep(strong) {
  color: var(--neutral-100);
  font-weight: 400;
}
/* Resting state is muted + nudged left so hover reads as a slide-in. */
.choice-card__arrow {
  flex: 0 0 auto;
  color: var(--neutral-100);
  opacity: 0;
  transform: translateX(-4px);
  transition:
    opacity 140ms ease,
    transform 140ms cubic-bezier(0.32, 0.72, 0, 1);
}
@media (prefers-reduced-motion: reduce) {
  .choice-card__arrow {
    transition: opacity 100ms ease;
    transform: none;
  }
}
</style>
