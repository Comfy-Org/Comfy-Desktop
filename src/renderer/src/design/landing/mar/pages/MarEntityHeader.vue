<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import MarStatus, { type ItemStatus } from './MarStatus.vue'

/**
 * The header of one thing's page (a project, a space) in Mar's proposal:
 * the way back, then cover, title and state with one quiet meta line on
 * the left; one action group on the right (secondary, the single primary,
 * ⋯ last), every control at the Corners radius, no pills. No `back` when
 * the title bar's breadcrumb already says where the page sits.
 */
const { back, onTabs, title, status, statusLabel, statusLink } = defineProps<{
  back?: string
  /** The title sits on the line of the sidebar's Create/Build tabs. */
  onTabs?: boolean
  title: string
  status?: ItemStatus
  statusLabel?: string
  /** The state leads somewhere: it's a button, and says where. */
  statusLink?: string
}>()
const emit = defineEmits<{ back: []; status: [] }>()
</script>

<template>
  <div class="mar-eh" :class="onTabs && 'is-on-tabs'">
    <button v-if="back" type="button" class="mar-eh-crumb" @click="emit('back')">
      <ArrowLeft :size="14" />{{ back }}
    </button>
    <section class="mar-eh-head">
      <span v-if="$slots.cover" class="mar-eh-cover"><slot name="cover" /></span>
      <div class="mar-eh-text">
        <div class="flex min-w-0 items-center gap-2">
          <slot name="title">
            <h1 class="mar-eh-title">{{ title }}</h1>
          </slot>
          <button
            v-if="status && statusLink"
            type="button"
            class="inline-flex"
            :aria-label="statusLink"
            :title="statusLink"
            @click="emit('status')"
          >
            <MarStatus :status :label="statusLabel" />
          </button>
          <MarStatus v-else-if="status" :status :label="statusLabel" />
        </div>
        <div v-if="$slots.meta" class="mar-eh-meta"><slot name="meta" /></div>
      </div>
      <div v-if="$slots.actions" class="mar-eh-actions"><slot name="actions" /></div>
    </section>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mar-eh-crumb {
  display: inline-flex;
  height: 26px;
  align-items: center;
  gap: 6px;
  margin: 0 0 14px -8px;
  padding: 0 8px;
  border-radius: var(--radius-control);
  color: var(--color-muted-foreground);
  font-size: 13px;
}
:root .proto-ui.proto-ui.proto-ui .mar-eh-crumb:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
}
/* On a narrow window the actions wrap under the title rather than squeeze
   it to a few letters or sit over the meta line. */
.mar-eh-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px 18px;
  padding-bottom: 28px;
}
.mar-eh-text {
  min-width: 0;
  flex: 1 1 320px;
}
/* The way back moves up, so the title's centre lands on the tabs' line. */
:root .proto-ui.proto-ui.proto-ui .mar-eh.is-on-tabs .mar-eh-crumb {
  margin: -8px 0 -2px -8px;
}
.mar-eh.is-on-tabs .mar-eh-head {
  align-items: flex-start;
}
.mar-eh.is-on-tabs .mar-eh-actions {
  align-self: center;
}
.mar-eh-cover {
  display: inline-flex;
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: var(--radius-card, 14px);
  box-shadow: 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mar-eh-cover > * {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .mar-eh-title {
  overflow: hidden;
  margin: 0;
  color: var(--color-base-foreground);
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mar-eh-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  color: var(--color-muted-foreground);
  font-size: 13px;
  white-space: nowrap;
  /* Clips at the edge instead of running under the actions; the inset
     keeps the links' hover fill whole. */
  overflow: hidden;
  margin-inline: -4px;
  padding-inline: 4px;
}
/* Between meta items: a small dot. */
.mar-eh-dot {
  width: 3px;
  height: 3px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--color-subtle-foreground);
}
/* A meta item you can click: text until hovered. */
:root .proto-ui.proto-ui.proto-ui .mar-eh-link {
  display: inline-flex;
  height: 26px;
  align-items: center;
  gap: 8px;
  margin: 0 -4px;
  padding: 0 6px;
  border-radius: var(--radius-control);
  color: inherit;
}
:root .proto-ui.proto-ui.proto-ui .mar-eh-link:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
}
.mar-eh-faces {
  display: flex;
  padding-left: 6px;
}
.mar-eh-faces > * {
  margin-left: -6px;
  box-shadow: 0 0 0 2px var(--color-content-background);
}
.mar-eh-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}
/* Corners radius on every control here, whatever the shell says. */
:root
  .proto-ui.proto-ui.proto-ui
  .mar-eh-actions
  :is(button, .mar-kebab):not(.mar-split-main, .mar-split-more) {
  border-radius: var(--radius-control);
}
/* Under the header: one row of section tabs (MarSeg), left; a page may
   dock its filters on the right of the same row. */
.mar-eh-row {
  display: flex;
  min-height: 34px;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}
</style>
