<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ArrowUp, Check, X } from 'lucide-vue-next'
import { AgentChat } from '../../icons/agentChat'
import { startBlank } from '../createScreen'
import type { Starter } from '../createStarters'
import type { CreateAgent } from './createAgent'

const { flow } = defineProps<{ flow: CreateAgent }>()
const emit = defineEmits<{ close: []; use: [starter: Starter] }>()
const { talk, build, built, steps, followUp, refine, questionOf, choiceOf, resultLine } = flow
const panelField = ref<HTMLInputElement>()
const scroller = ref<HTMLElement>()

watch(
  () => flow.scrollAsk.value,
  () =>
    nextTick(() =>
      scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' })
    )
)
</script>

<template>
  <aside class="ca-agent" aria-label="Agent">
    <header class="ca-agent-head">
      <AgentChat :size="15" />
      <span>Agent</span>
      <button type="button" class="ca-icon-btn" aria-label="Close agent" @click="emit('close')">
        <X :size="14" />
      </button>
    </header>
    <div ref="scroller" class="ca-agent-log" aria-live="polite">
      <template v-for="(e, i) in talk" :key="e.id">
        <p class="ca-msg-user">{{ e.prompt }}</p>
        <div class="ca-msg">
          <span class="ca-msg-avatar"><AgentChat :size="13" /></span>
          <div class="ca-msg-body">
            <p>{{ e.reply.slice(0, e.typed) }}</p>
            <template v-if="i === talk.length - 1 && build && e.rec">
              <ol class="ca-steps">
                <li
                  v-for="(label, k) in steps"
                  :key="label"
                  :class="k < build.shown ? 'is-done' : k === build.shown ? 'is-active' : ''"
                >
                  <Check v-if="k < build.shown" :size="12" />
                  <i v-else class="ca-step-dot" />
                  {{ label }}
                </li>
              </ol>
              <div v-if="built" class="ca-result">
                <p class="ca-result-line">{{ resultLine(e) }}</p>
                <div class="ca-acts">
                  <button type="button" class="ca-act is-primary" @click="emit('use', e.rec)">
                    Use this workflow
                  </button>
                  <button type="button" class="ca-act" @click="panelField?.focus()">
                    Change something
                  </button>
                </div>
                <div class="ca-choice">
                  <span>{{ questionOf(e).label }}</span>
                  <button
                    v-for="o in questionOf(e).options"
                    :key="o"
                    type="button"
                    :class="choiceOf(e) === o && 'is-on'"
                    :aria-pressed="choiceOf(e) === o"
                    @click="e.choice = o"
                  >
                    {{ o }}
                  </button>
                </div>
              </div>
            </template>
            <button
              v-else-if="!e.rec && e.typed >= e.reply.length"
              type="button"
              class="ca-act"
              @click="startBlank"
            >
              Start blank
            </button>
          </div>
        </div>
      </template>
    </div>
    <form class="ca-agent-foot" @submit.prevent="refine()">
      <input
        ref="panelField"
        v-model="followUp"
        type="text"
        placeholder="Ask for a change…"
        aria-label="Ask the agent for a change"
      />
      <button type="submit" class="ca-agent-send" aria-label="Send" :disabled="!followUp.trim()">
        <ArrowUp :size="14" />
      </button>
    </form>
  </aside>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .ca-icon-btn {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .ca-icon-btn:hover {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
@keyframes ca-fade {
  from {
    opacity: 0;
  }
}
:root .proto-ui.proto-ui.proto-ui .ca-agent {
  display: flex;
  width: 380px;
  flex: none;
  flex-direction: column;
  border-left: 1px solid var(--color-border-default);
  background: color-mix(
    in oklch,
    var(--color-base-foreground) 2.5%,
    var(--color-content-background)
  );
  animation: ca-panel 280ms var(--ease-out-expo) both;
}
:root .proto-ui.proto-ui.proto-ui .ca-agent-head {
  display: flex;
  height: 52px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 18px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .ca-agent-head > span {
  flex: 1;
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .ca-agent-log {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding: 8px 18px 18px;
  scrollbar-width: thin;
}
:root .proto-ui.proto-ui.proto-ui .ca-msg-user {
  align-self: flex-end;
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 14px 14px 4px 14px;
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  line-height: 19px;
}
:root .proto-ui.proto-ui.proto-ui .ca-msg {
  display: flex;
  gap: 10px;
}
:root .proto-ui.proto-ui.proto-ui .ca-msg-avatar {
  display: grid;
  width: 26px;
  height: 26px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .ca-msg-body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding-top: 3px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  line-height: 20px;
}
:root .proto-ui.proto-ui.proto-ui .ca-steps {
  display: flex;
  align-self: stretch;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-card);
  background: var(--color-secondary-background);
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .ca-steps li {
  display: flex;
  align-items: center;
  gap: 8px;
}
:root .proto-ui.proto-ui.proto-ui .ca-steps li.is-done {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .ca-steps li.is-done svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .ca-steps li.is-active {
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .ca-step-dot {
  width: 12px;
  height: 12px;
  flex: none;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1.5px currentColor;
  opacity: 0.6;
}
:root .proto-ui.proto-ui.proto-ui .ca-steps li.is-active .ca-step-dot {
  animation: ca-blink 1s ease-in-out infinite;
}
:root .proto-ui.proto-ui.proto-ui .ca-result {
  display: flex;
  align-self: stretch;
  flex-direction: column;
  gap: 12px;
  animation: ca-fade 300ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .ca-result-line {
  color: var(--color-base-foreground);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .ca-choice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .ca-choice > span {
  margin-right: 4px;
}
:root .proto-ui.proto-ui.proto-ui .ca-choice button {
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .ca-choice button.is-on {
  background: var(--color-secondary-background-hover);
  box-shadow: inset 0 0 0 1px var(--color-border-strong);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .ca-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
:root .proto-ui.proto-ui.proto-ui .ca-act {
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .ca-act:hover {
  background: var(--color-secondary-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .ca-act.is-primary {
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .ca-act.is-primary:hover {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .ca-agent-foot {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  margin: 0 14px 16px;
  padding: 0 6px 0 14px;
  height: 44px;
  border-radius: 999px;
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .ca-agent-foot:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .ca-agent-foot input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-base-foreground);
  font: inherit;
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .ca-agent-foot input::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .ca-agent-send {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .ca-agent-send:disabled {
  opacity: 0.3;
}
@keyframes ca-panel {
  from {
    opacity: 0;
    transform: translateX(16px);
  }
}
@keyframes ca-blink {
  50% {
    opacity: 0.2;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .ca-agent,
  :root .proto-ui.proto-ui.proto-ui .ca-result,
  :root .proto-ui.proto-ui.proto-ui .ca-steps li.is-active .ca-step-dot {
    animation: none;
  }
}
</style>
