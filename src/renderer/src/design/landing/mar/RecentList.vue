<script setup lang="ts">
import { Cloud, Monitor } from 'lucide-vue-next'
import WorkflowCover from './brand/WorkflowCover.vue'
import { recentThumb } from './recentThumb'

export interface RecentListRow {
  id: string
  name: string
  build: string
  edited: string
  src?: string
}

const { rows, active } = defineProps<{ rows: RecentListRow[]; active?: string }>()
const emit = defineEmits<{ open: [row: RecentListRow]; hover: [id: string] }>()
</script>

<template>
  <ul class="v15-list">
    <li v-for="r in rows" :key="r.id">
      <button
        type="button"
        class="v15-item"
        :class="active === r.id && 'is-at'"
        @pointerenter="emit('hover', r.id)"
        @focus="emit('hover', r.id)"
        @click="emit('open', r)"
      >
        <span class="v15-thumb">
          <img v-if="r.src && recentThumb.id === 'image'" :src="r.src" alt="" loading="lazy" />
          <WorkflowCover v-else :name="r.name" />
        </span>
        <span class="v15-file">{{ r.name }}</span>
        <span class="v15-build"
          ><template v-if="recentThumb.id === 'runsOn'"
            ><Cloud
              v-if="/cloud/i.test(r.build)"
              :size="13"
              class="v15-runs"
              aria-hidden="true" /><Monitor
              v-else
              :size="13"
              class="v15-runs"
              aria-hidden="true" /></template
          >{{ r.build }}</span
        >
        <span class="v15-when">{{ r.edited }}</span>
      </button>
    </li>
  </ul>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v15-list {
  display: flex;
  flex-direction: column;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
:root .proto-ui.proto-ui.proto-ui .v15-item {
  display: grid;
  width: 100%;
  height: 44px;
  grid-template-columns: 40px minmax(0, 1fr) minmax(0, 180px) 120px;
  align-items: center;
  gap: 14px;
  padding: 0 10px 0 6px;
  border-radius: var(--radius-control);
  text-align: left;
  transition: background-color 120ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v15-item.is-at {
  background: color-mix(in oklch, var(--color-secondary-background) 80%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .v15-thumb {
  position: relative;
  display: block;
  width: 40px;
  height: 30px;
  overflow: hidden;
  border-radius: 6px;
  background: var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v15-runs {
  display: inline-block;
  flex: none;
  margin-right: 6px;
  vertical-align: -2px;
}
:root .proto-ui.proto-ui.proto-ui .v15-thumb > img,
:root .proto-ui.proto-ui.proto-ui .v15-thumb > .wfc {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v15-file,
:root .proto-ui.proto-ui.proto-ui .v15-build {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v15-file {
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .v15-build,
:root .proto-ui.proto-ui.proto-ui .v15-when {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v15-when {
  text-align: right;
  white-space: nowrap;
}
@media (max-width: 1180px) {
  :root .proto-ui.proto-ui.proto-ui .v15-item {
    grid-template-columns: 40px minmax(0, 1fr) minmax(0, 160px) 100px;
  }
}
</style>
