import type { Component } from 'vue'
import { Cpu, Gpu } from '@lucide/vue'
import type { FieldOption } from '../types/ipc'
import type { SetupOptionCard } from '../components/SetupOptionCards.vue'
import type { BaseSelectOption } from '../components/ui'
import { getVariantImage, stripVariantPrefix } from './variants'
import { isApiNodeTemplate } from './installHelpers'

export function hardwareIcon(option: FieldOption): Component {
  const variant = stripVariantPrefix((option.data?.variantId as string) ?? option.value)
  return variant === 'cpu' || variant.startsWith('cpu-') ? Cpu : Gpu
}

export function toOptionCards(options: FieldOption[]): SetupOptionCard[] {
  return options.map((option) => ({
    value: option.value,
    label: option.label,
    description: option.description,
    recommended: option.recommended,
    credits: isApiNodeTemplate(option),
    image: getVariantImage(option)
  }))
}

export function toCardSelectOption(
  card: SetupOptionCard,
  recommendedBadge: string
): BaseSelectOption {
  return {
    value: card.value,
    label: card.label,
    description: card.description,
    disabled: card.disabled,
    icon: card.icon,
    testId: card.testId,
    badge: card.recommended ? recommendedBadge : undefined
  }
}

export function toHardwareCards(options: FieldOption[]): SetupOptionCard[] {
  return toOptionCards(options).map((card, index) => ({
    ...card,
    image: null,
    icon: hardwareIcon(options[index]!)
  }))
}
