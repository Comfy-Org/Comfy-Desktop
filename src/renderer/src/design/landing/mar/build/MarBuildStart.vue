<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  FileCode2,
  KeyRound,
  ListTree,
  Play,
  RotateCcw,
  Route,
  Trash2
} from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { shownCredits } from '../../account'
import { thumb } from '../../mock'
import { go, toast } from '../../useProto'
import MarPage from '../pages/MarPage.vue'
import MarSeg from '../pages/MarSeg.vue'
import MarCode from './MarCode.vue'
import {
  HOST,
  createKey,
  current,
  markCopied,
  masked,
  receive,
  resetStart,
  revokeKey,
  start,
  stepsDone,
  type Path
} from './buildStart'
import { AGENT_INSTALL, AGENT_PROMPT, SAMPLE_FILE, SAMPLE_LANG, sample } from './startSamples'
import './buildStart.css'

/**
 * Build › Get started in Mar's proposal. The title sits where every page
 * has it (MarPage), then three things in order: a first call on this
 * build (steps on the left, the code they need on the right, the live
 * listener across the foot), where to take it after (Comfy Router, Comfy
 * API, Comfy Cloud) and the account side (usage, keys, logs, docs).
 * Mocked in memory (buildStart.ts), shaped for the real backends:
 * platform.comfy.org keys, the local server, comfy-mcp.
 */

const PATHS: { value: Path; label: string }[] = [
  { value: 'agent', label: 'Coding agent' },
  { value: 'python', label: 'Python' },
  { value: 'js', label: 'JavaScript' },
  { value: 'curl', label: 'cURL' }
]
const isAgent = computed(() => start.path === 'agent')

// Code: the full key goes to the clipboard, the screen shows it masked
// unless it's revealed. No key yet: a placeholder.
const keyCopy = computed(() => start.key?.value ?? 'comfyui-YOUR_KEY')
const keyShown = computed(() =>
  start.key ? (start.revealed ? start.key.value : masked.value) : 'comfyui-YOUR_KEY'
)
const codePath = computed(() => (isAgent.value ? 'python' : start.path) as 'python' | 'js' | 'curl')

const STEP_LABEL = ['Create a key', 'Make the call', 'Watch it arrive', 'Done']
const progressLabel = computed(() =>
  current.value === 3 ? 'All set' : `Step ${current.value + 1} of 3 · ${STEP_LABEL[current.value]}`
)

const keyCopied = ref(false)
async function copyKey(): Promise<void> {
  if (!start.key) return
  try {
    await navigator.clipboard.writeText(start.key.value)
  } catch {
    // No clipboard: the confirmation still shows.
  }
  keyCopied.value = true
  setTimeout(() => (keyCopied.value = false), 1600)
}

// Where to take it next: the three hosted products, one key and one
// credit balance across them. Copy only says what each one does today.
type Product = 'router' | 'api' | 'cloud'
const product = ref<Product>('router')
const PRODUCTS: { value: Product; label: string }[] = [
  { value: 'router', label: 'Comfy Router' },
  { value: 'api', label: 'Comfy API' },
  { value: 'cloud', label: 'Comfy Cloud' }
]
const PRODUCT: Record<
  Product,
  {
    title: string
    body: string
    facts: string[]
    cta: string
    run: () => void
    thumbId: string
    tag: string
  }
> = {
  router: {
    title: 'Every model, one key.',
    body: 'Call open models and partner models through API nodes with the key from step 1. One credit balance covers them all.',
    facts: [
      'Image, video, 3D and audio models',
      'Partner models are billed per run, in credits',
      'Open models on your own GPU stay free'
    ],
    cta: 'Browse models',
    run: () => go('router'),
    thumbId: 'image_flux2~dev-one-api-key',
    tag: 'Partner and open models'
  },
  api: {
    title: 'Your workflow, as an endpoint.',
    body: 'Deploy a workflow from ComfyUI and call it over HTTPS from your app. It runs on cloud GPUs and scales with traffic.',
    facts: [
      'Deploy straight from ComfyUI',
      'Inputs and outputs from the workflow',
      'Requests, errors and spend per endpoint'
    ],
    cta: 'View deployments',
    run: () => go('deployments'),
    thumbId: 'template_product_placement~dev-your-workflow-as-an-endpoint',
    tag: 'product-shots · v2'
  },
  cloud: {
    title: 'ComfyUI on cloud GPUs.',
    body: 'The same workflows, without a local GPU or installs. Open them in the browser and share them with your team.',
    facts: [
      'Popular models ready to use',
      'Same account, same credits',
      'Nothing to install or update'
    ],
    cta: 'Open Comfy Cloud',
    run: () => toast('Opening cloud.comfy.org ↗'),
    thumbId: 'video_ltx2_5_i2v~dev-comfyui-in-the-cloud',
    tag: 'cloud.comfy.org'
  }
}
const p = computed(() => PRODUCT[product.value])

