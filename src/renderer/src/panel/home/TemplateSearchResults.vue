<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Bot, CircleDollarSign } from 'lucide-vue-next'
import TemplateSearchBadge from './TemplateSearchBadge.vue'
import type { TemplateSearchCandidate } from '../../types/ipc'
import { rewritesPrompt, type BadgeTone, type SearchRow } from './templateSearch'
import type { TemplateSearchController } from './useTemplateSearch'

const props = defineProps<{
  controller: TemplateSearchController
  layout: 'list' | 'grid'
  listboxId: string
}>()

const { t } = useI18n()

const STRONG_MATCH = 0.85

const GROUP_TITLE_KEYS: Record<SearchRow['kind'], string> = {
  run: 'home.search.run',
  download: 'home.search.downloadAndRun',
  also: 'home.search.alsoTry',
  agent: 'home.search.agentGroup'
}

interface Badge {
  tone: BadgeTone
  label: string
  testId: string
  title?: string
}

type MatchLevel = 'strong' | 'good' | 'weak'

const MATCH_LEVEL_KEYS: Record<MatchLevel, string> = {
  strong: 'home.search.matchStrong',
  good: 'home.search.matchGood',
  weak: 'home.search.matchWeak'
}

const MATCH_BOX: Record<MatchLevel, string> = {
  strong: 'bg-[rgb(28_150_88)]',
  good: 'bg-[rgb(50_112_205)]',
  weak: 'bg-[rgb(92_92_98)]'
}

function matchLevel(candidate: TemplateSearchCandidate): MatchLevel | null {
  if (candidate.score === null) return null
  if (candidate.belowThreshold) return 'weak'
  return candidate.score >= STRONG_MATCH ? 'strong' : 'good'
}

function rawScore(candidate: TemplateSearchCandidate): string {
  return (candidate.score ?? 0).toFixed(2)
}

function shownScore(candidate: TemplateSearchCandidate): string {
  return candidate.calibrated === null
    ? rawScore(candidate)
    : `${Math.round(candidate.calibrated * 100)}%`
}

function belowBar(candidate: TemplateSearchCandidate): string {
  return typeof candidate.calibratedThreshold === 'number'
    ? t('home.search.belowBar', { bar: Math.round(candidate.calibratedThreshold * 100) })
    : t('home.search.belowBarPlain')
}

function scoreNote(candidate: TemplateSearchCandidate): string {
  const raw =
    candidate.calibrated === null
      ? t('home.search.matchUncalibrated')
      : t('home.search.matchRaw', { raw: (candidate.score ?? 0).toFixed(3) })
  return candidate.belowThreshold ? `${belowBar(candidate)} · ${raw}` : raw
}

function matchLabel(candidate: TemplateSearchCandidate): string {
  const level = matchLevel(candidate)
  return level
    ? `${t(MATCH_LEVEL_KEYS[level])} · ${shownScore(candidate)} (${scoreNote(candidate)})`
    : ''
}

function matchBadgeLabel(candidate: TemplateSearchCandidate): string {
  const level = matchLevel(candidate)
  return level ? `${t(MATCH_LEVEL_KEYS[level])} · ${shownScore(candidate)}` : ''
}

function matchBadge(candidate: TemplateSearchCandidate): Badge | null {
  const level = matchLevel(candidate)
  if (level === null) return null
  return {
    tone: level,
    label: matchBadgeLabel(candidate),
    title: matchLabel(candidate),
    testId: 'home-template-search-match'
  }
}

function cornerBadges(row: SearchRow): Badge[] {
  return badges(row).filter((badge) => badge.tone === 'download')
}

function badges(row: SearchRow): Badge[] {
  const candidate = row.candidate
  if (!candidate) return []
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
  if (candidate.needsDownload)
    list.push({
      tone: 'download',
      label: t('home.search.needsDownloadPill'),
      testId: 'home-template-search-needs-download'
    })
  if (rewritesPrompt(candidate))
    list.push({
      tone: 'rewrite',
      label: t('home.search.rewritePill'),
      testId: 'home-template-search-rewrite'
    })
  return list
}

function isWeak(row: SearchRow): boolean {
  return row.candidate?.belowThreshold === true
}

