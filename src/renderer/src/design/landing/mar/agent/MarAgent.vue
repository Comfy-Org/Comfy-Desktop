<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowUp, Check, Play, Plus } from 'lucide-vue-next'
import { AgentChat } from '../icons/agentChat'
import { ComfyWorkflow } from '../icons/comfyIcons'
import Button from '../../ui/Button.vue'
import StarterCards from '../../parts/StarterCards.vue'
import MediaChip from '../MediaChip.vue'
import {
  agent,
  resetAgent,
  runTask,
  send as agentSend,
  suggestions as agentSuggestions
} from '../../agent'
import {
  chooseLayout,
  finishLook,
  flow,
  LAYOUTS,
  next,
  publish,
  resetFlow,
  send as flowSend,
  suggestions as flowSuggestions
} from '../../appFlow'
import { activeInstance, hostActions } from '../../useProto'
import { thumb } from '../../mock'

/**
 * Mar's Agent (Mar draft): one chat column over the page, translucent
 * surfaces, the agent's work shown as it happens. It drives the same
 * scripted flows as Pablo's Agent: a prompt makes a workflow and then an
 * app (appFlow.ts); a starter card generates images (agent.ts).
 */

// Which scripted thread is on screen: the app flow once it has started,
// else the generation thread from a starter card.
const useFlow = computed(() => flow.messages.length > 0 || !agent.messages.length)
const messages = computed(() => (useFlow.value ? flow.messages : agent.messages))
const busy = computed(() => (useFlow.value ? flow.busy : agent.busy))
const chips = computed(() => (useFlow.value ? flowSuggestions() : agentSuggestions()))
const empty = computed(() => !messages.value.length)
const lastAgent = computed(() => [...messages.value].reverse().find((m) => m.role === 'agent'))

const text = ref('')
const scroller = ref<HTMLElement>()

function send(value = text.value): void {
  const t = value.trim()
  if (!t || busy.value) return
  if (useFlow.value) flowSend(t)
  else agentSend(t)
  text.value = ''
}

function newChat(): void {
  resetFlow()
  resetAgent()
  text.value = ''
}

// Keep the newest message in view while the agent works.
watch(
  () => messages.value.map((m) => `${m.id}:${m.shown ?? 0}:${m.pending ?? false}`).join(),
  () => nextTick(() => scroller.value?.scrollTo({ top: 1e6, behavior: 'smooth' }))
)

// **bold** in the agent's text, nothing else.
function parts(t: string): { text: string; bold: boolean }[] {
  return t.split(/\*\*(.+?)\*\*/g).map((s, i) => ({ text: s, bold: i % 2 === 1 }))
}

const ARTIFACT_LABEL: Record<string, string> = {
  layout: 'Layout',
  inputs: 'Inputs',
  look: 'Look',
  preview: 'Preview',
  publish: 'Publish',
  live: 'Live',
  app: 'App',
  deploy: 'Deploy'
}
</script>