// Usage: credits are spent by API nodes and Comfy Cloud; local runs on
// your GPU are free. The balance is the account's (sidebar Credits).
const USAGE = { apiNodes: 620, cloud: 170 }
const used = USAGE.apiNodes + USAGE.cloud
const balance = computed(() => Number(String(shownCredits.value ?? '0').replace(/,/g, '')))
// The bar splits this month's spend by where it went.
const pct = (n: number): string => `${(n / used) * 100}%`

const LINKS = [
  {
    icon: KeyRound,
    title: 'API keys',
    body: 'Create, name and revoke keys',
    run: () => go('keys')
  },
  {
    icon: ListTree,
    title: 'Request log',
    body: 'Every call, its status and timing',
    run: () => go('logs')
  },
  {
    icon: Route,
    title: 'Server routes',
    body: '/prompt, /history, /view, /ws',
    run: () => toast('Opening docs.comfy.org ↗')
  },
  {
    icon: FileCode2,
    title: 'Example scripts',
    body: 'REST and WebSocket, in ComfyUI',
    run: () => toast('Opening github.com/comfyanonymous/ComfyUI ↗')
  }
]
</script>

<template>
  <MarPage title="Get started" state="live" class="mar-bs">
    <template #actions>
      <Button @click="toast('Opening docs.comfy.org ↗')">Docs<ArrowUpRight :size="14" /></Button>
    </template>

    <!-- 1 · The first call: steps left, the code they need right. -->
    <section class="mar-bs-card mar-surface" aria-labelledby="bs-first-call">
      <div class="mar-bs-card-head">
        <h2 id="bs-first-call" class="mar-bs-h2">Make your first call</h2>
        <div class="mar-bs-progress" aria-live="polite">
          <span class="text-[12px] text-muted-foreground">{{ progressLabel }}</span>
          <span class="mar-bs-progress-bars" aria-hidden="true">
            <span v-for="(d, i) in stepsDone" :key="i" :class="d && 'is-done'"><i /></span>
          </span>
        </div>
      </div>
      <div class="px-7 pt-4">
        <MarSeg v-model="start.path" :options="PATHS" label="How you work" />
      </div>

      <div class="mar-bs-split">
        <ol class="mar-bs-steps">
          <!-- 1 · Key -->
          <li
            class="mar-bs-step"
            :class="[stepsDone[0] && 'is-done', current === 0 && 'is-current']"
          >
            <span class="mar-bs-dot"
              ><Check v-if="stepsDone[0]" :size="13" /><template v-else>1</template></span
            >
            <div class="min-w-0">
              <p class="mar-bs-step-title">Create an API key</p>
              <p class="mar-bs-step-body">
                Unlocks partner models and Comfy Cloud. Open models on your GPU run without one.
              </p>
              <div v-if="start.key" class="mar-bs-key">
                <code class="mar-bs-key-value">{{
                  start.revealed ? start.key.value : masked
                }}</code>
                <button
                  type="button"
                  class="mar-bs-icon"
                  :aria-label="start.revealed ? 'Hide key' : 'Reveal key'"
                  @click="start.revealed = !start.revealed"
                >
                  <component :is="start.revealed ? EyeOff : Eye" :size="15" />
                </button>
                <button
                  type="button"
                  class="mar-bs-icon"
                  :class="keyCopied && 'is-done'"
                  :aria-label="keyCopied ? 'Copied' : 'Copy key'"
                  @click="copyKey"
                >
                  <component :is="keyCopied ? Check : Copy" :size="15" />
                </button>
                <button
                  type="button"
                  class="mar-bs-icon"
                  aria-label="Revoke key"
                  @click="revokeKey"
                >
                  <Trash2 :size="15" />
                </button>
              </div>
              <p v-if="start.key" class="mar-bs-note">
                {{ start.key.name }} · already in the code. Anyone with it can spend your credits.
              </p>
              <div v-else class="mt-3 flex items-center gap-2">
                <Button
                  :variant="start.skippedKey ? 'secondary' : 'primary'"
                  :disabled="start.creatingKey"
                  @click="createKey"
                  ><KeyRound :size="14" />{{
                    start.creatingKey ? 'Creating…' : 'Create key'
                  }}</Button
                >
                <button
                  v-if="!start.skippedKey"
                  type="button"
                  class="mar-bs-link"
                  @click="start.skippedKey = true"
                >
                  Skip, open models only
                </button>
                <span v-else class="mar-bs-note is-inline">Skipped · open models only</span>
              </div>
            </div>
          </li>

          <!-- 2 · The call, in the picked path -->
          <li
            class="mar-bs-step"
            :class="[stepsDone[1] && 'is-done', current === 1 && 'is-current']"
          >
            <span class="mar-bs-dot"
              ><Check v-if="stepsDone[1]" :size="13" /><template v-else>2</template></span
            >
            <div class="min-w-0">
              <template v-if="isAgent">
                <p class="mar-bs-step-title">Add Comfy to your agent</p>
                <p class="mar-bs-step-body">
                  comfy-mcp gives Claude Code, Cursor or Codex this ComfyUI. Run the command once,
                  then send your agent the prompt.
                </p>
                <button
                  type="button"
                  class="mar-bs-link is-flush"
                  @click="toast('Playing the launch film')"
                >
                  <Play :size="13" />Watch the 1-minute film
                </button>
              </template>
              <template v-else>
                <p class="mar-bs-step-title">Queue a workflow</p>
                <p class="mar-bs-step-body">
                  Export any workflow with Workflow › Export (API), then run the script. It posts to
                  <code class="mar-bs-inline">{{ HOST.replace('http://', '') }}</code
                  >.
                </p>
              </template>
            </div>
          </li>

          <!-- 3 · Arrival -->
          <li
            class="mar-bs-step"
            :class="[stepsDone[2] && 'is-done', current === 2 && 'is-current']"
          >
            <span class="mar-bs-dot"
              ><Check v-if="stepsDone[2]" :size="13" /><template v-else>3</template></span
            >
            <div class="min-w-0">
              <p class="mar-bs-step-title">
                {{ isAgent ? 'Watch it connect' : 'Watch it arrive' }}
              </p>
              <p class="mar-bs-step-body">
                {{
                  isAgent
                    ? 'The first time your agent starts comfy-mcp, it shows up below.'
                    : 'Every run lands in the Request log, with its prompt id and timing.'
                }}
              </p>
            </div>
          </li>
        </ol>

        <!-- The code for the picked path. -->
        <div class="mar-bs-codecol">
          <template v-if="isAgent">
            <MarCode
              v-model:picked="start.agentClient"
              :options="[
                { value: 'claude', label: 'Claude Code' },
                { value: 'json', label: 'Cursor · Claude Desktop' }
              ]"
              :copy="AGENT_INSTALL[start.agentClient]"
              :lang="start.agentClient === 'claude' ? 'bash' : 'json'"
              @copied="markCopied"
            />
            <MarCode
              :copy="AGENT_PROMPT"
              lang="text"
              label="Prompt"
              prose
              copy-label="Copy prompt"
              @copied="markCopied"
            />
          </template>
          <MarCode
            v-else
            :key="codePath"
            :copy="sample(codePath, keyCopy)"
            :shown="sample(codePath, keyShown)"
            :lang="SAMPLE_LANG[codePath]"
            :label="SAMPLE_FILE[codePath]"
            @copied="markCopied"
          />
        </div>
      </div>

      <!-- Listener: live until the first call, then the call itself. -->
      <div
        class="mar-bs-listen"
        :class="start.first ? 'is-got' : 'is-on'"
        role="status"
        aria-live="polite"
      >
        <template v-if="!start.first">
          <span class="mar-bs-pulse" />
          <span class="min-w-0 flex-1 truncate">
            {{ isAgent ? 'Waiting for your agent to connect' : 'Listening for your first request' }}
            <span class="text-subtle-foreground">
              · {{ isAgent ? 'comfy-mcp' : HOST.replace('http://', '') }}</span
            >
          </span>
          <button type="button" class="mar-bs-link" @click="receive">Check now</button>
        </template>
        <template v-else>
          <span class="mar-bs-got"><Check :size="12" :stroke-width="3" /></span>
          <span class="shrink-0 font-medium">{{
            isAgent ? 'Agent connected' : 'First request received'
          }}</span>
          <span class="mar-bs-req">
            <span class="mar-bs-method">{{ start.first.method }}</span>
            <span class="text-base-foreground">{{ start.first.path }}</span>
            <span class="truncate text-subtle-foreground">{{ start.first.detail }}</span>
            <span class="mar-bs-200">{{ start.first.status }}</span>
            <span class="text-subtle-foreground">{{ start.first.ms }} ms</span>
          </span>
          <button type="button" class="mar-bs-icon" aria-label="Start over" @click="resetStart">
            <RotateCcw :size="14" />
          </button>
          <button type="button" class="mar-bs-link" @click="go('logs')">
            Request log<ArrowRight :size="13" />
          </button>
        </template>
      </div>
    </section>

    <!-- 2 · Beyond this computer: the hosted products, one key across them. -->
    <section class="mt-12" aria-labelledby="bs-further">
      <div class="mar-bs-sec-head">
        <h2 id="bs-further" class="mar-bs-h3">Take it further</h2>
        <MarSeg v-model="product" :options="PRODUCTS" label="Product" />
      </div>
      <div class="mar-bs-product mar-surface">
        <div class="flex min-w-0 flex-col">
          <h3 class="mar-bs-h2">{{ p.title }}</h3>
          <p class="mt-2 max-w-md text-ui text-muted-foreground">{{ p.body }}</p>
          <ul class="mar-bs-facts">
            <li v-for="f in p.facts" :key="f"><Check :size="14" />{{ f }}</li>
          </ul>
          <div class="mt-auto flex gap-2 pt-6">
            <Button variant="primary" @click="p.run">{{ p.cta }}</Button>
            <Button @click="toast('Opening docs.comfy.org ↗')"
              >Docs<ArrowUpRight :size="14"
            /></Button>
          </div>
        </div>
        <div class="mar-bs-product-art">
          <img :key="p.thumbId" :src="thumb(p.thumbId)" alt="" />
          <span class="mar-bs-tag">{{ p.tag }}</span>
        </div>
      </div>
    </section>

    <!-- 3 · The account side: credits, and the pages a developer returns to. -->
    <div class="mt-12 grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-6">
      <section aria-labelledby="bs-usage">
        <div class="mar-bs-sec-head">
          <h2 id="bs-usage" class="mar-bs-h3">Usage</h2>
          <button type="button" class="mar-bs-link" @click="go('usage')">
            See usage<ArrowRight :size="13" />
          </button>
        </div>
        <div class="mar-bs-usage mar-surface">
          <div class="flex items-end justify-between gap-3">
            <div>
              <p class="text-[12px] text-muted-foreground">Credits left</p>
              <p class="mar-bs-big mt-1.5">{{ balance.toLocaleString('en-US') }}</p>
            </div>
            <Button variant="primary" @click="go('billing')">Add credits</Button>
          </div>
          <div class="mar-bs-meter" role="img" aria-label="This month's credits by product">
            <span :style="{ width: pct(USAGE.apiNodes) }" /><span
              :style="{ width: pct(USAGE.cloud) }"
            />
          </div>
          <div class="flex items-center justify-between gap-3">
            <div class="mar-bs-legend">
              <span><i />API nodes {{ USAGE.apiNodes }}</span>
              <span><i />Comfy Cloud {{ USAGE.cloud }}</span>
            </div>
            <span class="text-[12px] text-subtle-foreground">{{ used }} this month</span>
          </div>
          <p class="text-[12px] text-subtle-foreground">Runs on your GPU don't use credits.</p>
        </div>
      </section>

      <section aria-labelledby="bs-links">
        <div class="mar-bs-sec-head">
          <h2 id="bs-links" class="mar-bs-h3">Resources</h2>
        </div>
        <div class="grid grid-cols-2 gap-2.5">
          <button v-for="l in LINKS" :key="l.title" type="button" class="mar-bs-ql" @click="l.run">
            <span class="mar-bs-ql-icon"><component :is="l.icon" :size="16" /></span>
            <span class="min-w-0">
              <span class="block text-ui font-medium text-base-foreground">{{ l.title }}</span>
              <span class="block truncate text-[12px] text-muted-foreground">{{ l.body }}</span>
            </span>
            <ArrowRight :size="14" class="mar-bs-ql-arrow" />
          </button>
        </div>
      </section>
    </div>
  </MarPage>
</template>
