<script setup lang="ts">
import { computed, onMounted, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import Switch from '@comfyorg/design-system/switch/Switch'
import { formatSize } from '../../lib/formatting'
import TemplateSearchBadge from './TemplateSearchBadge.vue'
import type {
  TemplateSearchAvailability,
  TemplateSearchCandidate,
  TemplateSearchInput
} from '../../types/ipc'
import { matchLevel, verticalNeighbour, type BadgeTone, type SearchRow } from './templateSearch'
import type { TemplateSearchController } from './useTemplateSearch'

const props = defineProps<{
  controller: TemplateSearchController
  listboxId: string
}>()

const emit = defineEmits<{ refocus: [] }>()

const { t, locale } = useI18n()

const SMALLEST_SHOWN_SIZE = 1_000_000

const MATCH_LEVEL_KEYS = {
  strong: 'home.search.matchStrong',
  good: 'home.search.matchGood',
  weak: 'home.search.matchWeak'
} as const

const INPUT_KEYS: Record<TemplateSearchInput, string> = {
  image: 'home.search.needsImage',
  video: 'home.search.needsVideo',
  audio: 'home.search.needsAudio'
}

function inputCounts(needs: TemplateSearchInput[]): [TemplateSearchInput, number][] {
  const counts = new Map<TemplateSearchInput, number>()
  for (const kind of needs) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  return [...counts]
}

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

const matchedNames = computed(() => {
  const state = props.controller.state.value
  return state.kind === 'result' ? state.result.matched : null
})

const replyShown = computed(
  () =>
    !!props.controller.reply.value && !(matchedNames.value && props.controller.rows.value.length)
)

const resultsTitle = computed(() => {
  const names = matchedNames.value
  return names
    ? t('home.search.resultsFor', { names: new Intl.ListFormat(locale.value).format(names) })
    : t('home.search.resultsTitle')
})

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
  const match = row.familyPick ? matchBadge(candidate) : null
  if (match) list.push(match)
  if (candidate.needsDownload)
    list.push({
      tone: 'download',
      label: downloadLabel(candidate),
      testId: 'home-template-search-needs-download'
    })
  for (const [kind, count] of inputCounts(candidate.needs))
    list.push({
      tone: 'input',
      label: t(INPUT_KEYS[kind], count),
      testId: 'home-template-search-needs-input'
    })
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

function downloadLabel(candidate: TemplateSearchCandidate): string {
  return candidate.downloadBytes !== null && candidate.downloadBytes >= SMALLEST_SHOWN_SIZE
    ? t('home.search.needsDownloadSize', { size: formatSize(candidate.downloadBytes) })
    : t('home.search.needsDownload')
}

function changePartners(shown: boolean): void {
  void props.controller.setPartnersShown(shown)
  emit('refocus')
}

function pick(row: SearchRow, event: MouseEvent): void {
  if (event.detail > 1) return
  props.controller.activate(row, 'pointer')
}

function startsAlsoTry(index: number): boolean {
  const rows = props.controller.rows.value
  return rows[index]!.kind === 'also' && rows[index - 1]?.kind !== 'also'
}

function optionId(index: number): string {
  return `${props.listboxId}-${index}`
}

const heading = useTemplateRef<HTMLElement>('heading')
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
  if (active.offsetTop === all[0]!.offsetTop) heading.value?.scrollIntoView({ block: 'nearest' })
  active.scrollIntoView({ block: 'nearest' })
}

watch(() => props.controller.rows.value, revealActive, { flush: 'post' })
onMounted(revealActive)

defineExpose({ verticalTarget, revealActive })
</script>

<template>
  <div
    :class="{ '[&_[role=option]]:scroll-mt-10': controller.openFailed.value }"
    @mousedown.prevent
    @keydown.esc="emit('refocus')"
  >
    <div ref="heading" class="mb-2.5 flex min-h-6 items-center justify-between gap-3">
      <h2 class="m-0 text-[11px]/4 font-medium tracking-[0.09em] text-subtle-foreground uppercase">
        {{ resultsTitle }}
      </h2>
      <label
        v-if="controller.partnerSwitch.value"
        class="flex items-center gap-2 text-xs/4 text-muted-foreground"
        data-testid="home-template-search-partner-switch"
      >
        {{ t('home.search.partnerSwitch') }}
        <Switch
          :model-value="controller.partnersShown.value"
          :aria-label="t('home.search.partnerSwitch')"
          @update:model-value="(shown: boolean) => changePartners(shown)"
        />
      </label>
    </div>
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
        v-if="replyShown"
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
          v-if="startsAlsoTry(index)"
          role="presentation"
          class="col-span-full px-1 pt-2 text-[11px]/4 font-medium tracking-[0.09em] text-subtle-foreground uppercase"
        >
          {{ t('home.search.alsoTry') }}
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
          @click="pick(row, $event)"
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
              <span class="truncate text-xs/4 text-subtle-foreground">{{
                row.candidate.family ?? t('home.search.template')
              }}</span>
            </span>
            <span class="flex flex-wrap gap-1.5">
              <TemplateSearchBadge
                v-for="badge in badges(row)"
                :key="badge.label"
                :tone="badge.tone"
                :title="badge.label"
                :data-testid="badge.testId"
              >
                {{ badge.label }}
              </TemplateSearchBadge>
            </span>
            <span
              v-if="controller.needsSignIn(row)"
              class="mt-auto text-xs/4 font-medium text-muted-foreground"
              data-testid="home-template-search-row-action"
            >
              {{ t('home.search.signInToUse') }}
            </span>
          </span>
        </li>
      </template>
    </ul>
  </div>
</template>
