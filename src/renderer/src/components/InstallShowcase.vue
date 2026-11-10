<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
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
    class="showcase flex flex-nowrap items-center justify-end gap-2.5 whitespace-nowrap [&.showcase]:min-h-[1.5em]"
    :data-testid="TID.installShowcase"
    :aria-label="$t('installShowcase.label')"
    @mouseenter="setPaused('hover', true)"
    @mouseleave="setPaused('hover', false)"
    @focusin="setPaused('focus', true)"
    @focusout="setPaused('focus', false)"
  >
    <Transition
      name="showcase-swap"
      mode="out-in"
      enter-active-class="showcase-swap-enter-active [transition:opacity_200ms_ease,transform_260ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
      leave-active-class="showcase-swap-leave-active [transition:opacity_200ms_ease,transform_260ms_cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
      enter-from-class="showcase-swap-enter-from opacity-0 [transform:translateY(3px)]"
      leave-to-class="showcase-swap-leave-to opacity-0 [transform:translateY(-3px)]"
    >
      <p
        :key="carousel.card.value.id"
        class="showcase__line m-0 block min-w-0 overflow-hidden text-center text-[12.5px] leading-[1.35] text-ellipsis"
      >
        <span
          class="showcase__title font-medium text-neutral-100 [text-shadow:0_1px_3px_rgba(0,0,0,0.8)] after:mx-[7px] after:font-normal after:text-neutral-600 after:content-['-']"
          :data-testid="TID.installShowcaseTitle"
        >
          {{ $t(carousel.card.value.title) }}
        </span>
        <span class="showcase__body text-neutral-200 [text-shadow:0_1px_2px_rgba(0,0,0,0.75)]">{{
          $t(carousel.card.value.body)
        }}</span>
      </p>
    </Transition>

    <Button
      v-if="canOfferCloud"
      size="unset"
      variant="textonly"
      type="button"
      class="showcase__cta static inline-flex appearance-auto items-center justify-normal gap-[3px] rounded-lg border-0 bg-transparent p-0 font-sans text-[12px] leading-[inherit] font-medium whitespace-nowrap text-comfy-yellow opacity-85 touch-auto transition-opacity duration-160 ease-[ease] [&]:[appearance:button] hover:bg-transparent hover:opacity-100 hover:underline hover:underline-offset-[3px] focus-visible:rounded-[3px] focus-visible:opacity-100 focus-visible:ring-0 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-[3px] motion-reduce:transition-none"
      :data-testid="TID.installShowcaseCloud"
      @click="emit('open-cloud')"
    >
      {{ $t('installShowcase.cloudCta') }}
      <ArrowRight :size="11" stroke-width="2.2" aria-hidden="true" />
    </Button>
  </section>
</template>
