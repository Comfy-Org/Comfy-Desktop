<script setup lang="ts">
// Intentionally NOT a variant of ChoiceCard.vue (an onboarding takeover
// primitive); reusing it here would fork its typography and surface.
import { computed } from 'vue'
import { ExternalLink, Github, Star } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    url: string
    stars: number | null
    loading?: boolean
    label?: string
  }>(),
  {
    loading: false,
    label: 'Comfy Desktop'
  }
)

const emit = defineEmits<{
  open: [url: string]
}>()

const starCountLabel = computed(() => {
  if (props.stars == null) return ''
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(props.stars)
})
</script>

<template>
  <button
    type="button"
    class="github-link-card flex w-full items-center justify-between gap-3 rounded-lg border border-solid border-[var(--chooser-surface-border)] bg-[var(--brand-surface-bg)] px-3 py-2.5 text-left text-neutral-100 cursor-pointer transition-[background-color] duration-100 ease-[ease] hover:bg-[var(--brand-surface-bg-hover)] hover:outline-none focus-visible:bg-[var(--brand-surface-bg-hover)] focus-visible:outline-none"
    @click="emit('open', url)"
  >
    <span class="github-link-main inline-flex min-w-0 items-center gap-2">
      <Github :size="16" aria-hidden="true" />
      <span class="github-link-label text-[13px] leading-[19px] font-medium">{{ label }}</span>
      <ExternalLink
        :size="12"
        class="github-link-external shrink-0 opacity-50"
        aria-hidden="true"
      />
    </span>
    <span
      v-if="loading"
      class="github-link-stars github-link-stars--skeleton inline-flex shrink-0 items-center gap-1 rounded-[999px] border border-solid border-[color-mix(in_oklab,var(--neutral-100)_14%,transparent)] bg-[color-mix(in_oklab,var(--neutral-100)_4%,transparent)] px-2 py-0.5 text-[11px] leading-4 tabular-nums min-w-11 justify-center"
      aria-hidden="true"
    >
      <span
        class="github-link-skeleton-bar h-2.5 w-8 rounded-[999px] bg-[linear-gradient(90deg,color-mix(in_oklab,var(--neutral-100)_6%,transparent)_0%,color-mix(in_oklab,var(--neutral-100)_16%,transparent)_50%,color-mix(in_oklab,var(--neutral-100)_6%,transparent)_100%)] [background-size:200%_100%] animate-[github-stars-shimmer_1.4s_linear_infinite] motion-reduce:animate-none"
      />
    </span>
    <span
      v-else-if="stars != null"
      class="github-link-stars inline-flex shrink-0 items-center gap-1 rounded-[999px] border border-solid border-[color-mix(in_oklab,var(--neutral-100)_14%,transparent)] bg-[color-mix(in_oklab,var(--neutral-100)_4%,transparent)] px-2 py-0.5 text-[11px] leading-4 tabular-nums"
      :aria-label="`${stars} GitHub stars`"
    >
      <Star
        :size="12"
        class="github-link-stars-icon fill-current text-[var(--warning)]"
        aria-hidden="true"
      />
      <span>{{ starCountLabel }}</span>
    </span>
  </button>
</template>

<style>
@keyframes github-stars-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
