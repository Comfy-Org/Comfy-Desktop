<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, ChevronRight, Copy } from 'lucide-vue-next'
import { modelRole, type AssetFacts } from './assetFacts'

/**
 * How an asset was made, as far as the run's data tells (Better Asset
 * Management PRD): workflow, model, steps and seed as rows, the prompt
 * as text you read, each model with what it did, the sampler's other
 * settings when they were recorded, and the raw run data folded away. Above them, what the file holds: metadata, workflow
 * and run history, each available or not. Shared by Desktop's asset view and
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
/** The run at a glance, as in Alex Tov's media-assets proto: the
 *  workflow, the main model, and the sampler's steps and seed. */
const main = computed(() => facts.models.find((m) => modelRole(m) === 'Model') ?? facts.models[0])
const rows = computed(() =>
  (
    [
      ['Workflow', facts.workflowName],
      ['Model', main.value && name(main.value)],
      ['Steps', facts.params && String(facts.params.steps)],
      ['Seed', facts.params && String(facts.params.seed)]
    ] as [string, string | undefined][]
  ).filter((r): r is [string, string] => !!r[1])
)
const params = computed(() =>
  facts.params
    ? [
        ['CFG', String(facts.params.cfg)],
        ['Sampler', facts.params.sampler]
      ]
    : []
)
/** What can be recovered, each on its own line (PRD P1-03): the file's
 *  metadata, the workflow it carries, and the run's history. */
const SAYS: Record<string, string> = {
  available: 'Available',
  missing: 'Not in this file',
  lost: 'Not kept after a restart'
}
const sources = computed(() => [
  { label: 'File metadata', state: facts.metadata },
  { label: 'Workflow', state: facts.workflow },
  { label: 'Run history', state: facts.imported ? 'missing' : facts.history }
])
/** The run is there but names no prompt or model: say so, not nothing. */
const unnamed = computed(
  () => facts.history === 'available' && !facts.prompt && !facts.models.length
)
</script>

<template>
  <div class="gi">
    <div v-if="loading" class="gi-skel" aria-label="Loading">
      <i style="width: 90%" /><i style="width: 70%" /><i style="width: 50%" />
    </div>
    <template v-else>
      <ul class="gi-sources" aria-label="What this file holds">
        <li v-for="x in sources" :key="x.label" :class="x.state === 'available' && 'is-on'">
          <i aria-hidden="true" /><span class="gi-k">{{ x.label }}</span
          ><span class="gi-state">{{ SAYS[x.state] }}</span>
        </li>
      </ul>
      <p v-if="unnamed" class="gi-gap">No prompt or model identified in the run.</p>

      <dl v-if="rows.length" class="gi-rows">
        <div v-for="[k, v] in rows" :key="k">
          <dt>{{ k }}</dt>
          <dd :title="v">{{ v }}</dd>
        </div>
      </dl>

      <div v-if="facts.prompt" class="gi-block" :title="`From ${facts.promptNode} #6`">
        <div class="gi-head">
          <span class="gi-title">Prompt</span>
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
          <span class="gi-title is-sub">Negative</span>
          <p class="gi-prompt is-negative">{{ facts.negative }}</p>
        </template>
      </div>

      <!-- One model reads in the row above; several get their roles. -->
      <div v-if="facts.models.length > 1" class="gi-block">
        <span class="gi-title">Models</span>
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
.gi-sources {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.gi-sources li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.gi-sources i {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 22%, transparent);
}
.gi-sources li.is-on i {
  background: var(--color-status-running);
}
.gi-state {
  margin-left: auto;
  color: var(--color-muted-foreground);
}
.gi-sources li.is-on .gi-state {
  color: var(--color-base-foreground);
}
.gi-gap {
  color: var(--color-muted-foreground);
  font-size: 12px;
}
.gi-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gi-rows div {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  font-size: 12px;
}
.gi-rows dt {
  flex: none;
  color: var(--color-muted-foreground);
}
.gi-rows dd {
  min-width: 0;
  overflow: hidden;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
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
/* Titles read like the panel's section labels: small, uppercase. */
.gi-title {
  color: var(--color-muted-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.gi-title.is-sub {
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
  /* In a box, like the models: the same fill, padding and radius. */
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--gi-fill);
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
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
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
