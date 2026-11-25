<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Info, Search, Settings2, X } from 'lucide-vue-next'
import Input from '../../ui/Input.vue'
import Select from '../../ui/Select.vue'
import Switch from '../../ui/Switch.vue'
import Tooltip from '../../ui/Tooltip.vue'
import type { ProtoInstance } from '../../mock'
import BuildBlock from './BuildBlock.vue'
import {
  LAUNCH_MODES,
  NETWORK,
  PARTITIONS,
  PORT_CONFLICT,
  SECURITY,
  settingsOf,
  stateOf
} from './buildFacts'
import './buildTabs.css'

/**
 * Desktop's Startup arguments tab read top-down (Comfy-Desktop#2217): one
 * uppercase title on top, the arguments in one full-width field (the gear
 * opens every flag ComfyUI takes, grouped and searchable), then the
 * dropdowns two to a row while Mar picks one or two columns. Labels sit
 * 4px above 40px fields; each one's hint is in its info tooltip. A change
 * while it runs asks for a restart (the header's button).
 */
const { env } = defineProps<{ env: ProtoInstance }>()
const set = settingsOf(env)
const state = stateOf(env)

interface Arg {
  flag: string
  group: string
  help: string
  /** Takes a value: its placeholder. */
  value?: string
}
const ARGS: Arg[] = [
  {
    flag: '--listen',
    group: 'Network',
    help: 'Specify the IP address to listen on.',
    value: '127.0.0.1'
  },
  { flag: '--port', group: 'Network', help: 'Set the listen port.', value: '8188' },
  {
    flag: '--enable-cors-header',
    group: 'Network',
    help: 'Enable CORS with an optional origin.',
    value: 'optional'
  },
  {
    flag: '--auto-launch',
    group: 'Launch',
    help: 'Open ComfyUI in the default browser when it starts.'
  },
  {
    flag: '--cuda-device',
    group: 'GPU & VRAM',
    help: 'Set the CUDA device this build uses.',
    value: 'value'
  },
  {
    flag: '--reserve-vram',
    group: 'GPU & VRAM',
    help: 'Amount of VRAM in GB to keep free for the OS and other apps.',
    value: 'value'
  },
  { flag: '--cpu-vae', group: 'Precision', help: 'Run the VAE on the CPU.' },
  {
    flag: '--force-channels-last',
    group: 'Precision',
    help: 'Force channels-last memory format when running inference.'
  },
  { flag: '--use-sage-attention', group: 'Performance', help: 'Use sage attention.' },
  {
    flag: '--use-pytorch-cross-attention',
    group: 'Performance',
    help: 'Use the new PyTorch 2.0 cross attention function.'
  },
  { flag: '--disable-xformers', group: 'Performance', help: 'Disable xformers.' },
  {
    flag: '--preview-method',
    group: 'Preview',
    help: 'Default preview method for sampler nodes.',
    value: 'auto'
  },
  {
    flag: '--output-directory',
    group: 'Paths',
    help: 'Set the ComfyUI output directory.',
    value: 'value'
  },
  {
    flag: '--extra-model-paths-config',
    group: 'Paths',
    help: 'Load one or more extra_model_paths.yaml files.',
    value: 'space-separated values'
  }
]
// A Select can't hold '': no flag from a group is this.
const NONE = 'none'
/** Flags that exclude each other: one choice. */
const CLUSTERS = [
  { group: 'GPU & VRAM', flags: ['--lowvram', '--highvram', '--novram', '--gpu-only'] },
  { group: 'Cache', flags: ['--cache-lru', '--cache-none', '--cache-ram'] }
]
const GROUPS = [
  'Network',
  'Launch',
  'GPU & VRAM',
  'Precision',
  'Performance',
  'Cache',
  'Preview',
  'Paths'
]

// The raw string is the truth; the switches read and write it.
function parse(raw: string): Map<string, string> {
  const out = new Map<string, string>()
  const t = raw.trim().split(/\s+/).filter(Boolean)
  for (let i = 0; i < t.length; i++) {
    const def = ARGS.find((a) => a.flag === t[i])
    const takes = def?.value && t[i + 1] && !t[i + 1]!.startsWith('--')
    out.set(t[i]!, takes ? t[++i]! : '')
  }
  return out
}
const on = computed(() => parse(set.args))
function write(m: Map<string, string>): void {
  set.args = [...m].map(([f, v]) => (v ? `${f} ${v}` : f)).join(' ')
}
function toggle(flag: string, v: boolean): void {
  const m = new Map(on.value)
  if (v) m.set(flag, '')
  else m.delete(flag)
  write(m)
}
function setValue(flag: string, v: string): void {
  const m = new Map(on.value)
  m.set(flag, v.trim())
  write(m)
}
function choose(c: (typeof CLUSTERS)[number], flag: string): void {
  const m = new Map(on.value)
  c.flags.forEach((f) => m.delete(f))
  if (flag !== NONE) m.set(flag, '')
  write(m)
}
const chosen = (c: (typeof CLUSTERS)[number]): string =>
  c.flags.find((f) => on.value.has(f)) ?? NONE
const options = (c: (typeof CLUSTERS)[number]) => [
  { value: NONE, label: 'None (default)' },
  ...c.flags.map((f) => ({ value: f, label: f }))
]

const flagsOpen = ref(false)
const query = ref('')
const match = (a: Arg): boolean =>
  !query.value || `${a.flag} ${a.help}`.toLowerCase().includes(query.value.toLowerCase())
