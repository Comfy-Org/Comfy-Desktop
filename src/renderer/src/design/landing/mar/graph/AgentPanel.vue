<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { ArrowUp, Bot, Check, X } from 'lucide-vue-next'
import { NODE_TYPES, type Recipe } from './canvasData'

/**
 * The agent: describe a workflow in words and it builds it on the canvas
 * (Node Banana's prompt to workflow). In the mock it reads a few keywords,
 * says what it adds, step by step, and hands the graph a recipe.
 */

const emit = defineEmits<{ build: [recipe: Recipe]; close: [] }>()

const SUGGESTIONS = [
  'Turn a product photo into a 360° video',
  'Cut out the subject and upscale it',
  'Write a voice-over from an idea'
]

function plan(ask: string): { reply: string; recipe: Recipe } {
  const a = ask.toLowerCase()
  if (/video|360|motion|animate|clip/.test(a))
    return {
      reply: 'An image becomes the first frame, a prompt sets the camera move.',
      recipe: {
        nodes: [
          { key: 'img', kind: 'image', dx: 0, dy: 160 },
          {
            key: 'p',
            kind: 'prompt',
            dx: 0,
            dy: 0,
            text: 'Continuous shot, the camera orbits the subject in a perfect 360° loop'
          },
          { key: 'v', kind: 'generateVideo', dx: 360, dy: 0 }
        ],
        links: [
          ['p', 0, 'v', 0],
          ['img', 0, 'v', 1]
        ]
      }
    }
  if (/cut|background|remove|upscale|sharp/.test(a))
    return {
      reply: 'The subject is cut out, upscaled, then compared with the original.',
      recipe: {
        nodes: [
          { key: 'img', kind: 'image', dx: 0, dy: 0 },
          { key: 'bg', kind: 'removeBg', dx: 340, dy: 0 },
          { key: 'up', kind: 'upscale', dx: 660, dy: 0 },
          { key: 'cmp', kind: 'compare', dx: 980, dy: 0 }
        ],
        links: [
          ['img', 0, 'bg', 0],
          ['bg', 0, 'up', 0],
          ['img', 0, 'cmp', 0],
          ['up', 0, 'cmp', 1]
        ]
      }
    }
  if (/voice|audio|speech|narrat|sound/.test(a))
    return {
      reply: 'An LLM writes the script from your idea, then a voice reads it.',
      recipe: {
        nodes: [
          { key: 'p', kind: 'prompt', dx: 0, dy: 0, text: ask },
          { key: 'llm', kind: 'llm', dx: 340, dy: 0 },
          { key: 'a', kind: 'generateAudio', dx: 680, dy: 0 }
        ],
        links: [
          ['p', 0, 'llm', 0],
          ['llm', 0, 'a', 0]
        ]
      }
    }
  return {
    reply: 'An LLM expands your idea into a full prompt, then an image model makes it.',
    recipe: {
      nodes: [
        { key: 'p', kind: 'prompt', dx: 0, dy: 0, text: ask },
        { key: 'llm', kind: 'llm', dx: 340, dy: 0 },
        { key: 'g', kind: 'generate', dx: 680, dy: 0 },
        { key: 'o', kind: 'output', dx: 1060, dy: 0 }
      ],
      links: [
        ['p', 0, 'llm', 0],
        ['llm', 0, 'g', 0],
        ['g', 0, 'o', 0]
      ]
    }
  }
}

interface Message {
  role: 'you' | 'agent'
  text: string
  steps?: { text: string; done: boolean }[]
}
const messages = ref<Message[]>([])
const draft = ref('')
const busy = ref(false)
const list = ref<HTMLElement>()
const timers: ReturnType<typeof setTimeout>[] = []

function send(text = draft.value): void {
  const ask = text.trim()
  if (!ask || busy.value) return
  draft.value = ''
  busy.value = true
  messages.value.push({ role: 'you', text: ask })
  const { reply, recipe } = plan(ask)
  const msg: Message = {
    role: 'agent',
    text: reply,
    steps: [
      ...recipe.nodes.map((n) => ({ text: `Add ${NODE_TYPES[n.kind].title}`, done: false })),
      { text: 'Wire the sockets', done: false }
    ]
  }
  messages.value.push(msg)
  const live = messages.value[messages.value.length - 1]!
  live.steps!.forEach((_, i) =>
    timers.push(setTimeout(() => (live.steps![i]!.done = true), 280 * (i + 1)))
  )
  timers.push(
    setTimeout(
      () => {
        emit('build', recipe)
        busy.value = false
      },
      280 * (live.steps!.length + 1)
    )
  )
  nextTick(() => list.value?.scrollTo({ top: list.value.scrollHeight }))
}
onBeforeUnmount(() => timers.forEach(clearTimeout))
</script>

