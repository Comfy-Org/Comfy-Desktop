<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { ProtoInstance } from '../../mock'
import { factsOf } from './buildFacts'

/**
 * Desktop's Terminal tab (views/comfyUISettings/ConsoleTerminalPane.vue):
 * a shell in the build's folder with its Python environment active, for
 * pip and git by hand. Typing `exit` ends the session, with a way back.
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const facts = factsOf(env)
const prompt = `(comfy) ${env.name.toLowerCase().replace(/\s+/g, '-')} %`
const lines = ref<string[]>([
  `Python ${facts.python} environment for ${env.name}`,
  `cd ${facts.path}`
])
const cmd = ref('')
const ended = ref(false)
const screen = ref<HTMLElement>()
async function run(): Promise<void> {
  const c = cmd.value.trim()
  lines.value.push(`${prompt} ${c}`)
  cmd.value = ''
  if (c === 'exit') ended.value = true
  else if (c === 'python --version') lines.value.push(`Python ${facts.python}`)
  else if (c) lines.value.push(`${c.split(' ')[0]}: done`)
  await nextTick()
  screen.value?.scrollTo({ top: screen.value.scrollHeight })
}
function restart(): void {
  ended.value = false
  lines.value = [`Python ${facts.python} environment for ${env.name}`]
}
</script>

<template>
  <div class="mar-term">
    <div class="mar-term-head"><i /><i /><i /><span>Shell</span></div>
    <div ref="screen" class="mar-term-screen" @click="($refs.input as HTMLInputElement)?.focus()">
      <p v-for="(l, i) in lines" :key="i">{{ l }}</p>
      <div v-if="!ended" class="mar-term-line">
        <span>{{ prompt }}</span
        ><input
          ref="input"
          v-model="cmd"
          aria-label="Shell input"
          spellcheck="false"
          @keydown.enter="run"
        />
      </div>
      <div v-else class="mar-term-ended">
        <p>This console session ended. Restart it to keep using the shell.</p>
        <button type="button" @click="restart">Restart console</button>
      </div>
    </div>
  </div>
</template>

<style>
.mar-term {
  overflow: hidden;
  border-radius: var(--radius-card);
  background: oklch(0.16 0.004 285);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
}
.mar-term-head {
  display: flex;
  height: 32px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-bottom: 1px solid oklch(1 0 0 / 0.08);
  color: oklch(1 0 0 / 0.55);
  font-size: 12px;
}
.mar-term-head i {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: oklch(1 0 0 / 0.16);
}
.mar-term-head span {
  margin-left: 6px;
}
.mar-term-screen {
  height: 420px;
  overflow: auto;
  padding: 12px 14px;
  color: oklch(0.9 0 0);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 19px;
  cursor: text;
}
.mar-term-screen p {
  margin: 0;
  white-space: pre-wrap;
}
.mar-term-line {
  display: flex;
  gap: 8px;
}
.mar-term-line span {
  color: oklch(0.78 0.12 150);
}
:root .proto-ui.proto-ui.proto-ui .mar-term-line input {
  flex: 1;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  outline: none;
}
.mar-term-ended {
  margin-top: 12px;
  color: oklch(1 0 0 / 0.6);
  font-family: var(--font-sans, inherit);
  font-size: 13px;
}
:root .proto-ui.proto-ui.proto-ui .mar-term-ended button {
  margin-top: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: oklch(1 0 0 / 0.92);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
</style>
