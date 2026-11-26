<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ProjectWorkflow } from '../../gallery'
import { hostActions } from '../../useProto'
import { openAppPage } from '../../appFlow'
import { openTemplate } from './createScreen'
import type { CreateInput } from './createInput'
import { needsSignIn, useSmartSearch, type SmartOption } from './smartSearch'
import { answer, type AgentAnswer } from './looks/v07Agent'
import CreateComposer from './looks/CreateComposer.vue'
import SmartResults from './looks/SmartResults.vue'

const SMART_PLACEHOLDER = 'Describe what you want to make, or search templates and apps'

const {
  listId,
  smart = true,
  suspended = false,
  mode = 'agent',
  placeholder,
  navigated = false
} = defineProps<{
  listId: string
  smart?: boolean
  suspended?: boolean
  mode?: CreateInput
  placeholder?: string
  navigated?: boolean
}>()
const query = defineModel<string>({ required: true })
const emit = defineEmits<{
  key: [e: KeyboardEvent]
  ask: [reply: AgentAnswer]
  workflow: [workflow: ProjectWorkflow]
}>()

const composer = ref<InstanceType<typeof CreateComposer>>()
const finder = useSmartSearch(query)
const found = ref<InstanceType<typeof SmartResults>>()

const shown = computed(() => smart && finder.shown.value && !suspended)
const activeOption = computed(() =>
  shown.value && finder.active.value ? `${listId}-${finder.activeIndex.value}` : undefined
)

function act(option: SmartOption | null): void {
  const text = query.value.trim()
  if (!text) return
  if (option?.kind === 'template' && needsSignIn(option.card)) return hostActions.signIn()
  finder.close()
  if (!option || option.kind === 'agent') return emit('ask', answer(text))
  if (option.kind === 'template') return openTemplate(option.card.starter.template)
  const { workflow, app } = option.found
  if (workflow) emit('workflow', workflow)
  else if (app) openAppPage(app.id)
}

function smartEnter(): void {
  if (!query.value.trim()) return
  finder.flush()
  act(finder.active.value)
}

function moveVertically(step: 1 | -1): void {
  if (!shown.value) {
    finder.open()
    finder.moveTo(finder.activeIndex.value)
  } else {
    const target = found.value?.verticalTarget(step) ?? null
    if (target === null || target === finder.activeIndex.value) finder.move(step)
    else finder.moveTo(target)
  }
  found.value?.revealActive()
}

function smartKey(e: KeyboardEvent): boolean {
  if (e.isComposing) return false
  const across = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
  if (e.key === 'Escape' && shown.value) finder.close()
  else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && query.value.trim())
    moveVertically(e.key === 'ArrowDown' ? 1 : -1)
  else if (across && shown.value && finder.inResults.value) {
    finder.move(e.key === 'ArrowRight' ? 1 : -1)
    found.value?.revealActive()
  } else if (e.key === 'Enter' && query.value.trim()) {
    if (!e.repeat) smartEnter()
  } else return false
  e.preventDefault()
  return true
}

function key(e: KeyboardEvent): void {
  if (smart && smartKey(e)) return
  emit('key', e)
}

const field = computed(() => composer.value?.field)

defineExpose({ shown, field })
</script>

<template>
  <div class="v15-ask">
    <CreateComposer
      ref="composer"
      v-model="query"
      class="v15-composer"
      :mode="smart ? 'agent' : mode"
      :navigated
      :placeholder="smart ? SMART_PLACEHOLDER : placeholder"
      :enter-label="smart ? finder.enterLabel.value : ''"
      :combo="smart ? { open: shown, list: listId, active: activeOption } : undefined"
      hero
      send
      external
      @key="key"
      @ask="emit('ask', $event)"
      @enter="smartEnter"
      @focusin="smart && finder.open()"
    />
    <slot name="drop" />
  </div>

  <SmartResults
    v-if="shown && finder.answer.value"
    ref="found"
    :answer="finder.answer.value"
    :options="finder.options.value"
    :active="finder.activeIndex.value"
    :list-id="listId"
    @hover="finder.activeIndex.value = $event"
    @pick="act"
  />
  <slot v-else />
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v15-ask {
  position: relative;
  z-index: 3;
  width: min(640px, 100%);
  margin-top: 36px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v15-starts {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 48px;
  margin-top: 32px;
  text-align: left;
  transition: opacity 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-row {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
  margin-top: 14px;
  animation: v15-fade 200ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .v15-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .v15-pic {
  position: relative;
  display: block;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  transition:
    transform 260ms var(--ease-out-expo),
    box-shadow 200ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-pic > img,
:root .proto-ui.proto-ui.proto-ui .v15-pic > video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v15-pic > video {
  opacity: 0;
  transition: opacity 240ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-card.is-at .v15-pic > video {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v15-card.is-at .v15-pic {
  transform: translateY(-3px);
  box-shadow: var(--shadow-elev-hover);
}
:root .proto-ui.proto-ui.proto-ui .v15-blank .v15-pic {
  display: grid;
  place-items: center;
  border: 1px dashed color-mix(in oklch, var(--color-base-foreground) 18%, transparent);
  background: transparent;
  box-shadow: none;
  transition:
    transform 260ms var(--ease-out-expo),
    box-shadow 200ms ease,
    border-color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-plus {
  color: var(--color-muted-foreground);
  transition: color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-blank.is-at .v15-pic {
  border-color: color-mix(in oklch, var(--color-base-foreground) 34%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .v15-blank.is-at .v15-plus {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v15-card:focus-visible .v15-pic {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .v15-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: 0 2px;
}
:root .proto-ui.proto-ui.proto-ui .v15-name,
:root .proto-ui.proto-ui.proto-ui .v15-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .v15-name {
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  transition: color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v15-card.is-at .v15-name {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v15-meta {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
@keyframes v15-fade {
  from {
    opacity: 0;
  }
}
@media (max-width: 1180px) {
  :root .proto-ui.proto-ui.proto-ui .v15-row {
    gap: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v15-row,
  :root .proto-ui.proto-ui.proto-ui .v15-pic {
    animation: none;
    transition: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v15-card.is-at .v15-pic {
    transform: none;
  }
}
</style>
