<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Search, X } from 'lucide-vue-next'
import Input from '../../ui/Input.vue'
import Select from '../../ui/Select.vue'
import SettingsRow from '../../ui/SettingsRow.vue'
import SettingsSection from '../../ui/SettingsSection.vue'
import Switch from '../../ui/Switch.vue'
import type { ProtoInstance } from '../../mock'
import { LAUNCH_MODES, NETWORK, PORT_CONFLICT, SECURITY, settingsOf, stateOf } from './buildFacts'
import './buildTabs.css'

/**
 * Desktop's Startup Args (views/comfyUISettings/ArgsBuilderPage.vue): the
 * raw arguments on top, editable, then every flag ComfyUI takes, grouped
 * and searchable, set ones pinned under Active. A flag that takes a value
 * shows its field when on; flags that exclude each other are one choice.
 * Then how it opens and ComfyUI-Manager. A change while it runs asks for
 * a restart (the header's button).
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
    help: 'Set the CUDA device this instance uses.',
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

// A change while it runs waits for a restart.
watch(
  () => [set.args, set.mode, set.security, set.network, set.portConflict],
  () => {
    if (state.run === 'running') state.restart = true
  }
)
</script>

<template>
  <div class="mar-bt-settings">
    <SettingsSection title="Startup Arguments" description="Passed to ComfyUI as it starts.">
      <div class="mar-args-raw">
        <span class="mar-bt-label">Raw arguments</span>
        <Input v-model="set.args" mono placeholder="No arguments set" aria-label="Raw arguments" />
        <span class="mar-bt-hint">Edit directly, or toggle individual flags below.</span>
      </div>
      <div class="mar-args-search">
        <Input v-model="query" placeholder="Search arguments…" aria-label="Search arguments">
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
    </SettingsSection>

    <SettingsSection title="Launch Settings" description="How ComfyUI starts and where it opens.">
      <SettingsRow label="Launch Mode" layout="inline">
        <Select v-model="set.mode" :options="LAUNCH_MODES" class="w-44" />
      </SettingsRow>
      <SettingsRow label="If Port is Busy" layout="inline">
        <Select v-model="set.portConflict" :options="PORT_CONFLICT" class="w-52" />
      </SettingsRow>
    </SettingsSection>

    <SettingsSection
      title="ComfyUI-Manager"
      description="Installs and updates node packs from inside ComfyUI."
    >
      <SettingsRow
        label="Manager Security Level"
        layout="inline"
        :hint="SECURITY.find((s) => s.value === set.security)!.hint"
      >
        <Select v-model="set.security" :options="SECURITY" class="w-52" />
      </SettingsRow>
      <SettingsRow
        label="Manager Network Mode"
        layout="inline"
        :hint="NETWORK.find((s) => s.value === set.network)!.hint"
      >
        <Select v-model="set.network" :options="NETWORK" class="w-52" />
      </SettingsRow>
    </SettingsSection>
  </div>
</template>
