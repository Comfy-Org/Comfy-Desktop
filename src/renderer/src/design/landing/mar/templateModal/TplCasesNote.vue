<script setup lang="ts">
import { openDetail, proto } from '../../useProto'
import { CANT_RUN_CASES, tplById } from './templateData'

const rows = CANT_RUN_CASES.map((c) => ({ ...c, name: tplById(c.template)?.title ?? c.template }))
</script>

<template>
  <ul class="tpl-cases" aria-label="Can't-run cases">
    <li v-for="c in rows" :key="c.id">
      <span class="tpl-cases-case">{{ c.label }} →</span>
      <button
        type="button"
        class="tpl-cases-link"
        :aria-current="proto.detail?.kind === 'template' && proto.detail.id === c.template"
        :title="c.name"
        @click="openDetail('template', c.template)"
      >
        {{ c.name }}
      </button>
    </li>
  </ul>
</template>

<style scoped>
.tpl-cases {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  line-height: 16px;
}
.tpl-cases li {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.tpl-cases-case {
  color: var(--color-subtle-foreground);
}
.tpl-cases-link {
  overflow: hidden;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-base-foreground);
  font: inherit;
  text-align: left;
  text-decoration: underline;
  text-decoration-color: color-mix(in oklch, currentColor 35%, transparent);
  text-underline-offset: 2px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.tpl-cases-link:hover,
.tpl-cases-link[aria-current='true'] {
  text-decoration-color: currentColor;
}
.tpl-cases-link:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 1px;
  border-radius: 2px;
}
</style>
