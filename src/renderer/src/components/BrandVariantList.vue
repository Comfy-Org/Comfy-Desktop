<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Check, Crown } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import type { FieldOption } from '../types/ipc'
import { getVariantImage } from '../lib/variants'
import { isApiNodeTemplate } from '../lib/installHelpers'

defineProps<{
  options: FieldOption[]
  selectedValue?: string | null
  ariaLabel?: string
}>()

defineEmits<{
  select: [option: FieldOption]
}>()

const { t } = useI18n()
</script>

<template>
  <div
    class="brand-variant-list mt-1 flex flex-col gap-2"
    role="radiogroup"
    :aria-label="ariaLabel"
  >
    <Button
      v-for="opt in options"
      :key="opt.value"
      size="unset"
      variant="textonly"
      type="button"
      role="radio"
      :aria-checked="selectedValue === opt.value"
      :class="[
        'brand-variant-row static flex w-full appearance-auto items-center justify-normal gap-3 rounded-md border border-solid border-transparent p-3 [font:inherit] whitespace-normal text-left touch-auto transition-[background,border-color,color] duration-120 ease-[ease] [&]:[appearance:button] hover:border-[var(--brand-surface-border)] hover:bg-[var(--brand-surface-bg-hover)] hover:text-neutral-100 focus-visible:ring-0 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2',
        selectedValue === opt.value
          ? 'brand-variant-row--selected border-[var(--brand-surface-border-hover)] bg-[var(--brand-surface-bg-hover)] text-neutral-100 [box-shadow:0_1px_0_0_rgba(255,255,255,0.08)_inset] focus-visible:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]'
          : 'bg-[var(--brand-surface-bg)] text-neutral-200'
      ]"
      @click="$emit('select', opt)"
    >
      <span
        class="brand-variant-row__icon inline-flex size-10 flex-none items-center justify-center overflow-hidden rounded-md bg-[var(--chooser-surface-bg)]"
        aria-hidden="true"
      >
        <img
          v-if="getVariantImage(opt)"
          :src="getVariantImage(opt)!"
          :alt="opt.label"
          class="size-full object-cover"
          draggable="false"
        />
      </span>
      <span class="brand-variant-row__text flex min-w-0 flex-auto flex-col gap-0.5">
        <span
          class="brand-variant-row__label inline-flex items-center text-[length:var(--takeover-fs-body)] font-semibold text-neutral-100"
        >
          {{ opt.label }}
          <span
            v-if="opt.recommended"
            class="brand-variant-row__recommended ml-2 inline-block text-[10px] font-semibold tracking-[0.08em] text-neutral-400 uppercase"
          >
            {{ t('newInstall.recommended') }}
          </span>
          <span
            v-if="isApiNodeTemplate(opt)"
            class="brand-variant-row__credits ml-2 inline-flex items-center gap-1 text-[length:var(--takeover-fs-caption)] font-medium text-[var(--upgrade)]"
          >
            <Crown :size="12" :stroke-width="2.5" aria-hidden="true" />
            {{ t('standalone.templateApiBadge') }}
          </span>
        </span>
        <span
          v-if="opt.description"
          class="brand-variant-row__meta text-[length:var(--takeover-fs-caption)] text-neutral-300"
        >
          {{ opt.description }}
        </span>
      </span>
      <Check
        v-if="selectedValue === opt.value"
        class="brand-variant-row__check flex-none text-neutral-100"
        :size="16"
        :stroke-width="2"
        aria-hidden="true"
      />
    </Button>
  </div>
</template>
