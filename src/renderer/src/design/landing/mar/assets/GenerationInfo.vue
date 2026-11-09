<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, ChevronRight, Copy } from 'lucide-vue-next'
import { modelRole, type AssetFacts } from './assetFacts'

/**
 * How an asset was made, as far as the run's data tells (Better Asset
 * Management PRD): the prompt as text you read, each model with what it
 * did, the sampler's settings when they were recorded, and the raw run
 * data folded away. What the file can't tell is said in one line, only
 * when something is missing. Shared by Desktop's asset view and
 * ComfyUI's Asset details panel, so both read the same.
 */
const { facts, loading = false } = defineProps<{ facts: AssetFacts; loading?: boolean }>()

const more = ref(false)
const json = ref(false)
watch(
  () => facts,
  () => ((more.value = false), (json.value = false))
)
const long = computed(() => (facts.prompt?.length ?? 0) > 180)

const copied = ref('')
let timer = 0
function copy(what: string, text = ''): void {
  navigator.clipboard?.writeText(text).catch(() => {})
  copied.value = what
  clearTimeout(timer)
  timer = window.setTimeout(() => (copied.value = ''), 1400)
}

const name = (file: string): string => file.replace(/\.(safetensors|ckpt|pt|pth|gguf)$/i, '')
const params = computed(() =>
  facts.params
    ? [
        ['Seed', String(facts.params.seed)],
        ['Steps', String(facts.params.steps)],
        ['CFG', String(facts.params.cfg)],
        ['Sampler', facts.params.sampler]
      ]
    : []
)
/** Only what's missing, in words: nothing to say when all of it is there. */
const gaps = computed(() => {
  if (facts.imported) return ['Imported file: it carries no run.']
  const out: string[] = []
  if (facts.workflow !== 'available') out.push('No workflow in this file')
  if (facts.history === 'lost') out.push('Run data wasn’t kept after a restart')
  else if (facts.history !== 'available') out.push('No run data')
  return out.length ? [`${out.join(' · ')}.`] : []
})
</script>

<template>
  <div class="gi">
    <div v-if="loading" class="gi-skel" aria-label="Loading">
      <i style="width: 90%" /><i style="width: 70%" /><i style="width: 50%" />
    </div>
    <template v-else>
      <p v-for="g in gaps" :key="g" class="gi-gap">{{ g }}</p>

      <div v-if="facts.prompt" class="gi-block" :title="`From ${facts.promptNode} #6`">
        <div class="gi-head">
          <span class="gi-k">Prompt</span>
          <button
            type="button"
            class="gi-copy"
            :aria-label="copied === 'prompt' ? 'Copied' : 'Copy prompt'"
            :title="copied === 'prompt' ? 'Copied' : 'Copy prompt'"
            @click="copy('prompt', facts.prompt)"
          >
            <Check v-if="copied === 'prompt'" :size="13" /><Copy v-else :size="13" />
          </button>
        </div>
        <p class="gi-prompt" :class="long && !more && 'is-clamped'">{{ facts.prompt }}</p>
        <button v-if="long" type="button" class="gi-more" @click="more = !more">
          {{ more ? 'Show less' : 'Show more' }}
        </button>
        <template v-if="facts.negative">
          <span class="gi-k is-sub">Negative</span>
          <p class="gi-prompt is-negative">{{ facts.negative }}</p>
        </template>
      </div>

      <div v-if="facts.models.length" class="gi-block">
        <span class="gi-k">Models</span>
        <ul class="gi-models">
          <li v-for="m in facts.models" :key="m" :title="m">
            <span class="gi-role">{{ modelRole(m) }}</span>
            <span class="gi-model">{{ name(m) }}</span>
          </li>
        </ul>
      </div>

      <dl v-if="params.length" class="gi-params">
        <div v-for="[k, v] in params" :key="k">
          <dt>{{ k }}</dt>
          <dd>{{ v }}</dd>
        </div>
      </dl>

      <div v-if="facts.json" class="gi-json">
        <div class="gi-json-head">
          <button type="button" class="gi-json-toggle" :aria-expanded="json" @click="json = !json">
            <ChevronRight :size="14" :class="json && 'rotate-90'" />Run data (JSON)
          </button>
          <button
            v-if="json"
            type="button"
            class="gi-copy is-on"
            :aria-label="copied === 'json' ? 'Copied' : 'Copy JSON'"
            :title="copied === 'json' ? 'Copied' : 'Copy JSON'"
            @click="copy('json', facts.json)"
          >
            <Check v-if="copied === 'json'" :size="13" /><Copy v-else :size="13" />
          </button>
        </div>
        <pre v-if="json">{{ facts.json }}</pre>
      </div>
    </template>
  </div>
</template>

<style>
.gi {
  --gi-line: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  --gi-fill: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--color-base-foreground);
}
.gi-gap {
  color: var(--color-muted-foreground);
  font-size: 12px;
}
.gi-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gi-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 20px;
}
.gi-k {
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 500;
}
.gi-k.is-sub {
  margin-top: 4px;
}
:root .proto-ui.proto-ui.proto-ui .gi-copy {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted-foreground);
  opacity: 0;
  transition: opacity 0.15s;
}
.gi-block:hover .gi-copy,
:root .proto-ui.proto-ui.proto-ui .gi-copy:focus-visible,
:root .proto-ui.proto-ui.proto-ui .gi-copy.is-on {
  opacity: 1;
}
:root .proto-ui.proto-ui.proto-ui .gi-copy:hover {
  background: var(--gi-fill);
  color: var(--color-base-foreground);
}
.gi-prompt {
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.gi-prompt.is-clamped {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}
.gi-prompt.is-negative {
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .gi-more {
  align-self: flex-start;
  padding: 0;
  background: transparent;
  color: var(--color-muted-foreground);
  font-size: 12px;
  font-weight: 500;
}
:root .proto-ui.proto-ui.proto-ui .gi-more:hover {
  color: var(--color-base-foreground);
}
.gi-models {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  background: var(--gi-fill);
}
.gi-models li {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 10px;
  padding: 7px 10px;
}
.gi-models li + li {
  border-top: 1px solid var(--gi-line);
}
.gi-role {
  width: 84px;
  flex: none;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
.gi-model {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gi-params {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
  overflow: hidden;
  border-radius: 8px;
}
.gi-params div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: 7px 10px;
  background: var(--gi-fill);
}
.gi-params dt {
  color: var(--color-muted-foreground);
  font-size: 11px;
}
.gi-params dd {
  overflow: hidden;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gi-json-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
:root .proto-ui.proto-ui.proto-ui .gi-json-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  background: transparent;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .gi-json-toggle:hover {
  color: var(--color-base-foreground);
}
.gi-json-toggle svg {
  transition: rotate 0.15s;
}
.gi-json pre {
  max-height: 220px;
  margin-top: 6px;
  overflow: auto;
  padding: 10px;
  border-radius: 8px;
  background: var(--gi-fill);
  color: var(--color-muted-foreground);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
  line-height: 1.5;
}
.gi-skel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gi-skel i {
  height: 12px;
  border-radius: 4px;
  background: var(--gi-fill);
}
</style>
