<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowUp, Search, X } from 'lucide-vue-next'
import { AgentChat } from '../../icons/agentChat'
import { openTemplate, startBlank } from '../createScreen'
import type { Starter } from '../createStarters'
import type { CreateInput } from '../createInput'
import { AGENT_CHIPS, answer, type AgentAnswer } from './v07Agent'

const {
  mode,
  cardAt = 'below',
  navigated = false,
  external = false,
  hero = false,
  send = false,
  placeholder
} = defineProps<{
  mode: CreateInput
  cardAt?: 'above' | 'below'
  navigated?: boolean
  external?: boolean
  hero?: boolean
  send?: boolean
  placeholder?: string
}>()
const query = defineModel<string>({ required: true })
const emit = defineEmits<{
  key: [e: KeyboardEvent]
  peek: [starter: Starter | null]
  pin: [starter: Starter | null]
  build: [starter: Starter]
  dismiss: []
  ask: [reply: AgentAnswer]
}>()

const field = ref<HTMLInputElement>()
const focused = ref(false)
const reply = ref<AgentAnswer | null>(null)
const pinId = ref<string | null>(null)
const agent = computed(() => mode === 'agent')
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

function ask(text = query.value): void {
  if (!agent.value || !text.trim()) return
  query.value = text
  if (external) {
    emit('ask', answer(text))
    return
  }
  reply.value = answer(text)
  pinId.value = null
  emit('peek', null)
  emit('pin', null)
  field.value?.focus()
}

function dismiss(): void {
  reply.value = null
  pinId.value = null
  emit('peek', null)
  emit('pin', null)
  emit('dismiss')
  field.value?.focus()
}

function build(): void {
  const picks = reply.value?.picks ?? []
  const starter = picks.find((s) => s.id === pinId.value) ?? picks[0]
  if (starter) emit('build', starter)
}

function key(e: KeyboardEvent): void {
  if (e.key === 'Escape' && reply.value) {
    e.preventDefault()
    dismiss()
    return
  }
  if (e.key === 'Enter' && agent.value && query.value.trim() && !navigated) {
    e.preventDefault()
    ask()
    return
  }
  emit('key', e)
}

function focusShortcut(e: KeyboardEvent): void {
  if (e.key !== '/' || !(e.metaKey || e.ctrlKey)) return
  e.preventDefault()
  field.value?.focus()
}
onMounted(() => window.addEventListener('keydown', focusShortcut))
onBeforeUnmount(() => window.removeEventListener('keydown', focusShortcut))

function focus(): void {
  field.value?.focus()
  field.value?.select()
}

defineExpose({ focus, dismiss, field })
</script>

