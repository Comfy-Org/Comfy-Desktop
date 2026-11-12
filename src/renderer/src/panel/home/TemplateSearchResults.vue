<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Bot } from 'lucide-vue-next'
import TemplateSearchBadge from './TemplateSearchBadge.vue'
import type { TemplateSearchCandidate } from '../../types/ipc'
import type { BadgeTone, SearchRow } from './templateSearch'
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
}

function matchBadge(candidate: TemplateSearchCandidate): Badge | null {
  if (candidate.score === null) return null
  const percent = Math.round(candidate.score * 100)
  const level = candidate.belowThreshold
    ? { tone: 'weak' as const, key: 'home.search.matchWeak' }
    : candidate.score >= STRONG_MATCH
      ? { tone: 'strong' as const, key: 'home.search.matchStrong' }
      : { tone: 'good' as const, key: 'home.search.matchGood' }
  return {
    tone: level.tone,
    label: `${t(level.key)} · ${percent}%`,
    testId: 'home-template-search-match'
  }
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
  if (candidate.rewrite)
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
  if (!candidate.needsDownload) return candidate.family ?? t('home.search.template')
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
          <span
            v-if="row.kind !== 'agent'"
            class="absolute top-2 left-2 rounded-md px-1.5 py-0.5 text-[12px]/4 font-semibold shadow-[0_1px_6px_rgb(0_0_0/0.5)]"
            :class="
              row.best ? 'bg-[rgb(110_130_255)] text-white' : 'bg-[rgb(0_0_0/0.72)] text-white'
            "
          >
            #{{ index + 1 }}
          </span>
        </span>
        <span
          class="flex min-w-0 flex-col gap-2 px-3 py-2.5"
          :class="isWeak(row) ? 'opacity-70' : ''"
        >
          <span class="flex min-w-0 flex-col">
            <span class="truncate text-[13px]/5 font-medium text-foreground">
              {{ row.kind === 'agent' ? t('home.search.agentTitle') : row.candidate?.title }}
            </span>
            <span class="truncate text-xs/4 text-subtle-foreground">{{ rowMeta(row) }}</span>
          </span>
          <span v-if="badges(row).length" class="flex flex-wrap gap-1.5">
            <TemplateSearchBadge
              v-for="badge in badges(row)"
              :key="badge.testId"
              :tone="badge.tone"
              :data-testid="badge.testId"
            >
              {{ badge.label }}
            </TemplateSearchBadge>
          </span>
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