function rowMeta(row: SearchRow): string {
  if (row.kind === 'agent') return t('home.search.agentSoon')
  const blocked = props.controller.blockedReason.value
  if (blocked !== null) return blocked
  const candidate = row.candidate as TemplateSearchCandidate
  if (!candidate.needsDownload) {
    const family = candidate.family ?? t('home.search.template')
    return candidate.belowThreshold ? `${family} · ${belowBar(candidate)}` : family
  }
  return candidate.missing.length
    ? t('home.search.needsDownload', { items: candidate.missing.join(', ') })
    : t('home.search.needsTemplateDownload')
}

function rowAction(row: SearchRow): string {
  if (row.kind === 'agent') return t('home.search.askAgent')
  return row.candidate?.needsDownload ? t('home.search.downloadAndRun') : t('home.search.run')
}

function startsGroup(index: number): boolean {
  const rows = props.controller.rows.value
  return index === 0 || rows[index - 1]!.kind !== rows[index]!.kind
}

function optionId(index: number): string {
  return `${props.listboxId}-${index}`
}
</script>

<template>
  <div :data-layout="layout">
    <p
      v-if="controller.state.value.kind === 'searching' && !controller.rows.value.length"
      class="m-0 px-2.5 py-2 text-[13px]/5 text-muted-foreground"
    >
      {{ t('home.search.searching') }}
    </p>
    <p
      v-else-if="controller.state.value.kind === 'failed'"
      class="m-0 px-2.5 py-2 text-[13px]/5 text-muted-foreground"
      data-testid="home-template-search-failed"
    >
      {{ t('home.search.failed') }}
    </p>
    <template v-else>
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
      >
        {{ t('home.search.noMatch') }}
      </p>
    </template>

    <ul
      v-if="layout === 'list'"
      :id="listboxId"
      role="listbox"
      class="m-0 list-none p-0"
      :aria-label="t('home.search.label')"
    >
      <template v-for="(row, index) in controller.rows.value" :key="row.key">
        <li
          v-if="startsGroup(index)"
          role="presentation"
          class="px-2.5 pt-2 pb-1 text-[11px]/4 font-medium tracking-[0.09em] text-subtle-foreground uppercase"
        >
          {{ t(GROUP_TITLE_KEYS[row.kind]) }}
        </li>
        <li
          :id="optionId(index)"
          role="option"
          :aria-selected="index === controller.activeIndex.value"
          :aria-disabled="controller.rowDisabled(row)"
          :data-weak="isWeak(row) || undefined"
          class="flex min-h-14 items-center gap-3 rounded-[8px] px-2.5 py-2"
          :class="[
            index === controller.activeIndex.value ? 'bg-[rgb(137_137_137/0.12)]' : '',
            controller.rowDisabled(row) ? 'cursor-default opacity-60' : 'cursor-pointer'
          ]"
          :data-testid="`home-template-search-row-${row.kind}`"
          @mouseenter="controller.highlight(index)"
          @mousedown.prevent
          @click="controller.openRow(row)"
        >
          <span
            class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[7px] bg-[rgb(137_137_137/0.12)]"
          >
            <Bot v-if="row.kind === 'agent'" :size="18" class="text-muted-foreground" />
            <img
              v-else-if="row.candidate?.thumbnailUrl"
              :src="row.candidate.thumbnailUrl"
              alt=""
              class="size-full object-cover"
              :class="isWeak(row) ? 'opacity-60 grayscale' : ''"
              loading="lazy"
            />
          </span>
          <span class="flex min-w-0 flex-auto flex-col" :class="isWeak(row) ? 'opacity-60' : ''">
            <span class="truncate text-[13px]/5 font-medium text-foreground">
              {{ row.kind === 'agent' ? t('home.search.agentTitle') : row.candidate?.title }}
            </span>
            <span class="truncate text-xs/4 text-subtle-foreground">{{ rowMeta(row) }}</span>
          </span>
          <span class="flex shrink-0 flex-wrap justify-end gap-1.5">
            <TemplateSearchBadge
              v-for="badge in badges(row)"
              :key="badge.testId"
              :tone="badge.tone"
              :title="badge.title"
              :data-testid="badge.testId"
            >
              {{ badge.label }}
            </TemplateSearchBadge>
          </span>
          <span class="w-26 shrink-0 text-right text-xs/4 font-medium text-muted-foreground">
            {{ rowAction(row) }}
          </span>
        </li>
      </template>
    </ul>

    <ul
      v-else
      :id="listboxId"
      role="listbox"
      class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(212px,1fr))] gap-3 p-0"
      :aria-label="t('home.search.label')"
    >
      <li
        v-for="(row, index) in controller.rows.value"
        :id="optionId(index)"
        :key="row.key"
        role="option"
        :aria-selected="index === controller.activeIndex.value"
        :aria-disabled="controller.rowDisabled(row)"
        :data-weak="isWeak(row) || undefined"
        class="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-[rgb(137_137_137/0.06)] transition-colors"
        :class="[
          index === controller.activeIndex.value
            ? 'border-[rgb(120_140_255/0.85)]'
            : 'border-[rgb(137_137_137/0.16)]',
          controller.rowDisabled(row) ? 'cursor-default opacity-60' : 'cursor-pointer'
        ]"
        :data-testid="`home-template-search-row-${row.kind}`"
        @mouseenter="controller.highlight(index)"
        @mousedown.prevent
        @click="controller.openRow(row)"
      >
        <span
          class="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[rgb(137_137_137/0.1)]"
        >
          <Bot v-if="row.kind === 'agent'" :size="28" class="text-muted-foreground" />
          <img
            v-else-if="row.candidate?.thumbnailUrl"
            :src="row.candidate.thumbnailUrl"
            alt=""
            class="size-full object-cover"
            :class="isWeak(row) ? 'opacity-50 grayscale' : ''"
            loading="lazy"
          />
          <span v-if="row.kind !== 'agent'" class="absolute top-2 left-2 flex items-center gap-1.5">
            <span
              class="rounded-md px-1.5 py-0.5 text-[12px]/4 font-semibold text-white shadow-[0_2px_8px_rgb(0_0_0/0.45)]"
              :class="row.best ? 'bg-[rgb(110_130_255)]' : 'bg-[rgb(12_12_14/0.82)]'"
            >
              #{{ index + 1 }}
            </span>
            <span
              v-if="row.candidate?.partner"
              class="inline-flex h-6 items-center gap-1 rounded-md bg-[linear-gradient(90deg,rgb(255_200_40),rgb(240_88_48))] px-2 text-[13px] leading-none font-bold text-[rgb(34_14_0)] shadow-[0_2px_10px_rgb(0_0_0/0.5)] ring-1 ring-[rgb(255_255_255/0.35)] ring-inset"
              data-testid="home-template-search-partner"
            >
              <CircleDollarSign :size="14" :stroke-width="2.5" aria-hidden="true" />
              {{ t('home.search.partner') }}
            </span>
          </span>
          <span
            v-if="row.candidate && matchLevel(row.candidate)"
            class="absolute top-2 right-2 rounded-md px-1.5 py-0.5 text-[12px]/4 font-semibold text-white shadow-[0_2px_8px_rgb(0_0_0/0.45)] ring-1 ring-[rgb(255_255_255/0.18)] ring-inset"
            :class="MATCH_BOX[matchLevel(row.candidate) ?? 'weak']"
            :title="matchLabel(row.candidate)"
            :aria-label="matchLabel(row.candidate)"
            :data-level="matchLevel(row.candidate)"
            data-testid="home-template-search-match"
          >
            {{ shownScore(row.candidate) }}
          </span>
          <span v-if="cornerBadges(row).length" class="absolute bottom-2 left-2 flex gap-1">
            <TemplateSearchBadge
              v-for="badge in cornerBadges(row)"
              :key="badge.testId"
              :tone="badge.tone"
              overlay
              :data-testid="badge.testId"
            >
              {{ badge.label }}
            </TemplateSearchBadge>
          </span>
          <TemplateSearchBadge
            v-if="row.candidate && rewritesPrompt(row.candidate)"
            tone="rewrite"
            overlay
            class="absolute right-2 bottom-2"
            data-testid="home-template-search-rewrite"
          >
            {{ t('home.search.rewritePill') }}
          </TemplateSearchBadge>
        </span>
        <span class="flex min-w-0 flex-col px-3 py-2.5" :class="isWeak(row) ? 'opacity-70' : ''">
          <span class="truncate text-[13px]/5 font-medium text-foreground">
            {{ row.kind === 'agent' ? t('home.search.agentTitle') : row.candidate?.title }}
          </span>
          <span class="truncate text-xs/4 text-subtle-foreground">{{ rowMeta(row) }}</span>
        </span>
      </li>
    </ul>

    <p
      v-if="controller.openFailed.value"
      class="m-0 px-2.5 pt-1 pb-2 text-xs/4 text-muted-foreground"
      data-testid="home-template-search-open-failed"
    >
      {{ t('home.search.openFailed') }}
    </p>
  </div>
</template>
