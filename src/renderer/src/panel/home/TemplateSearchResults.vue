<script setup lang="ts">
import { computed, onMounted, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import TemplateSearchBadge from './TemplateSearchBadge.vue'
import type { TemplateSearchAvailability, TemplateSearchCandidate } from '../../types/ipc'
import { matchLevel, verticalNeighbour, type BadgeTone, type SearchRow } from './templateSearch'
import type { TemplateSearchController } from './useTemplateSearch'

const props = defineProps<{
  controller: TemplateSearchController
  listboxId: string
}>()

const { t } = useI18n()

const GROUP_TITLE_KEYS: Record<SearchRow['kind'], string> = {
  run: 'home.search.run',
  download: 'home.search.downloadAndRun',
  also: 'home.search.alsoTry'
}

const MATCH_LEVEL_KEYS = {
  strong: 'home.search.matchStrong',
  good: 'home.search.matchGood',
  weak: 'home.search.matchWeak'
} as const

const UNAVAILABLE_KEYS = {
  runtime_unsupported: 'home.search.runtimeUnsupported',
  update_desktop: 'home.search.updateDesktop',
  offline: 'home.search.offline',
  download_failed: 'home.search.downloadFailed',
  failed: 'home.search.failed'
} as const

interface Badge {
  tone: BadgeTone
  label: string
  testId: string
}

interface Notice {
  text: string
  action?: { label: string; run: () => void; testId: string }
}

function availabilityNotice(availability: TemplateSearchAvailability): Notice {
  switch (availability.kind) {
    case 'off':
      return { text: t('home.search.notSetUp') }
    case 'no_local_build':
      return { text: t('home.search.needsLocalBuildToSearch') }
    case 'waiting_for_build':
      return { text: t('home.search.waitingForBuild') }
    case 'downloading':
      return {
        text: t('home.search.downloadingModel', {
          percent: availability.total
            ? Math.floor((availability.received / availability.total) * 100)
            : 0
        })
      }
    case 'unavailable':
      return availability.reason === 'download_failed'
        ? {
            text: t(UNAVAILABLE_KEYS.download_failed),
            action: {
              label: t('home.retry'),
              run: props.controller.download,
              testId: 'home-template-search-download'
            }
          }
        : { text: t(UNAVAILABLE_KEYS[availability.reason]) }
    default:
      return { text: t('home.search.starting') }
  }
}

const notice = computed<Notice | null>(() => {
  const state = props.controller.state.value
  if (state.kind === 'unavailable') return availabilityNotice(state.availability)
  if (state.kind === 'failed') return { text: t('home.search.failed') }
  if (state.kind === 'searching') return { text: t('home.search.searching') }
  return null
})

function matchBadge(candidate: TemplateSearchCandidate): Badge | null {
  const level = matchLevel(candidate)
  if (level === null) return null
  return {
    tone: level,
    label:
      candidate.calibrated === null
        ? t(MATCH_LEVEL_KEYS[level])
        : t('home.search.matchPercent', { percent: Math.round(candidate.calibrated * 100) }),
    testId: 'home-template-search-match'
  }
}

function badges(row: SearchRow): Badge[] {
  const candidate = row.candidate
  const list: Badge[] = []
  if (row.best)
    list.push({
      tone: 'best',
      label: t('home.search.bestMatch'),
      testId: 'home-template-search-best'
    })
  const match = matchBadge(candidate)
  if (match) list.push(match)
  if (candidate.partner)
    list.push({
      tone: 'partner',
      label: t('home.search.partner'),
      testId: 'home-template-search-partner'
    })
  return list
}

function isWeak(row: SearchRow): boolean {
  return row.candidate.belowThreshold
}

function rowMeta(row: SearchRow): string {
  const candidate = row.candidate
  if (!candidate.needsDownload) return candidate.family ?? t('home.search.template')
  return candidate.missing.length
    ? t('home.search.needsDownload', { items: candidate.missing.join(', ') })
    : t('home.search.needsTemplateDownload')
}

function rowAction(row: SearchRow): string {
  return row.candidate.needsDownload ? t('home.search.downloadAndRun') : t('home.search.run')
}

function startsGroup(index: number): boolean {
  const rows = props.controller.rows.value
  return index === 0 || rows[index - 1]!.kind !== rows[index]!.kind
}

function optionId(index: number): string {
  return `${props.listboxId}-${index}`
}

const panel = useTemplateRef<HTMLElement>('panel')
const cardList = useTemplateRef<HTMLElement>('cardList')

function cards(): HTMLElement[] {
  return [...(cardList.value?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
}

function verticalTarget(step: 1 | -1): number | null {
  const boxes = cards().map((card) => card.getBoundingClientRect())
  return verticalNeighbour(boxes, props.controller.activeIndex.value, step)
}

function revealActive(): void {
  const all = cards()
  const active = all[props.controller.activeIndex.value]
  if (!active) return
  if (active.offsetTop === all[0]!.offsetTop) panel.value?.scrollTo({ top: 0 })
  active.scrollIntoView({ block: 'nearest' })
}

watch(() => props.controller.rows.value, revealActive, { flush: 'post' })
onMounted(revealActive)

defineExpose({ verticalTarget, revealActive })
</script>

<template>
  <div
    ref="panel"
    tabindex="-1"
    :class="{ 'scroll-pt-10': controller.openFailed.value }"
    @mousedown.prevent
  >
    <div
      v-if="notice"
      class="flex items-center justify-between gap-3 px-2.5 py-2"
      data-testid="home-template-search-notice"
    >
      <p class="m-0 text-[13px]/5 text-muted-foreground">{{ notice.text }}</p>
      <Button
        v-if="notice.action"
        type="button"
        variant="secondary"
        size="md"
        :data-testid="notice.action.testId"
        @click="notice.action.run"
      >
        {{ notice.action.label }}
      </Button>
    </div>
    <template v-else-if="controller.state.value.kind === 'result'">
      <p
        v-if="controller.reply.value"
        class="m-0 px-2.5 py-2 text-[13px]/5 text-foreground"
        data-testid="home-template-search-reply"
      >
        {{ controller.reply.value }}
      </p>
      <p
        v-else-if="!controller.rows.value.length"
        class="m-0 px-2.5 py-2 text-[13px]/5 text-muted-foreground"
        data-testid="home-template-search-no-match"
      >
        {{ t('home.search.noMatch') }}
      </p>
    </template>

    <p
      v-if="controller.openFailed.value"
      class="sticky top-0 z-10 m-0 rounded-lg bg-content-background px-2.5 py-2 text-xs/4 text-muted-foreground"
      data-testid="home-template-search-open-failed"
    >
      {{ t('home.search.openFailed') }}
    </p>

    <ul
      :id="listboxId"
      ref="cardList"
      role="listbox"
      class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2 p-0"
      :aria-label="t('home.search.label')"
    >
      <template v-for="(row, index) in controller.rows.value" :key="row.key">
        <li
          v-if="startsGroup(index)"
          role="presentation"
          class="col-span-full px-1 pt-2 text-[11px]/4 font-medium tracking-[0.09em] text-subtle-foreground uppercase"
        >
          {{ t(GROUP_TITLE_KEYS[row.kind]) }}
        </li>
        <li
          :id="optionId(index)"
          role="option"
          :aria-selected="index === controller.activeIndex.value"
          :data-weak="isWeak(row) || undefined"
          class="flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border"
          :class="
            index === controller.activeIndex.value
              ? 'border-[rgb(137_137_137/0.5)] bg-[rgb(137_137_137/0.12)]'
              : 'border-[rgb(137_137_137/0.16)] bg-[rgb(137_137_137/0.04)]'
          "
          :data-testid="`home-template-search-row-${row.kind}`"
          @mousemove="controller.highlight(index)"
          @click="controller.openRow(row)"
        >
          <span
            class="flex aspect-[4/3] items-center justify-center overflow-hidden bg-[rgb(137_137_137/0.12)]"
          >
            <img
              v-if="row.candidate.thumbnailUrl"
              :src="row.candidate.thumbnailUrl"
              alt=""
              class="size-full object-cover"
              :class="isWeak(row) ? 'opacity-60 grayscale' : ''"
              loading="lazy"
            />
          </span>
          <span class="flex min-w-0 flex-auto flex-col gap-2 p-2.5">
            <span class="flex min-w-0 flex-col" :class="isWeak(row) ? 'opacity-60' : ''">
              <span class="line-clamp-2 text-[13px]/5 font-medium text-foreground">
                {{ row.candidate.title }}
              </span>
              <span class="truncate text-xs/4 text-subtle-foreground">{{ rowMeta(row) }}</span>
            </span>
            <span class="flex flex-wrap gap-1.5">
              <TemplateSearchBadge
                v-for="badge in badges(row)"
                :key="badge.testId"
                :tone="badge.tone"
                :data-testid="badge.testId"
              >
                {{ badge.label }}
              </TemplateSearchBadge>
            </span>
            <span class="mt-auto text-xs/4 font-medium text-muted-foreground">
              {{ rowAction(row) }}
            </span>
          </span>
        </li>
      </template>
    </ul>
  </div>
</template>
