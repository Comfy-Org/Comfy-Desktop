import type { Component } from 'vue'
import { Cpu, Gpu } from 'lucide-vue-next'
import type { FieldOption } from '../types/ipc'
import type { SetupOptionCard } from '../components/SetupOptionCards.vue'
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

export function toHardwareCards(options: FieldOption[]): SetupOptionCard[] {
  return toOptionCards(options).map((card, index) => ({
    ...card,
    image: null,
    icon: hardwareIcon(options[index]!)
  }))
}
