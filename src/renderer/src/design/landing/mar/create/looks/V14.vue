<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { activeInstance } from '../../../useProto'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import { readiness, SHELVES } from '../createStarters'
import CSearch from './CSearch.vue'
import { recentWorkflows, useCreateKeys } from './cLooks'

const query = ref('')
const field = ref<HTMLInputElement>()
const results = ref<InstanceType<typeof CSearch>>()
const at = ref(-1)
useCreateKeys(field)

const ideas = computed(() => SHELVES[0]!.starters().slice(0, 6))
const recents = computed(() => recentWorkflows(3))
watch(query, () => (at.value = -1))

function onKey(e: KeyboardEvent): void {
  if (results.value?.onKey(e)) return
  const last = ideas.value.length - 1
  if (e.key === 'ArrowDown') at.value = Math.min(last, at.value + 1)
  else if (e.key === 'ArrowUp') at.value = Math.max(-1, at.value - 1)
  else if (e.key === 'Enter' && at.value >= 0) openTemplate(ideas.value[at.value]!.template)
  else if (e.key === 'Escape') closeCreate()
  else return
  e.preventDefault()
}
</script>

<template>
  <section class="v14 relative min-h-full px-6 pb-24" aria-label="Create">
    <button type="button" class="v14-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <div class="v14-col">
      <h1 class="sr-only">Create a workflow</h1>
      <label class="v14-field">
        <input
          ref="field"
          v-model="query"
          type="text"
          placeholder="What do you want to make?"
          aria-label="Search workflows, templates and nodes"
          @keydown="onKey"
        />
        <span class="v14-line" aria-hidden="true" />
      </label>

      <CSearch v-if="query.trim()" ref="results" :query plain class="mt-8" @clear="query = ''" />

      <template v-else>
        <ul class="v14-ideas" aria-label="Suggestions">
          <li v-for="(s, i) in ideas" :key="s.id">
            <button
              type="button"
              class="v14-idea"
              :class="at === i && 'is-at'"
              @pointermove="at = i"
              @pointerleave="at = -1"
              @click="openTemplate(s.template)"
            >
              <img :src="s.poster" alt="" class="v14-thumb" />
              <span class="v14-idea-title">{{ s.makes }}</span>
              <span class="v14-idea-meta">
                <span class="v14-idea-model">{{ s.model }}</span>
                <span class="v14-idea-ready">{{ readiness(s.template).label }}</span>
              </span>
            </button>
          </li>
        </ul>

        <p class="v14-quiet">
          <button
            type="button"
            :title="`Empty canvas on ${activeInstance.name}`"
            @click="startBlank"
          >
            Start with a blank canvas
          </button>
        </p>
        <p v-if="recents.length" class="v14-quiet mt-2">
          Or continue
          <template v-for="(w, i) in recents" :key="w.id">
            <button type="button" @click="openWorkflow(w)">{{ w.name }}</button>{{
              i < recents.length - 1 ? ', ' : ''
            }}
          </template>
        </p>
      </template>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v14 {
  isolation: isolate;
}
:root .proto-ui.proto-ui.proto-ui .v14-close {
  position: absolute;
  top: 16px;
  right: 16px;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: var(--radius-control);
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v14-close:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v14-col {
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding-top: clamp(80px, 22vh, 220px);
}
:root .proto-ui.proto-ui.proto-ui .v14-field {
  position: relative;
  display: block;
  padding-bottom: 14px;
}
:root .proto-ui.proto-ui.proto-ui .v14-field input {
  width: 100%;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-base-foreground);
  font: inherit;
  font-size: 28px;
  font-weight: 400;
  letter-spacing: -0.015em;
  text-align: center;
}
:root .proto-ui.proto-ui.proto-ui label.v14-field > input::placeholder {
  font-size: 28px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v14-field::before,
:root .proto-ui.proto-ui.proto-ui .v14-line {
  content: '';
  position: absolute;
  inset: auto 0 0;
  height: 1px;
  background: var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v14-line {
  background: var(--color-base-foreground);
  transform: scaleX(0);
  transition: transform 700ms var(--mar-ease, cubic-bezier(0.16, 1, 0.3, 1));
}
:root .proto-ui.proto-ui.proto-ui .v14-field:focus-within .v14-line {
  transform: scaleX(1);
}
:root .proto-ui.proto-ui.proto-ui .v14-ideas {
  margin-top: 40px;
}
:root .proto-ui.proto-ui.proto-ui .v14-idea {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 14px;
  padding: 9px 4px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v14-thumb {
  width: 20px;
  height: 20px;
  flex: none;
  border-radius: 5px;
  object-fit: cover;
  opacity: 0.85;
}
:root .proto-ui.proto-ui.proto-ui .v14-idea-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--color-muted-foreground);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v14-idea.is-at .v14-idea-title,
:root .proto-ui.proto-ui.proto-ui .v14-idea:focus-visible .v14-idea-title {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v14-idea:focus-visible .v14-thumb {
  box-shadow: 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v14-idea-meta {
  position: relative;
  flex: none;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-align: right;
}
:root .proto-ui.proto-ui.proto-ui .v14-idea-ready {
  position: absolute;
  right: 0;
  white-space: nowrap;
  visibility: hidden;
}
:root .proto-ui.proto-ui.proto-ui .v14-idea.is-at .v14-idea-model,
:root .proto-ui.proto-ui.proto-ui .v14-idea:focus-visible .v14-idea-model {
  visibility: hidden;
}
:root .proto-ui.proto-ui.proto-ui .v14-idea.is-at .v14-idea-ready,
:root .proto-ui.proto-ui.proto-ui .v14-idea:focus-visible .v14-idea-ready {
  visibility: visible;
}
:root .proto-ui.proto-ui.proto-ui .v14-quiet {
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
  text-align: center;
}
:root .proto-ui.proto-ui.proto-ui .v14-quiet:first-of-type {
  margin-top: 40px;
}
:root .proto-ui.proto-ui.proto-ui .v14-quiet button {
  color: var(--color-muted-foreground);
  text-decoration: underline;
  text-decoration-color: var(--color-border-default);
  text-underline-offset: 4px;
}
:root .proto-ui.proto-ui.proto-ui .v14-quiet button:hover,
:root .proto-ui.proto-ui.proto-ui .v14-quiet button:focus-visible {
  color: var(--color-base-foreground);
  text-decoration-color: currentColor;
  outline: none;
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v14-line {
    transition: none;
  }
}
</style>
