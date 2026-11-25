<script setup lang="ts">
import { nextTick, watch } from 'vue'
import { CornerDownLeft } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { activeInstance } from '../../../useProto'
import { readiness } from '../createStarters'
import { hitIcon, hitMeta, hitTitle, pickHit, type CreateSearch } from './lookA'

const {
  search,
  query,
  peek = true
} = defineProps<{
  search: CreateSearch
  query: string
  peek?: boolean
}>()

watch(
  () => search.at.value,
  (i) =>
    nextTick(() =>
      document
        .querySelector<HTMLElement>(`[data-lar-at="${i}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    )
)
</script>

<template>
  <div class="lar">
    <div class="flex min-w-0 flex-1 flex-col" role="group" aria-label="Search results">
      <template v-for="s in search.sections.value" :key="s.title || 'blank'">
        <h2 v-if="s.title" class="lar-sec">{{ s.title }}</h2>
        <button
          v-for="hit in s.hits"
          :key="hit.id"
          type="button"
          class="lar-row"
          :class="search.indexOf(hit) === search.at.value && 'is-at'"
          :aria-current="search.indexOf(hit) === search.at.value"
          :data-lar-at="search.indexOf(hit)"
          @pointermove="search.point(hit)"
          @click="pickHit(hit)"
        >
          <span class="lar-thumb" :class="`is-${hit.type}`">
            <WorkflowCover v-if="hit.type === 'workflow'" :name="hit.workflow.name" />
            <img
              v-else-if="hit.type === 'template'"
              :src="hit.starter.poster"
              alt=""
              loading="lazy"
            />
            <component :is="hitIcon(hit)" v-else :size="18" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-body text-base-foreground">{{ hitTitle(hit) }}</span>
            <span class="truncate text-ui text-subtle-foreground">{{ hitMeta(hit) }}</span>
          </span>
          <span v-if="hit.type === 'workflow'" class="shrink-0 text-ui text-subtle-foreground">
            {{ hit.workflow.modified }}
          </span>
          <CornerDownLeft
            v-if="search.indexOf(hit) === search.at.value"
            :size="14"
            class="shrink-0 text-subtle-foreground"
          />
        </button>
      </template>
      <p v-if="!search.found.value" class="px-3 pt-2 pb-4 text-ui text-subtle-foreground">
        No workflow, template or node matches “{{ query.trim() }}”.
      </p>
    </div>

    <aside v-if="peek && search.current.value" class="lar-peek" aria-live="polite">
      <template v-for="c in [search.current.value]" :key="c.id">
        <div class="lar-peek-media">
          <WorkflowCover v-if="c.type === 'workflow'" :name="c.workflow.name" />
          <template v-else-if="c.type === 'template'">
            <img :src="c.starter.poster" alt="" />
            <video
              v-if="c.starter.clip"
              :src="c.starter.clip"
              muted
              loop
              playsinline
              autoplay
              class="motion-reduce:hidden"
            />
          </template>
          <component :is="hitIcon(c)" v-else :size="28" />
        </div>
        <p class="mt-4 px-1.5 text-heading font-medium text-base-foreground">{{ hitTitle(c) }}</p>
        <p class="mt-1 px-1.5 text-ui text-muted-foreground">
          <template v-if="c.type === 'template'">{{ c.starter.line }}.</template>
          <template v-else-if="c.type === 'workflow'"
            >On {{ hitMeta(c) }}, edited {{ c.workflow.modified.toLowerCase() }}.</template
          >
          <template v-else-if="c.type === 'node'"
            >Starts a canvas on {{ activeInstance.name }} with this node on it.</template
          >
          <template v-else>{{ hitMeta(c) }}.</template>
        </p>
        <span
          v-if="c.type === 'template'"
          class="lar-ready lar-peek-ready"
          :class="`is-${readiness(c.starter.template).tone}`"
          >{{ readiness(c.starter.template).label }}</span
        >
      </template>
    </aside>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .lar {
  display: flex;
  align-items: flex-start;
  gap: 32px;
  width: 100%;
  animation: lar-fade 200ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .lar-sec {
  margin: 22px 12px 8px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .lar-sec:first-child {
  margin-top: 4px;
}
:root .proto-ui.proto-ui.proto-ui .lar-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 14px;
  padding: 8px 12px 8px 8px;
  border-radius: 12px;
  text-align: left;
  outline: none;
  transition: background-color 120ms ease;
}
:root .proto-ui.proto-ui.proto-ui .lar-row.is-at,
:root .proto-ui.proto-ui.proto-ui .lar-row:focus-visible {
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .lar-ready {
  display: inline-flex;
  flex: none;
  align-items: center;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .lar-ready.is-ready {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .lar-thumb {
  display: grid;
  width: 80px;
  height: 52px;
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .lar-thumb.is-blank {
  background: transparent;
  outline: 1px dashed var(--color-border-strong);
  outline-offset: -1px;
}
:root .proto-ui.proto-ui.proto-ui .lar-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .lar-peek {
  position: sticky;
  top: 24px;
  display: flex;
  width: 320px;
  flex: none;
  flex-direction: column;
  align-items: flex-start;
  padding: 12px 12px 16px;
  border-radius: 14px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .lar-peek-media {
  position: relative;
  display: grid;
  width: 100%;
  aspect-ratio: 4 / 3;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: var(--color-card-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .lar-peek-media img,
:root .proto-ui.proto-ui.proto-ui .lar-peek-media video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .lar-peek-ready {
  margin: 12px 6px 0;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--color-card-background);
}
@keyframes lar-fade {
  from {
    opacity: 0;
  }
}
@media (max-width: 1000px) {
  :root .proto-ui.proto-ui.proto-ui .lar-peek {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .lar {
    animation: none;
  }
}
</style>
