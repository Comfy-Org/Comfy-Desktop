<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppWindow, Search } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import AppCardTile from './AppCardTile.vue'
import BaseInput from '../components/ui/BaseInput.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import { PAGE_SPOTLIGHT_CLASS } from '../lib/pageSpotlight'
import { badgeDescriptionIds } from './appCardBadges'
import { RHYTHM_GRID_CLASS, rhythmSpanClass } from './appGridRhythm'
import { hiddenAppBadges } from './hiddenAppBadges'
import type { AppCard, HiddenAppCard } from '../types/ipc'

const { apps } = defineProps<{ apps: HiddenAppCard[] }>()

const emit = defineEmits<{ 'open-app': [app: AppCard] }>()

const { t } = useI18n()

const query = ref('')
const keyboardFocusedId = ref<string | null>(null)
const hoveredId = ref<string | null>(null)
const badgeIdPrefix = useId()

const cards = computed<HiddenAppCard[]>(() => {
  const needle = query.value.trim().toLowerCase()
  return apps
    .filter((app) => !needle || `${app.title}\n${app.description}`.toLowerCase().includes(needle))
    .map((app) => ({ ...app, badges: hiddenAppBadges(app.reasons, t) }))
})

function badgeIdPrefixFor(app: AppCard): string {
  return `${badgeIdPrefix}-${app.id}`
}

function badgesDescribing(app: AppCard): string | undefined {
  return badgeDescriptionIds(badgeIdPrefixFor(app), app.badges)
}

function noteCardFocus(app: AppCard, event: FocusEvent): void {
  const card = event.currentTarget
  keyboardFocusedId.value =
    card instanceof HTMLElement && card.matches(':focus-visible') ? app.id : null
}

function playsCover(app: AppCard): boolean {
  return hoveredId.value === app.id || keyboardFocusedId.value === app.id
}

function openPicked(app: HiddenAppCard): void {
  hoveredId.value = null
  emit('open-app', app)
}
</script>

<template>
  <div
    class="@container/apps flex min-h-0 w-full flex-auto flex-col overflow-y-auto [scrollbar-gutter:stable]"
    :class="PAGE_SPOTLIGHT_CLASS"
    data-testid="staff-apps-view"
  >
    <header class="mx-auto w-full max-w-300 px-10 pt-9 pb-3">
      <h1 class="m-0 text-display font-semibold tracking-[-0.055em] text-foreground">
        {{ t('staffApps.title') }}
      </h1>
      <p class="m-0 mt-2 text-ui text-muted-foreground">{{ t('staffApps.body') }}</p>
    </header>

    <div class="mx-auto flex min-h-8 w-full max-w-300 items-center gap-2 px-10 py-3">
      <div class="ml-auto w-[220px]">
        <BaseInput
          v-model="query"
          class="h-8 [&_input]:text-ui"
          :placeholder="t('staffApps.search')"
          :aria-label="t('staffApps.search')"
        >
          <template #leading><Search :size="14" /></template>
        </BaseInput>
      </div>
    </div>

    <div class="mx-auto w-full max-w-300 px-10 pb-10">
      <EmptyState
        v-if="cards.length === 0"
        class="pt-24"
        data-testid="staff-apps-no-matches"
        :icon="AppWindow"
        :title="t('common.nothingMatches')"
        :text="t('staffApps.noMatchesHint')"
      >
        <Button
          type="button"
          variant="secondary"
          size="md"
          class="px-3 text-[13px]/5"
          data-testid="staff-apps-clear-search"
          @click="query = ''"
        >
          {{ t('common.clearSearch') }}
        </Button>
      </EmptyState>

      <ul v-else :class="RHYTHM_GRID_CLASS" data-testid="staff-apps-grid">
        <li
          v-for="(app, index) in cards"
          :key="app.id"
          class="min-w-0"
          :class="rhythmSpanClass(index)"
        >
          <AppCardTile
            v-if="app.page === 'live'"
            :app="app"
            :playing="playsCover(app)"
            :revealed="keyboardFocusedId === app.id"
            :description-id-prefix="badgeIdPrefixFor(app)"
            :aria-describedby="badgesDescribing(app)"
            :data-testid="`staff-app-card-${app.id}`"
            @click="openPicked(app)"
            @focus="noteCardFocus(app, $event)"
            @blur="keyboardFocusedId = null"
            @mouseenter="hoveredId = app.id"
            @mouseleave="hoveredId = null"
          />
          <AppCardTile
            v-else
            :app="app"
            :description-id-prefix="badgeIdPrefixFor(app)"
            :aria-describedby="badgesDescribing(app)"
            :note="app.page === 'missing' ? t('staffApps.noPage') : t('staffApps.pageUnchecked')"
            :data-testid="`staff-app-card-${app.id}`"
          />
        </li>
      </ul>
    </div>
  </div>
</template>
