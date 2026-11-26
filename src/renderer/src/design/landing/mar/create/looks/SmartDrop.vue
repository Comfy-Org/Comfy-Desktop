<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { CornerDownLeft, History, Search } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import { AgentChat } from '../../icons/agentChat'
import { segments } from '../../search/match'
import type { Results, Row } from '../smartDrop'

const { results, active, query, listId } = defineProps<{
  results: Results
  active: number
  query: string
  listId: string
}>()
const emit = defineEmits<{ pick: [row: Row]; hover: [index: number] }>()

const list = ref<HTMLElement>()
const optionId = (i: number): string => `${listId}-opt-${i}`
const headId = (name: string): string => `${listId}-${name.toLowerCase().replace(/\W+/g, '-')}`

let last = { x: -1, y: -1 }
function onPointer(e: PointerEvent, i: number): void {
  if (e.clientX === last.x && e.clientY === last.y) return
  last = { x: e.clientX, y: e.clientY }
  emit('hover', i)
}

watch(
  () => active,
  (i) =>
    nextTick(() =>
      list.value?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' })
    )
)

defineExpose({ optionId })
</script>

<template>
  <div
    :id="listId"
    ref="list"
    class="sd"
    role="listbox"
    :aria-label="query ? 'Results' : 'Suggestions'"
    @mousedown.prevent
  >
    <div
      v-for="g in results.groups"
      :key="g.name || 'agent'"
      class="sd-group"
      role="group"
      :aria-labelledby="g.name ? headId(g.name) : undefined"
      :aria-label="g.name ? undefined : 'Agent'"
    >
      <div v-if="g.name" :id="headId(g.name)" class="sd-head" role="presentation">
        {{ g.name }}
      </div>
      <div
        v-for="row in g.rows"
        :id="optionId(row.index)"
        :key="row.id"
        role="option"
        :aria-selected="active === row.index"
        :data-i="row.index"
        class="sd-row"
        :class="[`is-${row.kind}`, active === row.index && 'is-on']"
        @pointermove="onPointer($event, row.index)"
        @click="emit('pick', row)"
      >
        <template v-if="row.kind === 'agent'">
          <span class="sd-lead is-agent"><AgentChat :size="15" /></span>
          <span class="sd-text">
            <span class="sd-name">Ask the agent: “{{ query }}”</span>
            <span class="sd-sub">It builds a workflow for this on the canvas</span>
          </span>
        </template>
        <template v-else-if="row.kind === 'suggest'">
          <span class="sd-lead is-icon">
            <History v-if="row.recent" :size="14" />
            <Search v-else :size="14" />
          </span>
          <span class="sd-text">
            <span class="sd-name is-plain">{{ row.text }}</span>
          </span>
        </template>
        <template v-else>
          <span class="sd-lead">
            <img v-if="row.image" :src="row.image" alt="" loading="lazy" />
            <WorkflowCover v-else-if="row.kind === 'workflow'" :name="row.workflow.name" />
          </span>
          <span class="sd-text">
            <span class="sd-name"
              ><template v-for="(s, k) in segments(row.name, row.at)" :key="k"
                ><mark v-if="s.hit">{{ s.text }}</mark
                ><template v-else>{{ s.text }}</template></template
              ></span
            >
            <span class="sd-sub">{{ row.sub }}</span>
          </span>
          <span class="sd-meta" :class="`is-${row.tone}`">{{ row.meta }}</span>
        </template>
        <kbd class="sd-enter" :class="active === row.index && 'is-on'" aria-hidden="true">
          <CornerDownLeft :size="12" />
        </kbd>
      </div>
    </div>
    <p v-if="query && !results.found" class="sd-none">
      Nothing in templates, apps or your workflows matches “{{ query }}”. The agent can build it
      from scratch, or try a plainer word like “video” or “upscale”.
    </p>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .sd {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
:root .proto-ui.proto-ui.proto-ui .sd-group + .sd-group {
  margin-top: 6px;
}
:root .proto-ui.proto-ui.proto-ui .sd-head {
  padding: 8px 10px 4px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .sd-row {
  display: flex;
  min-height: 48px;
  align-items: center;
  gap: 12px;
  padding: 6px 10px 6px 6px;
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .sd-row.is-suggest {
  min-height: 36px;
}
:root .proto-ui.proto-ui.proto-ui .sd-row.is-on {
  background: var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .sd-lead {
  position: relative;
  display: grid;
  width: 52px;
  height: 36px;
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: 7px;
  background: var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .sd-lead > img,
:root .proto-ui.proto-ui.proto-ui .sd-lead > .wfc {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .sd-lead.is-agent {
  background: var(--color-inverted-background);
  box-shadow: none;
  color: var(--color-inverted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .sd-lead.is-icon {
  width: 24px;
  height: 24px;
  margin: 0 14px 0 14px;
  background: transparent;
  box-shadow: none;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .sd-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}
:root .proto-ui.proto-ui.proto-ui .sd-name,
:root .proto-ui.proto-ui.proto-ui .sd-sub,
:root .proto-ui.proto-ui.proto-ui .sd-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .sd-name {
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .sd-name.is-plain {
  color: var(--color-muted-foreground);
  font-weight: 400;
}
:root .proto-ui.proto-ui.proto-ui .sd-row.is-on .sd-name.is-plain {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .sd-name mark {
  background: none;
  color: inherit;
  font-weight: 650;
}
:root .proto-ui.proto-ui.proto-ui .sd-sub {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .sd-meta {
  display: inline-flex;
  max-width: 180px;
  flex: none;
  align-items: center;
  gap: 6px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .sd-meta::before {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 999px;
  background: currentColor;
  content: '';
  opacity: 0.6;
}
:root .proto-ui.proto-ui.proto-ui .sd-meta.is-ready {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .sd-meta.is-ready::before {
  background: var(--color-status-running);
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .sd-row.is-workflow .sd-meta::before {
  display: none;
}
:root .proto-ui.proto-ui.proto-ui .sd-row.is-workflow .sd-meta {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .sd-enter {
  display: grid;
  width: 22px;
  height: 22px;
  flex: none;
  place-items: center;
  border-radius: 6px;
  background: var(--color-content-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  color: var(--color-subtle-foreground);
  font: inherit;
  visibility: hidden;
}
:root .proto-ui.proto-ui.proto-ui .sd-enter.is-on {
  visibility: visible;
}
:root .proto-ui.proto-ui.proto-ui .sd-none {
  padding: 8px 12px 6px 70px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  line-height: 18px;
}
</style>