<template>
  <div class="cc" :class="[`is-${mode}`, `card-${cardAt}`, hero && 'is-hero']">
    <div class="cc-field" @click="field?.focus()">
      <AgentChat v-if="agent" :size="15" class="shrink-0 text-muted-foreground" />
      <Search v-else :size="15" class="shrink-0 text-subtle-foreground" />
      <input
        ref="field"
        v-model="query"
        type="text"
        :placeholder="
          placeholder ??
          (agent ? 'Describe what you want to make…' : 'Search templates, workflows and nodes')
        "
        :aria-label="
          agent ? 'Describe what you want to make' : 'Search templates, workflows and nodes'
        "
        @keydown="key"
        @focus="focused = true"
        @blur="focused = false"
      />
      <button
        v-if="query && agent && external && !send"
        type="button"
        class="cc-ask"
        aria-label="Ask"
        @click.stop="ask()"
      >
        <kbd>↵</kbd>Ask
      </button>
      <button
        v-else-if="query && agent"
        type="button"
        class="cc-send"
        aria-label="Ask"
        @click.stop="ask()"
      >
        <ArrowUp :size="14" />
      </button>
      <button
        v-else-if="query"
        type="button"
        class="cc-clear"
        aria-label="Clear"
        @click.stop="((query = ''), field?.focus())"
      >
        <X :size="13" />
      </button>
      <kbd v-else-if="!focused" class="cc-kbd">{{ MOD }} /</kbd>
    </div>

    <div v-if="agent && reply" class="cc-pop cc-reply" aria-live="polite">
      <div class="cc-reply-head">
        <span class="cc-avatar"><AgentChat :size="13" /></span>
        <p class="cc-reply-line">
          {{ reply.understood || `Nothing I know matches “${reply.prompt}” yet.` }}
        </p>
        <button type="button" class="cc-clear" aria-label="Dismiss" @click="dismiss">
          <X :size="13" />
        </button>
      </div>
      <div v-if="reply.picks.length" class="cc-picks">
        <button
          v-for="s in reply.picks"
          :key="s.id"
          type="button"
          class="cc-pick"
          :class="pinId === s.id && 'is-on'"
          :aria-pressed="pinId === s.id"
          @pointerenter="emit('peek', s)"
          @pointerleave="emit('peek', null)"
          @focus="emit('peek', s)"
          @blur="emit('peek', null)"
          @click="openTemplate(s.template)"
        >
          <img :src="s.poster" alt="" />
          <span class="flex min-w-0 flex-col">
            <span class="cc-pick-name">{{ s.makes }}</span>
            <span class="cc-pick-model">{{ s.model }}</span>
          </span>
        </button>
      </div>
      <div class="cc-acts">
        <button v-if="reply.picks.length" type="button" class="cc-build" @click="build">
          Build it for me
        </button>
        <button type="button" class="cc-link" @click="startBlank">Or start blank</button>
      </div>
    </div>
    <div
      v-else-if="agent && !external && focused && !query"
      class="cc-pop cc-chips"
      aria-label="Try"
    >
      <span class="cc-chips-label">Try</span>
      <button
        v-for="c in AGENT_CHIPS"
        :key="c"
        type="button"
        class="cc-chip"
        @mousedown.prevent
        @click="ask(c)"
      >
        {{ c }}
      </button>
    </div>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .cc {
  position: relative;
  min-width: 0;
}
:root .proto-ui.proto-ui.proto-ui .cc-field {
  display: flex;
  height: 40px;
  align-items: center;
  gap: 10px;
  padding: 0 6px 0 14px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  cursor: text;
  transition:
    background-color 140ms ease,
    box-shadow 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .cc-field:hover,
:root .proto-ui.proto-ui.proto-ui .cc-field:focus-within {
  background: var(--color-secondary-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .cc.is-agent .cc-field {
  height: 44px;
  background: color-mix(in oklch, var(--color-card-background) 80%, transparent);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  backdrop-filter: blur(var(--blur-glass));
}
:root .proto-ui.proto-ui.proto-ui .cc.is-agent .cc-field:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .cc-field input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-base-foreground);
  font: inherit;
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .cc.is-hero .cc-field {
  height: 52px;
  gap: 12px;
  padding: 0 8px 0 18px;
  background: color-mix(in oklch, var(--color-card-background) 86%, transparent);
  box-shadow:
    inset 0 0 0 1px var(--color-border-default),
    var(--shadow-popover);
  backdrop-filter: blur(var(--blur-glass));
}
:root .proto-ui.proto-ui.proto-ui .cc.is-hero .cc-field:focus-within {
  box-shadow:
    inset 0 0 0 1px var(--color-border-focus),
    var(--shadow-popover);
}
:root .proto-ui.proto-ui.proto-ui .cc.is-hero .cc-field input {
  font-size: 15px;
}
:root .proto-ui.proto-ui.proto-ui .cc-field input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .cc-send {
  display: grid;
  width: 30px;
  height: 30px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .cc-ask {
  display: inline-flex;
  height: 30px;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: 999px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .cc-ask:hover {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .cc-ask kbd {
  font: inherit;
}
:root .proto-ui.proto-ui.proto-ui .cc-clear {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .cc-clear:hover {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .cc-kbd {
  flex: none;
  margin-right: 6px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--color-secondary-background);
  color: var(--color-subtle-foreground);
  font: inherit;
  font-size: 11px;
}
:root .proto-ui.proto-ui.proto-ui .cc-pop {
  position: absolute;
  left: 0;
  z-index: 6;
  width: max(100%, min(720px, 80vw));
}
:root .proto-ui.proto-ui.proto-ui .cc.card-below .cc-pop {
  top: calc(100% + 10px);
}
:root .proto-ui.proto-ui.proto-ui .cc.card-above .cc-pop {
  bottom: calc(100% + var(--cc-gap, 10px));
}
:root .proto-ui.proto-ui.proto-ui .cc-reply {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border-radius: var(--radius-panel);
  background: color-mix(in oklch, var(--color-card-background) 92%, transparent);
  box-shadow:
    inset 0 0 0 1px var(--color-border-default),
    var(--shadow-popover);
  backdrop-filter: blur(var(--blur-glass));
  animation: cc-in 320ms var(--ease-out-expo) both;
}
:root .proto-ui.proto-ui.proto-ui .cc-reply-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
:root .proto-ui.proto-ui.proto-ui .cc-avatar {
  display: grid;
  width: 26px;
  height: 26px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .cc-reply-line {
  min-width: 0;
  flex: 1;
  color: var(--color-base-foreground);
  font-size: 14px;
}
:root .proto-ui.proto-ui.proto-ui .cc-picks {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
:root .proto-ui.proto-ui.proto-ui .cc-pick {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 6px 10px 6px 6px;
  border-radius: 12px;
  background: var(--color-secondary-background);
  text-align: left;
  outline: none;
  transition: background-color 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .cc-pick:hover {
  background: var(--color-secondary-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .cc-pick.is-on {
  box-shadow: inset 0 0 0 2px var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .cc-pick:focus-visible {
  box-shadow: inset 0 0 0 2px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .cc-pick img {
  width: 56px;
  height: 40px;
  flex: none;
  border-radius: 8px;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .cc-pick-name {
  overflow: hidden;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .cc-pick-model {
  overflow: hidden;
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:root .proto-ui.proto-ui.proto-ui .cc-acts {
  display: flex;
  align-items: center;
  gap: 16px;
}
:root .proto-ui.proto-ui.proto-ui .cc-build {
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: var(--text-ui);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .cc-build:hover {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .cc-link {
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .cc-link:hover {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .cc-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-radius: var(--radius-panel);
  background: color-mix(in oklch, var(--color-card-background) 94%, transparent);
  box-shadow:
    inset 0 0 0 1px var(--color-border-default),
    var(--shadow-popover);
  backdrop-filter: blur(var(--blur-glass));
  animation: cc-fade 200ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .cc-chips-label {
  padding: 0 6px 0 4px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .cc-chip {
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .cc-chip:hover {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
@keyframes cc-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
@keyframes cc-fade {
  from {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .cc-reply,
  :root .proto-ui.proto-ui.proto-ui .cc-chips {
    animation: none;
  }
}
</style>
