<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Tooltip from '../components/ui/Tooltip.vue'
import { badgeDescriptionId, badgeWords } from './appCardBadges'
import type { AppBadge } from '../types/ipc'

const {
  badges,
  descriptionIdPrefix,
  revealed = false
} = defineProps<{
  badges: readonly AppBadge[]
  descriptionIdPrefix: string
  revealed?: boolean
}>()

const { t, locale } = useI18n()

const drawn = computed(() =>
  badges.map((badge, index) => {
    const text = badgeWords(badge.text, locale.value)
    const description = badge.description && badgeWords(badge.description, locale.value)
    return {
      badge,
      text,
      hoverText: description ?? (badge.style === 'crown' ? text : undefined),
      spokenText: description ? t('apps.badge.withDescription', { text, description }) : text,
      descriptionId: badgeDescriptionId(descriptionIdPrefix, badge),
      shownForKeyboard: revealed && index === 0
    }
  })
)

const crown = computed(() => drawn.value.find((item) => item.badge.style === 'crown'))

const shown = computed(() => {
  const theCrown = crown.value
  if (!theCrown) return drawn.value
  const folded = drawn.value.filter((item) => item !== theCrown)
  if (!folded.length) return [{ ...theCrown, shownForKeyboard: revealed }]
  const crownDescription = theCrown.badge.description && theCrown.hoverText
  const hoverText = [crownDescription, ...folded.map((item) => item.hoverText ?? item.text)]
    .filter(Boolean)
    .join(' · ')
  return [{ ...theCrown, hoverText, shownForKeyboard: revealed }]
})

const foldedIntoCrown = computed(() =>
  crown.value ? drawn.value.filter((item) => item !== crown.value) : []
)
</script>

<template>
  <span class="flex items-start gap-1.5" data-testid="app-badges">
    <Tooltip
      v-for="item in shown"
      :key="item.badge.id"
      :text="item.hoverText"
      :shown-while="item.shownForKeyboard"
      :data-testid="`app-badge-${item.badge.id}`"
      :data-badge-style="item.badge.style"
    >
      <span
        v-if="item.badge.style === 'crown'"
        class="grid size-7 place-items-center rounded-lg bg-[rgb(14_14_16/0.28)] backdrop-blur-[14px] backdrop-saturate-150"
        aria-hidden="true"
        data-testid="app-badge-square"
      >
        <svg viewBox="0 0 24 24" class="size-4 text-[var(--upgrade)]" data-testid="app-badge-crown">
          <path
            fill="currentColor"
            d="M19 19H5c-.5 0-.9-.3-1-.8l-2-10c0-.4.1-.8.5-1.1c.4-.2.8-.2 1.1 0l4.1 3.3l3.4-5.1c.4-.6 1.3-.6 1.7 0l3.4 5.1l4.1-3.3c.3-.3.8-.3 1.1 0c.4.2.5.6.5 1.1l-2 10c0 .5-.5.8-1 .8z"
          />
        </svg>
      </span>
      <span
        v-else-if="item.badge.style === 'chip'"
        class="flex h-7 items-center rounded-full bg-[rgb(14_14_16/0.28)] px-2.5 text-2xs/tight font-medium whitespace-nowrap text-white backdrop-blur-[14px] backdrop-saturate-150"
        aria-hidden="true"
      >
        {{ item.text }}
      </span>
      <span
        v-else
        class="flex h-5 items-center rounded-[5px] bg-[var(--upgrade)] px-1.5 text-2xs/tight font-semibold whitespace-nowrap text-black"
        aria-hidden="true"
      >
        {{ item.text }}
      </span>
      <span :id="item.descriptionId" hidden>{{ item.spokenText }}</span>
    </Tooltip>
    <span v-for="item in foldedIntoCrown" :id="item.descriptionId" :key="item.badge.id" hidden>{{
      item.spokenText
    }}</span>
  </span>
</template>