<template>
  <div class="mar-agent relative flex h-full flex-col">
    <header class="flex h-14 shrink-0 items-center gap-2 px-6">
      <AgentChat :size="16" class="text-muted-foreground" />
      <h1 class="text-ui font-semibold">Agent</h1>
      <Button v-if="!empty" variant="ghost" size="sm" class="ml-auto" @click="newChat">
        <Plus :size="14" />New chat
      </Button>
    </header>

    <!-- Start: what to make, one sentence or one example. -->
    <div v-if="empty" class="flex flex-1 flex-col items-center justify-center px-6 pb-24">
      <h2 class="mb-6 text-center text-display font-semibold tracking-[-0.02em]">
        What do you want to make?
      </h2>
      <form class="mar-composer w-full max-w-180" @submit.prevent="send()">
        <textarea
          v-model="text"
          rows="2"
          placeholder="Describe a workflow, an app, or the images you need"
          class="w-full resize-none bg-transparent text-ui outline-none placeholder:text-subtle-foreground"
          @keydown.enter.exact.prevent="send()"
        />
        <div class="flex items-center justify-between">
          <span class="text-ui text-subtle-foreground"
            >Runs on
            <b class="font-medium text-muted-foreground">{{ activeInstance.name }}</b></span
          >
          <button type="submit" class="mar-send" :disabled="!text.trim()" aria-label="Send">
            <ArrowUp :size="15" />
          </button>
        </div>
      </form>
      <p class="mt-10 mb-2 text-ui text-subtle-foreground">Or start from an example</p>
      <StarterCards
        size="sm"
        :on-select="(s) => runTask(s.label, 'output', s.thumbId)"
        class="max-w-180"
      />
    </div>

    <!-- The conversation. -->
    <template v-else>
      <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto px-6">
        <div class="mx-auto flex w-full max-w-180 flex-col gap-6 pt-2 pb-40">
          <template v-for="m in messages" :key="m.id">
            <div v-if="m.role === 'user'" class="mar-bubble self-end">{{ m.text }}</div>

            <div v-else class="flex gap-3">
              <span class="mar-avatar"><AgentChat :size="14" /></span>
              <div class="flex min-w-0 flex-1 flex-col gap-3 pt-1">
                <!-- What the agent did, step by step. -->
                <ol v-if="m.steps?.length" class="mar-steps">
                  <li
                    v-for="(s, i) in m.steps"
                    v-show="i <= (m.shown ?? 0)"
                    :key="s"
                    :class="i < (m.shown ?? 0) || !m.pending ? 'is-done' : 'is-active'"
                  >
                    <Check v-if="i < (m.shown ?? 0) || !m.pending" :size="12" />
                    <span v-else class="mar-dot" />
                    {{ s }}
                  </li>
                </ol>

                <p v-if="!m.pending" class="text-ui leading-relaxed">
                  <template v-for="(p, i) in parts(m.text)" :key="i">
                    <b v-if="p.bold" class="font-semibold">{{ p.text }}</b
                    ><template v-else>{{ p.text }}</template>
                  </template>
                </p>

                <!-- Generated images. -->
                <div
                  v-if="!m.pending && 'outputs' in m && m.outputs?.length"
                  class="grid grid-cols-2 gap-2"
                >
                  <button
                    v-for="o in m.outputs"
                    :key="o"
                    type="button"
                    class="mar-shot group"
                    @click="send('Make 4 more like this one')"
                  >
                    <img :src="thumb(o)" alt="" />
                  </button>
                </div>

                <!-- The workflow it built. -->
                <div v-if="!m.pending && m.artifact === 'workflow'" class="mar-card">
                  <div class="mar-card-media">
                    <img :src="thumb('image_flux2')" alt="" />
                    <MediaChip :icon="ComfyWorkflow" class="absolute top-2.5 left-2.5"
                      >Workflow</MediaChip
                    >
                  </div>
                  <div class="flex items-center gap-3 p-3">
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-ui font-medium">{{
                        flow.draft?.source.name ?? agent.workflow?.name ?? 'product-lifestyle'
                      }}</span>
                      <span class="block text-ui text-subtle-foreground"
                        >9 nodes · Flux 2 dev · tested</span
                      >
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      @click="hostActions.launch(activeInstance)"
                    >
                      <Play :size="13" />Open in ComfyUI
                    </Button>
                    <Button
                      v-if="m === lastAgent && useFlow"
                      variant="primary"
                      size="sm"
                      @click="send('Make it an app')"
                      >Make an app</Button
                    >
                  </div>
                </div>

                <!-- The app taking shape. -->
                <div
                  v-else-if="!m.pending && m.artifact && m === lastAgent && flow.draft"
                  class="mar-card"
                >
                  <div class="flex items-center gap-3 p-3">
                    <img
                      :src="thumb(flow.draft.thumbId)"
                      alt=""
                      class="size-12 rounded-control object-cover"
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-ui font-medium">{{ flow.draft.name }}</span>
                      <span class="block truncate text-ui text-subtle-foreground">{{
                        flow.draft.blurb
                      }}</span>
                    </span>
                    <MediaChip>{{ ARTIFACT_LABEL[m.artifact] ?? m.artifact }}</MediaChip>
                  </div>
                  <div class="flex flex-wrap gap-1.5 px-3 pb-3">
                    <span
                      v-for="f in flow.draft.fields.filter((x) => x.on)"
                      :key="f.id"
                      class="mar-field"
                      >{{ f.label }}</span
                    >
                  </div>
                  <!-- The next step, right here (Pablo's has it on the app). -->
                  <div v-if="m === lastAgent && !busy" class="flex flex-wrap gap-2 px-3 pb-3">
                    <template v-if="flow.stage === 'layout'">
                      <Button
                        v-for="l in LAYOUTS"
                        :key="l.id"
                        variant="secondary"
                        size="sm"
                        @click="chooseLayout(l.id)"
                        >{{ l.label }}</Button
                      >
                    </template>
                    <Button
                      v-else-if="flow.stage === 'look'"
                      variant="secondary"
                      size="sm"
                      @click="finishLook(true)"
                      >Keep the default look</Button
                    >
                    <Button
                      v-else-if="flow.stage === 'publish'"
                      variant="primary"
                      size="sm"
                      @click="publish()"
                      >Publish</Button
                    >
                    <Button
                      v-else-if="flow.stage === 'inputs' || flow.stage === 'preview'"
                      variant="primary"
                      size="sm"
                      @click="next()"
                      >Continue</Button
                    >
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- What to say next. -->
          <div v-if="!busy && chips.length" class="flex flex-wrap gap-2 pl-10">
            <button v-for="c in chips" :key="c" type="button" class="mar-chip" @click="send(c)">
              {{ c }}
            </button>
          </div>
        </div>
      </div>

      <div class="mar-dock">
        <form class="mar-composer mx-auto w-full max-w-180" @submit.prevent="send()">
          <textarea
            v-model="text"
            rows="1"
            :placeholder="busy ? 'The agent is working…' : 'Reply to the agent'"
            class="w-full resize-none bg-transparent text-ui outline-none placeholder:text-subtle-foreground"
            @keydown.enter.exact.prevent="send()"
          />
          <div class="flex items-center justify-between">
            <span class="text-ui text-subtle-foreground"
              >Runs on
              <b class="font-medium text-muted-foreground">{{ activeInstance.name }}</b></span
            >
            <button
              type="submit"
              class="mar-send"
              :disabled="!text.trim() || busy"
              aria-label="Send"
            >
              <ArrowUp :size="15" />
            </button>
          </div>
        </form>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Translucent surfaces over the page: white at low opacity plus a blur,
   no borders, no flat grey. */
.mar-composer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-radius: 20px;
  padding: 14px 12px 10px 16px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  backdrop-filter: blur(28px) saturate(1.2);
  box-shadow: 0 18px 48px -20px rgb(0 0 0 / 0.7);
  transition: background-color 200ms ease;
}
.mar-composer:focus-within {
  background: color-mix(in oklch, var(--color-base-foreground) 8.5%, transparent);
}
.mar-send {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}
.mar-send:disabled {
  opacity: 0.3;
}
.mar-send:not(:disabled):active {
  transform: scale(0.94);
}
.mar-bubble {
  max-width: 80%;
  border-radius: 18px 18px 6px 18px;
  padding: 10px 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  backdrop-filter: blur(20px);
  font-size: var(--text-ui);
  line-height: 1.55;
  white-space: pre-wrap;
}
.mar-avatar {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-muted-foreground);
}
.mar-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-radius: 14px;
  padding: 10px 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 3.5%, transparent);
}
.mar-steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-ui);
  animation: mar-in 260ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-steps li.is-done {
  color: var(--color-subtle-foreground);
}
.mar-steps li.is-done svg {
  color: var(--color-status-running);
}
.mar-steps li.is-active {
  color: var(--color-base-foreground);
}
.mar-dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 1.5px solid color-mix(in oklch, var(--color-base-foreground) 25%, transparent);
  border-top-color: var(--color-border-focus);
  animation: mar-spin 700ms linear infinite;
}
.mar-shot,
.mar-card {
  overflow: hidden;
  border-radius: 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  backdrop-filter: blur(24px);
  animation: mar-in 320ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-shot {
  aspect-ratio: 4 / 3;
}
.mar-shot img,
.mar-card-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 500ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-shot:hover img {
  transform: scale(1.04);
}
.mar-card-media {
  position: relative;
  height: 148px;
}
.mar-field {
  border-radius: 999px;
  padding: 3px 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-muted-foreground);
  font-size: 12px;
}
.mar-chip {
  border-radius: var(--radius-control);
  padding: 6px 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  color: var(--color-muted-foreground);
  font-size: var(--text-ui);
  transition:
    background-color 150ms ease,
    color 150ms ease;
}
.mar-chip:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  color: var(--color-base-foreground);
}
.mar-dock {
  position: absolute;
  inset: auto 0 0;
  padding: 40px 24px 20px;
  background: linear-gradient(to top, var(--color-content-background) 45%, transparent);
}
@keyframes mar-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
@keyframes mar-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mar-steps li,
  .mar-shot,
  .mar-card {
    animation: none;
  }
  .mar-dot {
    animation: none;
  }
}
</style>
