<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref } from 'vue'
import { ArrowUp, Check, Download, Plus, Workflow, X } from 'lucide-vue-next'
import WorkflowCover from '../../brand/WorkflowCover.vue'
import CategoryChip from '../../CategoryChip.vue'
import { allWorkflows, type ProjectWorkflow } from '../../../gallery'
import { activeInstance } from '../../../useProto'
import { closeCreate, openTemplate, openWorkflow, startBlank } from '../createScreen'
import { readiness } from '../createStarters'
import {
  costLine,
  playIn,
  PROMPTS,
  reducedMotion,
  stopIn,
  suggest,
  useCloseOnEsc,
  type Suggestion
} from './lookD'

interface Turn {
  id: number
  ask: string
  picks: Suggestion[]
  mine: ProjectWorkflow[]
  sel: number
  thinking: boolean
}

const draft = ref('')
const field = ref<HTMLTextAreaElement>()
const thread = reactive<Turn[]>([])
const timers: number[] = []
onBeforeUnmount(() => timers.forEach((t) => window.clearTimeout(t)))

const recents = computed(() => [...allWorkflows.value].sort((a, b) => a.age - b.age).slice(0, 3))
const latest = computed(() => thread.at(-1))

function intro(turn: Turn): string {
  if (!turn.picks.length) return 'I couldn’t find a template for that yet.'
  const ready = turn.picks.filter((p) => readiness(p.starter.template).tone === 'ready').length
  const n =
    turn.picks.length === 1
      ? 'One template fits'
      : `${turn.picks.length === 2 ? 'Two' : 'Three'} templates fit`
  if (ready === turn.picks.length)
    return `${n}, and they all run on ${activeInstance.value.name} right now.`
  if (ready)
    return `${n}. ${ready === 1 ? 'One is' : `${ready} are`} ready to run on ${activeInstance.value.name} now.`
  return `${n}. Each needs a one-time download first.`
}

function ask(text: string): void {
  const said = text.trim()
  if (!said) return
  const words = said
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3)
  const turn: Turn = {
    id: Date.now(),
    ask: said,
    picks: suggest(said, 3),
    mine: allWorkflows.value
      .filter((w) => words.some((word) => w.name.toLowerCase().includes(word)))
      .slice(0, 2),
    sel: 0,
    thinking: !reducedMotion()
  }
  thread.push(turn)
  draft.value = ''
  const live = thread.at(-1)!
  if (live.thinking) timers.push(window.setTimeout(() => (live.thinking = false), 650))
  nextTick(() =>
    document
      .querySelector('.v20-input')
      ?.scrollIntoView({ block: 'end', behavior: reducedMotion() ? 'auto' : 'smooth' })
  )
}

function key(e: KeyboardEvent): void {
  const turn = latest.value
  if (e.key === 'Enter' && !e.shiftKey) {
    if (draft.value.trim()) ask(draft.value)
    else if (turn?.picks[turn.sel]) openTemplate(turn.picks[turn.sel]!.starter.template)
  } else if (!draft.value && turn && e.key === 'ArrowDown')
    turn.sel = Math.min(turn.picks.length - 1, turn.sel + 1)
  else if (!draft.value && turn && e.key === 'ArrowUp') turn.sel = Math.max(0, turn.sel - 1)
  else if (e.key === 'Escape') {
    if (draft.value) draft.value = ''
    else closeCreate()
  } else return
  e.preventDefault()
}

useCloseOnEsc(field)
</script>