<template>
  <aside class="ag" aria-label="Agent" @pointerdown.stop @wheel.stop>
    <header class="ag-head">
      <Bot :size="15" />
      <span class="ag-title">Agent</span>
      <button type="button" class="ag-close" aria-label="Close" @click="emit('close')">
        <X :size="14" />
      </button>
    </header>
    <div ref="list" class="ag-list">
      <template v-if="!messages.length">
        <p class="ag-hint">Describe what you want to make; the agent builds the workflow here.</p>
        <button v-for="s in SUGGESTIONS" :key="s" type="button" class="ag-suggest" @click="send(s)">
          {{ s }}
        </button>
      </template>
      <div v-for="(m, i) in messages" :key="i" class="ag-msg" :class="`is-${m.role}`">
        <p>{{ m.text }}</p>
        <ul v-if="m.steps" class="ag-steps">
          <li v-for="(s, j) in m.steps" :key="j" :class="s.done && 'is-done'">
            <Check v-if="s.done" :size="11" /><i v-else class="ag-dot" />{{ s.text }}
          </li>
        </ul>
      </div>
    </div>
    <form class="ag-compose" @submit.prevent="send()">
      <input v-model="draft" type="text" placeholder="Describe a workflow" :disabled="busy" />
      <button type="submit" class="ag-send" aria-label="Send" :disabled="!draft.trim() || busy">
        <ArrowUp :size="14" />
      </button>
    </form>
  </aside>
</template>

<style>
.ag {
  position: absolute;
  bottom: 16px;
  left: 16px;
  z-index: 5;
  display: flex;
  width: 340px;
  max-height: min(460px, calc(100% - var(--mg-top) - 360px));
  min-height: 220px;
  flex-direction: column;
  border-radius: var(--radius-card);
  background: color-mix(in oklch, var(--color-content-background) 80%, transparent);
  backdrop-filter: blur(32px) saturate(1.2);
  box-shadow: 0 18px 50px rgb(0 0 0 / 0.28);
  color: var(--mg-text);
}
.ag-head {
  display: flex;
  height: 44px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 14px;
  color: var(--mg-muted);
}
.ag-title {
  flex: 1;
  color: var(--mg-text);
  font-size: 13px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .ag-close {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--mar-tab-item-radius);
  background: transparent;
  color: var(--mg-muted);
}
.ag-list {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  padding: 0 12px 8px;
}
.ag-hint {
  margin: 4px 2px 4px;
  color: var(--mg-dim);
  font-size: 12.5px;
  line-height: 18px;
}
:root .proto-ui.proto-ui.proto-ui .ag-suggest {
  padding: 8px 12px;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-well);
  color: var(--mg-text);
  font-size: 12.5px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .ag-suggest:hover {
  background: var(--mg-hover);
}
.ag-msg p {
  margin: 0;
  font-size: 12.5px;
  line-height: 18px;
}
.ag-msg.is-you {
  align-self: flex-end;
  max-width: 85%;
  padding: 8px 12px;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-hover);
}
.ag-steps {
  display: flex;
  margin: 8px 0 0;
  padding: 0;
  flex-direction: column;
  gap: 4px;
  list-style: none;
}
.ag-steps li {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--mg-dim);
  font-size: 12px;
  transition: color 0.2s ease;
}
.ag-steps li.is-done {
  color: var(--mg-muted);
}
.ag-dot {
  width: 11px;
  height: 11px;
  border: 1.5px solid currentColor;
  border-radius: 999px;
  opacity: 0.6;
}
.ag-compose {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  margin: 0 8px 8px;
  padding: 4px 4px 4px 12px;
  border-radius: var(--mar-tab-radius);
  background: var(--mg-well);
}
:root .proto-ui.proto-ui.proto-ui .ag-compose input {
  height: auto;
  padding: 0;
  box-shadow: none;
  min-width: 0;
  height: 32px;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--mg-text);
  font: inherit;
  font-size: 13px;
}
.ag-compose input::placeholder {
  color: var(--mg-dim);
}
:root .proto-ui.proto-ui.proto-ui .ag-send {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--mar-tab-item-radius);
  background: var(--mg-run);
  color: var(--mg-run-text);
}
:root .proto-ui.proto-ui.proto-ui .ag-send:disabled {
  opacity: 0.35;
}
.is-current .ag {
  border-radius: var(--radius-card);
  background: var(--mg-chrome-2);
  box-shadow:
    0 0 0 1px var(--mg-chrome-line),
    0 12px 30px rgb(0 0 0 / 0.35);
  backdrop-filter: none;
}
.is-current .ag {
  left: 68px;
}
</style>