const groups = computed(() => {
  const active = ARGS.filter((a) => on.value.has(a.flag) && match(a))
  return [
    { title: 'Active', args: active, clusters: [] as typeof CLUSTERS },
    ...GROUPS.map((g) => ({
      title: g,
      args: ARGS.filter((a) => a.group === g && !on.value.has(a.flag) && match(a)),
      clusters: CLUSTERS.filter(
        (c) => c.group === g && (!query.value || c.flags.some((f) => f.includes(query.value)))
      )
    }))
  ].filter((g) => g.args.length || g.clusters.length)
})

/** The dropdowns, two to a row (Desktop's order). */
const FIELDS = computed(() => [
  {
    key: 'security' as const,
    label: 'Manager Security Level',
    options: SECURITY,
    hint: SECURITY.find((s) => s.value === set.security)!.hint
  },
  {
    key: 'network' as const,
    label: 'Manager Network Mode',
    options: NETWORK,
    hint: NETWORK.find((s) => s.value === set.network)!.hint
  },
  {
    key: 'mode' as const,
    label: 'Launch Mode',
    options: LAUNCH_MODES,
    hint: 'Where ComfyUI opens: its own app window, or only the console.'
  },
  {
    key: 'partition' as const,
    label: 'Browser Cache',
    options: PARTITIONS,
    hint: 'Share the browser cache (logins, settings) with other builds, or keep one for this build.'
  },
  {
    key: 'portConflict' as const,
    label: 'If Port is Busy',
    options: PORT_CONFLICT,
    hint: 'What happens when another app already uses the port.'
  }
])

// A change while it runs waits for a restart.
watch(
  () => [set.args, set.mode, set.partition, set.security, set.network, set.portConflict],
  () => {
    if (state.run === 'running') state.restart = true
  }
)
</script>

<template>
  <div class="mar-bt-folders">
    <BuildBlock title="Launch settings" bare>
      <div class="mar-args-field is-wide">
        <span class="mar-args-label"
          >Startup arguments
          <Tooltip content="Passed to ComfyUI as it starts."
            ><Info :size="12" class="text-subtle-foreground" /></Tooltip
        ></span>
        <Input
          v-model="set.args"
          mono
          class="mar-args-input"
          placeholder="No arguments set"
          aria-label="Startup arguments"
        >
          <template #trailing>
            <Tooltip content="Every flag ComfyUI takes">
              <button
                type="button"
                class="mar-args-gear"
                :class="flagsOpen && 'is-on'"
                :aria-expanded="flagsOpen"
                aria-label="Edit flags"
                @click.prevent="flagsOpen = !flagsOpen"
              >
                <Settings2 :size="14" />
              </button>
            </Tooltip>
          </template>
        </Input>
      </div>

      <!-- The gear: every flag, grouped and searchable, set ones on top. -->
      <div v-if="flagsOpen" class="mar-args-flags is-wide">
        <div class="mar-args-search">
          <Input v-model="query" placeholder="Search arguments" aria-label="Search arguments">
            <template #leading><Search :size="14" class="text-subtle-foreground" /></template>
            <template v-if="query" #trailing>
              <button type="button" aria-label="Clear search" @click.prevent="query = ''">
                <X :size="13" />
              </button>
            </template>
          </Input>
        </div>
        <p v-if="!groups.length" class="mar-args-none">No arguments match your search.</p>
        <div v-for="g in groups" :key="g.title" class="mar-args-group">
          <p class="mar-args-title">{{ g.title }}</p>
          <div v-for="c in g.clusters" :key="c.flags[0]" class="mar-args-row">
            <div class="min-w-0 flex-1">
              <p class="mar-args-choose">Choose one: {{ c.flags.join(' / ') }}</p>
            </div>
            <Select
              :model-value="chosen(c)"
              :options="options(c)"
              class="w-48"
              @update:model-value="choose(c, $event as string)"
            />
          </div>
          <div v-for="a in g.args" :key="a.flag" class="mar-args-row">
            <div class="min-w-0 flex-1">
              <code class="mar-args-flag">{{ a.flag }}</code>
              <p class="mar-args-help">{{ a.help }}</p>
              <Input
                v-if="a.value && on.has(a.flag)"
                :model-value="on.get(a.flag)"
                mono
                :placeholder="a.value"
                class="mt-2 max-w-72"
                :aria-label="`${a.flag} value`"
                @update:model-value="setValue(a.flag, String($event))"
              />
            </div>
            <Switch
              :model-value="on.has(a.flag)"
              :aria-label="a.flag"
              @update:model-value="toggle(a.flag, $event)"
            />
          </div>
        </div>
      </div>

      <!-- The dropdowns, two to a row. -->
      <div v-for="f in FIELDS" :key="f.key" class="mar-args-field">
        <span class="mar-args-label"
          >{{ f.label }}
          <Tooltip :content="f.hint"><Info :size="12" class="text-subtle-foreground" /></Tooltip
        ></span>
        <Select
          v-model="set[f.key]"
          :options="f.options"
          :aria-label="f.label"
          class="mar-args-input"
        />
      </div>
    </BuildBlock>
  </div>
</template>

<style>
/* Two to a row; the arguments and the flags take the whole row. */
.mar-bb-body.is-bare:has(.mar-args-field) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}
.mar-args-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.mar-args-field.is-wide,
.mar-args-flags.is-wide {
  grid-column: 1 / -1;
}
.mar-args-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .mar-args-input {
  height: 40px;
  border-radius: 8px;
}
:root .proto-ui.proto-ui.proto-ui .mar-args-gear {
  display: inline-flex;
  padding: 4px;
  border-radius: 6px;
  color: var(--color-subtle-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-args-gear:hover,
:root .proto-ui.proto-ui.proto-ui .mar-args-gear.is-on {
  color: var(--color-base-foreground);
}
.mar-args-flags {
  padding: 4px 16px 12px;
  border-radius: 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
@media (max-width: 640px) {
  .mar-bb-body.is-bare:has(.mar-args-field) {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