<template>
  <section class="v20" :class="thread.length && 'is-talking'" aria-label="Create">
    <button type="button" class="v20-close" aria-label="Close" title="Close" @click="closeCreate">
      <X :size="16" />
    </button>

    <div class="v20-col">
      <header v-if="!thread.length" class="v20-hello">
        <span class="v20-mark"><Workflow :size="20" /></span>
        <h1 class="v20-title">What do you want to make?</h1>
        <p class="v20-sub">
          Describe it in your own words. I’ll find templates that do it and tell you what each one
          needs.
        </p>
      </header>

      <ol v-else class="v20-thread" aria-live="polite">
        <li v-for="turn in thread" :key="turn.id" class="v20-turn">
          <p class="v20-me">{{ turn.ask }}</p>
          <div class="v20-bot">
            <span class="v20-mark is-small"><Workflow :size="14" /></span>
            <div class="min-w-0 flex-1">
              <p v-if="turn.thinking" class="v20-dots" aria-label="Looking"><i /><i /><i /></p>
              <template v-else>
                <p class="v20-say">{{ intro(turn) }}</p>
                <div class="v20-picks">
                  <article
                    v-for="(p, i) in turn.picks"
                    :key="p.starter.id"
                    class="v20-pick"
                    :class="turn.sel === i && 'is-open'"
                    :style="{ '--i': i }"
                    @pointerenter="((turn.sel = i), playIn($event.currentTarget))"
                    @pointerleave="stopIn($event.currentTarget)"
                    @focusin="turn.sel = i"
                  >
                    <span class="v20-pic">
                      <img :src="p.starter.poster" alt="" loading="lazy" />
                      <video
                        v-if="p.starter.clip"
                        :src="p.starter.clip"
                        :poster="p.starter.poster"
                        muted
                        loop
                        playsinline
                        preload="none"
                      />
                      <span class="v20-chip"><CategoryChip :category="p.starter.media" /></span>
                    </span>
                    <div class="v20-pick-body">
                      <p class="v20-pick-name">{{ p.starter.makes }}</p>
                      <p class="v20-pick-model">{{ p.starter.model }}</p>
                      <p class="v20-why">{{ p.why }}.</p>
                      <div v-if="turn.sel === i" class="v20-run">
                        <span
                          v-for="r in [readiness(p.starter.template)]"
                          :key="r.label"
                          class="v20-ready"
                          :class="`is-${r.tone}`"
                        >
                          <Check v-if="r.tone === 'ready'" :size="13" />
                          <Download v-else-if="r.tone === 'fetch'" :size="13" />
                          {{ r.label }}
                        </span>
                        <span class="v20-cost">{{ costLine(p.starter.template) }}</span>
                      </div>
                      <button
                        type="button"
                        class="v20-use"
                        @click="openTemplate(p.starter.template)"
                      >
                        Use this template
                      </button>
                    </div>
                  </article>
                </div>
                <p v-if="!turn.picks.length" class="v20-say is-quiet">
                  Try describing the result, like “a video of waves at sunset”, or start from
                  nothing.
                </p>
                <div class="v20-after">
                  <button
                    type="button"
                    class="v20-pill"
                    :title="`Empty canvas on ${activeInstance.name}`"
                    @click="startBlank"
                  >
                    <Plus :size="14" />Or start blank
                  </button>
                  <button
                    v-for="w in turn.mine"
                    :key="w.id"
                    type="button"
                    class="v20-pill"
                    @click="openWorkflow(w)"
                  >
                    Continue {{ w.name }}
                  </button>
                </div>
              </template>
            </div>
          </div>
        </li>
      </ol>

      <div class="v20-input">
        <label class="v20-box">
          <textarea
            ref="field"
            v-model="draft"
            rows="2"
            placeholder="Describe what you want to make"
            aria-label="Describe what you want to make"
            @keydown="key"
          />
          <button
            type="button"
            class="v20-send"
            :disabled="!draft.trim()"
            aria-label="Find templates"
            @click="ask(draft)"
          >
            <ArrowUp :size="18" />
          </button>
        </label>
        <div
          class="v20-prompts"
          :aria-label="thread.length ? 'Ask something else' : 'Suggested prompts'"
        >
          <button v-for="p in PROMPTS" :key="p" type="button" class="v20-prompt" @click="ask(p)">
            {{ p }}
          </button>
        </div>
        <p v-if="!thread.length" class="v20-blank">
          Know what you’re doing?
          <button type="button" @click="startBlank">Start on a blank canvas</button>
        </p>
      </div>

      <section v-if="!thread.length && recents.length" class="v20-recent">
        <h2 class="v20-h2">Or pick up where you left off</h2>
        <div class="v20-recent-row">
          <button
            v-for="w in recents"
            :key="w.id"
            type="button"
            class="v20-wf"
            @click="openWorkflow(w)"
          >
            <span class="v20-wf-cover"><WorkflowCover :name="w.name" /></span>
            <span class="v20-wf-name">{{ w.name }}</span>
          </button>
        </div>
      </section>
    </div>
  </section>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .v20 {
  position: relative;
  min-height: 100%;
  padding: 0 32px 48px;
}
:root .proto-ui.proto-ui.proto-ui .v20-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 3;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 8px;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v20-close:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v20-col {
  display: flex;
  max-width: 760px;
  min-height: 100%;
  flex-direction: column;
  margin: 0 auto;
}
:root .proto-ui.proto-ui.proto-ui .v20-hello {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: clamp(64px, 14vh, 140px);
  text-align: center;
  animation: v20-in 500ms var(--mar-ease, ease-out) both;
}
:root .proto-ui.proto-ui.proto-ui .v20-mark {
  display: grid;
  width: 44px;
  height: 44px;
  flex: none;
  place-items: center;
  border-radius: 14px;
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
:root .proto-ui.proto-ui.proto-ui .v20-mark.is-small {
  width: 28px;
  height: 28px;
  border-radius: 9px;
}
:root .proto-ui.proto-ui.proto-ui .v20-title {
  margin-top: 20px;
  color: var(--color-base-foreground);
  font-size: var(--text-display);
  font-weight: 700;
  line-height: var(--text-display--line-height);
  letter-spacing: -0.02em;
}
:root .proto-ui.proto-ui.proto-ui .v20-sub {
  max-width: 48ch;
  margin-top: 8px;
  color: var(--color-muted-foreground);
  font-size: 15px;
  line-height: 22px;
}
:root .proto-ui.proto-ui.proto-ui .v20-thread {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 32px;
  padding-top: 56px;
}
:root .proto-ui.proto-ui.proto-ui .v20-turn {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
:root .proto-ui.proto-ui.proto-ui .v20-me {
  align-self: flex-end;
  max-width: 70%;
  padding: 10px 16px;
  border-radius: 18px 18px 4px 18px;
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
  font-size: 15px;
  animation: v20-in 260ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .v20-bot {
  display: flex;
  gap: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v20-say {
  padding-top: 4px;
  color: var(--color-base-foreground);
  font-size: 15px;
  line-height: 22px;
}
:root .proto-ui.proto-ui.proto-ui .v20-say.is-quiet {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v20-dots {
  display: flex;
  gap: 4px;
  padding-top: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v20-dots i {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-subtle-foreground);
  animation: v20-dot 900ms ease-in-out infinite;
}
:root .proto-ui.proto-ui.proto-ui .v20-dots i:nth-child(2) {
  animation-delay: 150ms;
}
:root .proto-ui.proto-ui.proto-ui .v20-dots i:nth-child(3) {
  animation-delay: 300ms;
}
:root .proto-ui.proto-ui.proto-ui .v20-picks {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v20-pick {
  display: flex;
  gap: 16px;
  padding: 8px;
  border-radius: 16px;
  background: var(--color-card-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  animation: v20-in 320ms var(--mar-ease, ease-out) both;
  animation-delay: calc(var(--i) * 70ms);
  transition: background-color 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v20-pick.is-open {
  background: var(--color-card-background-hover);
  box-shadow: inset 0 0 0 1px var(--color-border-strong, var(--color-border-default));
}
:root .proto-ui.proto-ui.proto-ui .v20-pic {
  position: relative;
  width: 168px;
  flex: none;
  aspect-ratio: 16 / 10;
  align-self: flex-start;
  overflow: hidden;
  border-radius: 10px;
  background: var(--color-secondary-background);
  transition: width 260ms var(--mar-ease, ease-out);
}
:root .proto-ui.proto-ui.proto-ui .v20-pick.is-open .v20-pic {
  width: 232px;
}
:root .proto-ui.proto-ui.proto-ui .v20-pic img,
:root .proto-ui.proto-ui.proto-ui .v20-pic video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
:root .proto-ui.proto-ui.proto-ui .v20-pic video {
  opacity: 0;
  transition: opacity 240ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v20-pick:hover .v20-pic video {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .v20-chip {
  position: absolute;
  top: 8px;
  left: 8px;
}
:root .proto-ui.proto-ui.proto-ui .v20-pick-body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  padding: 4px 8px 4px 0;
}
:root .proto-ui.proto-ui.proto-ui .v20-pick-name {
  color: var(--color-base-foreground);
  font-size: var(--text-heading);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v20-pick-model {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v20-why {
  margin-top: 6px;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  line-height: 19px;
}
:root .proto-ui.proto-ui.proto-ui .v20-run {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 10px;
  animation: v20-in 200ms ease both;
}
:root .proto-ui.proto-ui.proto-ui .v20-ready {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-base-foreground);
  font-size: var(--text-ui);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v20-ready.is-ready svg {
  color: var(--color-status-running);
}
:root .proto-ui.proto-ui.proto-ui .v20-cost {
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v20-use {
  display: none;
  height: 34px;
  margin-top: 12px;
  padding: 0 14px;
  border-radius: 9px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  font-size: var(--text-ui);
  font-weight: 600;
}
:root .proto-ui.proto-ui.proto-ui .v20-pick.is-open .v20-use {
  display: inline-flex;
  align-items: center;
}
:root .proto-ui.proto-ui.proto-ui .v20-use:hover {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .v20-after {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v20-pill {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-secondary-background) 60%, transparent);
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v20-pill:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v20-input {
  position: sticky;
  bottom: 0;
  z-index: 2;
  margin-top: 32px;
  padding-bottom: 8px;
  background: linear-gradient(to top, var(--color-app-background) 70%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .v20:not(.is-talking) .v20-input {
  position: static;
  background: none;
}
:root .proto-ui.proto-ui.proto-ui .v20-box {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 14px 12px 12px 20px;
  border-radius: 22px;
  background: var(--color-secondary-background);
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 8%, transparent),
    0 20px 48px -28px oklch(0 0 0 / 0.7);
  transition: box-shadow 160ms ease;
}
:root .proto-ui.proto-ui.proto-ui .v20-box:focus-within {
  box-shadow:
    inset 0 0 0 1px var(--color-border-focus),
    0 20px 48px -28px oklch(0 0 0 / 0.7);
}
:root .proto-ui.proto-ui.proto-ui .v20-box textarea {
  min-width: 0;
  flex: 1;
  min-height: 48px;
  padding: 2px 0;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  box-shadow: none;
  color: var(--color-base-foreground);
  font: inherit;
  font-size: 17px;
  line-height: 24px;
}
:root .proto-ui.proto-ui.proto-ui .v20-box textarea::placeholder {
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v20-send {
  display: grid;
  width: 36px;
  height: 36px;
  flex: none;
  place-items: center;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v20-send:disabled {
  background: var(--color-secondary-background-hover);
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v20-prompts {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin-top: 14px;
}
:root .proto-ui.proto-ui.proto-ui .v20.is-talking .v20-prompts {
  justify-content: flex-start;
  margin-top: 10px;
}
:root .proto-ui.proto-ui.proto-ui .v20-prompt {
  height: 32px;
  padding: 0 13px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-secondary-background) 60%, transparent);
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
}
:root .proto-ui.proto-ui.proto-ui .v20.is-talking .v20-prompt {
  height: 28px;
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v20-prompt:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .v20-blank {
  margin-top: 24px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
  text-align: center;
}
:root .proto-ui.proto-ui.proto-ui .v20-blank button {
  color: var(--color-base-foreground);
  font-weight: 500;
  text-decoration: underline;
  text-decoration-color: var(--color-border-strong, var(--color-subtle-foreground));
  text-underline-offset: 3px;
}
:root .proto-ui.proto-ui.proto-ui .v20-recent {
  margin-top: 64px;
}
:root .proto-ui.proto-ui.proto-ui .v20-h2 {
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui);
  font-weight: 500;
  text-align: center;
}
:root .proto-ui.proto-ui.proto-ui .v20-recent-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}
:root .proto-ui.proto-ui.proto-ui .v20-wf {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 6px;
  border-radius: 12px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .v20-wf:hover {
  background: var(--color-secondary-background);
}
:root .proto-ui.proto-ui.proto-ui .v20-wf-cover {
  position: relative;
  width: 48px;
  height: 34px;
  flex: none;
  overflow: hidden;
  border-radius: 7px;
}
:root .proto-ui.proto-ui.proto-ui .v20-wf-name {
  overflow: hidden;
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  text-overflow: ellipsis;
  white-space: nowrap;
}
@keyframes v20-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
@keyframes v20-dot {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
}
@media (max-width: 760px) {
  :root .proto-ui.proto-ui.proto-ui .v20-pick {
    flex-direction: column;
  }
  :root .proto-ui.proto-ui.proto-ui .v20-pic,
  :root .proto-ui.proto-ui.proto-ui .v20-pick.is-open .v20-pic {
    width: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .v20-hello,
  :root .proto-ui.proto-ui.proto-ui .v20-me,
  :root .proto-ui.proto-ui.proto-ui .v20-pick,
  :root .proto-ui.proto-ui.proto-ui .v20-run,
  :root .proto-ui.proto-ui.proto-ui .v20-dots i {
    animation: none;
  }
  :root .proto-ui.proto-ui.proto-ui .v20-pic {
    transition: none;
  }
}
</style>
