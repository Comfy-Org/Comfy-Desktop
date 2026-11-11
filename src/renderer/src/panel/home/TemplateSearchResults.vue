<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Bot } from 'lucide-vue-next'
import type { TemplateSearchCandidate } from '../../types/ipc'
import type { SearchRow } from './templateSearch'
import type { TemplateSearchController } from './useTemplateSearch'

const props = defineProps<{
  controller: TemplateSearchController
  layout: 'list' | 'grid'
  listboxId: string
}>()

const { t } = useI18n()

const GROUP_TITLE_KEYS: Record<SearchRow['kind'], string> = {
  run: 'home.search.run',
  download: 'home.search.downloadAndRun',
  also: 'home.search.alsoTry',
  agent: 'home.search.agentGroup'
}

function rowMeta(row: SearchRow): string {
  if (row.kind === 'agent') return t('home.search.agentSoon')
  const blocked = props.controller.blockedReason.value
  if (blocked !== null) return blocked
  const candidate = row.candidate as TemplateSearchCandidate
  if (row.kind !== 'download') return candidate.family ?? t('home.search.template')
  return candidate.missing.length
    ? t('home.search.needsDownload', { items: candidate.missing.join(', ') })
    : t('home.search.needsTemplateDownload')
}

function rowAction(row: SearchRow): string {
  if (row.kind === 'agent') return t('home.search.askAgent')
  return row.kind === 'download' ? t('home.search.downloadAndRun') : t('home.search.run')
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
          class="flex h-14 items-center gap-3 rounded-[8px] px-2.5"
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
              loading="lazy"
            />
          </span>
          <span class="flex min-w-0 flex-auto flex-col">
            <span class="truncate text-[13px]/5 font-medium text-foreground">
              {{ row.kind === 'agent' ? t('home.search.agentTitle') : row.candidate?.title }}
            </span>
            <span class="truncate text-xs/4 text-subtle-foreground">{{ rowMeta(row) }}</span>
          </span>
          <span
            v-if="row.candidate?.rewrite"
            class="shrink-0 rounded-full bg-[rgb(137_137_137/0.14)] px-2 py-0.5 text-[11px]/4 text-muted-foreground"
            data-testid="home-template-search-rewrite"
          >
            {{ t('home.search.rewritePill') }}
          </span>
          <span
            v-if="row.candidate?.partner"
            class="shrink-0 rounded-full bg-[rgb(120_140_255/0.16)] px-2 py-0.5 text-[11px]/4 text-[rgb(170_182_255)]"
            data-testid="home-template-search-partner"
          >
            {{ t('home.search.partner') }}
          </span>
          <span
            v-if="row.kind === 'download'"
            class="shrink-0 rounded-full bg-[rgb(255_190_90/0.14)] px-2 py-0.5 text-[11px]/4 text-[rgb(240_190_110)]"
            data-testid="home-template-search-needs-download"
          >
            {{ t('home.search.needsDownloadPill') }}
          </span>
          <span
            v-if="row.best"
            class="shrink-0 rounded-full bg-[rgb(137_137_137/0.14)] px-2 py-0.5 text-[11px]/4 text-muted-foreground"
            data-testid="home-template-search-best"
          >
            {{ t('home.search.bestMatch') }}
          </span>
          <span class="shrink-0 text-xs/4 font-medium text-muted-foreground">
            {{ rowAction(row) }}
          </span>
        </li>
      </template>
    </ul>

    <ul
      v-else
      :id="listboxId"
      role="listbox"
      class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-3 p-0"
      :aria-label="t('home.search.label')"
    >
      <li
        v-for="(row, index) in controller.rows.value"
        :id="optionId(index)"
        :key="row.key"
        role="option"
        :aria-selected="index === controller.activeIndex.value"
        :aria-disabled="controller.rowDisabled(row)"
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
            loading="lazy"
          />
          <span
            v-if="row.kind !== 'agent'"
            class="absolute top-2 left-2 rounded-md px-1.5 py-0.5 text-[11px]/4 font-semibold"
            :class="
              row.best ? 'bg-[rgb(120_140_255/0.9)] text-white' : 'bg-[rgb(0_0_0/0.6)] text-white'
            "
          >
            #{{ index + 1 }}
          </span>
          <span class="absolute top-2 right-2 flex flex-wrap justify-end gap-1">
            <span
              v-if="row.candidate?.partner"
              class="rounded-full bg-[rgb(40_48_110/0.85)] px-2 py-0.5 text-[11px]/4 text-[rgb(200_208_255)]"
              data-testid="home-template-search-partner"
            >
              {{ t('home.search.partner') }}
            </span>
            <span
              v-if="row.kind === 'download'"
              class="rounded-full bg-[rgb(90_60_10/0.85)] px-2 py-0.5 text-[11px]/4 text-[rgb(255_210_140)]"
              data-testid="home-template-search-needs-download"
            >
              {{ t('home.search.needsDownloadPill') }}
            </span>
            <span
              v-if="row.candidate?.rewrite"
              class="rounded-full bg-[rgb(0_0_0/0.6)] px-2 py-0.5 text-[11px]/4 text-white"
              data-testid="home-template-search-rewrite"
            >
              {{ t('home.search.rewritePill') }}
            </span>
          </span>
        </span>
        <span class="flex min-w-0 flex-col px-3 py-2.5">
          <span class="truncate text-[13px]/5 font-medium text-foreground">
            {{ row.kind === 'agent' ? t('home.search.agentTitle') : row.candidate?.title }}
          </span>
          <span class="truncate text-xs/4 text-subtle-foreground">
            {{
              row.kind === 'also' ? `${rowMeta(row)} · ${t('home.search.alsoTry')}` : rowMeta(row)
            }}
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
