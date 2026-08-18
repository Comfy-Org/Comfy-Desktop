<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
import { useShowcaseCarousel } from '../composables/useShowcaseCarousel'
import { TID } from '../../../shared/testIds'

defineProps<{ canOfferCloud: boolean }>()

const emit = defineEmits<{ 'open-cloud': [] }>()

const carousel = useShowcaseCarousel()
const pauseReasons = new Set<'focus' | 'hover'>()

function setPaused(reason: 'focus' | 'hover', paused: boolean): void {
  if (paused) {
    pauseReasons.add(reason)
    carousel.pause()
    return
  }
  pauseReasons.delete(reason)
  if (pauseReasons.size === 0) carousel.resume()
}
</script>

<template>
  <section
    class="showcase"
    :data-testid="TID.installShowcase"
    :aria-label="$t('installShowcase.label')"
    @mouseenter="setPaused('hover', true)"
    @mouseleave="setPaused('hover', false)"
    @focusin="setPaused('focus', true)"
    @focusout="setPaused('focus', false)"
  >
    <Transition name="showcase-swap" mode="out-in">
      <p :key="carousel.card.value.id" class="showcase__line">
        <span class="showcase__title" :data-testid="TID.installShowcaseTitle">
          {{ $t(carousel.card.value.title) }}
        </span>
        <span class="showcase__body">{{ $t(carousel.card.value.body) }}</span>
      </p>
    </Transition>

    <button
      v-if="canOfferCloud"
      type="button"
      class="showcase__cta"
      :data-testid="TID.installShowcaseCloud"
      @click="emit('open-cloud')"
    >
      {{ $t('installShowcase.cloudCta') }}
      <ArrowRight :size="11" stroke-width="2.2" />
    </button>
  </section>
</template>

<style scoped>
.showcase {
  display: flex;
  /* Centred, not baseline: the row reserves 1.5em for two-line locales, and
     baseline alignment parks the copy against the top of that box, which reads
     as off-centre inside the banner. */
  align-items: center;
  justify-content: center;
  flex-wrap: nowrap;
  gap: 8px;
  width: 100%;
  max-width: min(72rem, 92vw);
  margin-inline: auto;
  min-height: 1.5em;
  white-space: nowrap;
}
.showcase__line {
  display: block;
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  font-size: 12.5px;
  line-height: 1.35;
}
.showcase__title {
  font-weight: 500;
  color: var(--neutral-100);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}
.showcase__title::after {
  content: '-';
  margin-inline: 7px;
  font-weight: 400;
  color: var(--neutral-600);
}
.showcase__body {
  color: var(--neutral-200);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
}
.showcase__cta {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--comfy-yellow);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  opacity: 0.85;
  transition: opacity 160ms ease;
}
.showcase__cta:hover {
  opacity: 1;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.showcase__cta:focus-visible {
  opacity: 1;
  outline: 2px solid var(--focus-ring);
  outline-offset: 3px;
  border-radius: 3px;
}
.showcase-swap-enter-active,
.showcase-swap-leave-active {
  transition:
    opacity 200ms ease,
    transform 260ms cubic-bezier(0.32, 0.72, 0, 1);
}
.showcase-swap-enter-from {
  opacity: 0;
  transform: translateY(3px);
}
.showcase-swap-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}
@media (prefers-reduced-motion: reduce) {
  .showcase-swap-enter-active,
  .showcase-swap-leave-active,
  .showcase__cta {
    transition: none;
  }
}
</style>
