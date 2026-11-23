<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useResizeObserver } from '@vueuse/core'
import Tooltip from '../components/ui/Tooltip.vue'
import { badgeDescriptionId, badgeWords } from './appCardBadges'
import type { AppBadge } from '../types/ipc'

const {
  badges,
  descriptionIdPrefix,
  revealed = false,
  glassPicture = null
} = defineProps<{
  badges: readonly AppBadge[]
  descriptionIdPrefix: string
  revealed?: boolean
  glassPicture?: string | null
}>()

const FROSTED_GLASS_CLASS =
  'relative isolate overflow-hidden bg-[linear-gradient(180deg,rgb(44_44_48/0.94),rgb(18_18_20/0.96))] shadow-[inset_0_1px_0_rgb(255_255_255/0.16),inset_0_0_0_1px_rgb(255_255_255/0.08),0_2px_6px_rgb(0_0_0/0.35)]'
const GLASS_TINT_CLASS = 'pointer-events-none absolute inset-0 bg-[rgb(0_0_0/0.45)]'
const GLASS_PICTURE_CLASS =
  'pointer-events-none absolute max-w-none object-cover blur-[10px] saturate-[1.4]'

interface GlassPlace {
  left: string
  top: string
  width: string
  height: string
}

const root = useTemplateRef<HTMLElement>('root')
const glassPlaces = reactive(new Map<string, GlassPlace>())

function placeGlass(): void {
  const row = root.value
  const card = row?.offsetParent as HTMLElement | null
  if (!row || !card) return
  for (const glass of row.querySelectorAll<HTMLElement>('[data-glass-id]')) {
    glassPlaces.set(glass.dataset.glassId!, {
      left: `${-(row.offsetLeft + glass.offsetLeft)}px`,
      top: `${-(row.offsetTop + glass.offsetTop)}px`,
      width: `${card.clientWidth}px`,
      height: `${card.clientHeight}px`
    })
  }
}

onMounted(placeGlass)
useResizeObserver(() => root.value?.offsetParent as HTMLElement | null, placeGlass)
watch(
  () => [badges, glassPicture],
  () => nextTick(placeGlass)
)

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
  <span ref="root" class="flex flex-wrap items-start gap-1.5" data-testid="app-badges">
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
        :class="[FROSTED_GLASS_CLASS, 'grid size-7 place-items-center rounded-lg']"
        aria-hidden="true"
        data-testid="app-badge-square"
        :data-glass-id="item.badge.id"
      >
        <template v-if="glassPicture">
          <img
            :src="glassPicture"
            alt=""
            draggable="false"
            :class="GLASS_PICTURE_CLASS"
            :style="glassPlaces.get(item.badge.id)"
            data-testid="app-badge-glass-picture"
          />
          <span :class="GLASS_TINT_CLASS" />
        </template>
        <svg
          viewBox="0 0 24 24"
          class="relative size-4 text-[var(--upgrade)]"
          data-testid="app-badge-crown"
        >
          <path
            fill="currentColor"
            d="M19 19H5c-.5 0-.9-.3-1-.8l-2-10c0-.4.1-.8.5-1.1c.4-.2.8-.2 1.1 0l4.1 3.3l3.4-5.1c.4-.6 1.3-.6 1.7 0l3.4 5.1l4.1-3.3c.3-.3.8-.3 1.1 0c.4.2.5.6.5 1.1l-2 10c0 .5-.5.8-1 .8z"
          />
        </svg>
      </span>
      <span
        v-else-if="item.badge.style === 'chip'"
        :class="[
          FROSTED_GLASS_CLASS,
          'flex h-7 items-center rounded-lg px-2.5 text-2xs/tight font-medium tracking-[0.06em] whitespace-nowrap text-white uppercase'
        ]"
        aria-hidden="true"
        :data-glass-id="item.badge.id"
      >
        <template v-if="glassPicture">
          <img
            :src="glassPicture"
            alt=""
            draggable="false"
            :class="GLASS_PICTURE_CLASS"
            :style="glassPlaces.get(item.badge.id)"
            data-testid="app-badge-glass-picture"
          />
          <span :class="GLASS_TINT_CLASS" />
        </template>
        <span class="relative">{{ item.text }}</span>
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
