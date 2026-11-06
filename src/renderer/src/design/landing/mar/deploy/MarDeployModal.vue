<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Eye,
  KeyRound,
  Loader,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCw,
  Square,
  Upload,
  X
} from 'lucide-vue-next'
import MarSpin from '../brand/MarSpin.vue'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import InstanceGlyph from '../../parts/InstanceGlyph.vue'
import { envById, isPublished, versionsOf } from '../../parts/env/env'
import type { EnvVersion } from '../../mock'
import { PORTAL_TO } from '../../ui/portal'
import { goIn, hostActions, proto, toast } from '../../useProto'
import { ComfyModel, ComfyNode } from '../icons/comfyIcons'
import sample from '../templateModal/angles-output.jpg'
import {
  GPUS,
  IDLE_STOP_S,
  REGIONS,
  STORAGE_PER_GB_MONTH,
  account,
  applyScenario,
  buildFor,
  createKey,
  dep,
  fmtGb,
  fmtUsd,
  forgetSecret,
  gpuById,
  perHour,
  regionById,
  retryRelease,
  samplesFor,
  scenarioPick,
  selectKey,
  setLive,
  startDeploy,
  stopTimer,
  testRun,
  togglePause,
  uploadFor,
  type Draft,
  type GpuId,
  type RegionId,
  type SampleLang,
  type Scenario
} from './deployData'
import MarSeg from '../pages/MarSeg.vue'
import './deploy.css'

/**
 * Mar's "Deploy as API", on Comfy's real model: a deployment runs one
 * immutable release of a build on its own GPU, region and min / max
 * workers, behind https://{name}.run.comfy.app. A version that only exists
 * on this computer is uploaded and released first, as its own visible step.
 * After Deploy the modal follows the run (upload → release → provision)
 * and ends on what you need to call it: endpoint, API key, a request, a
 * test run. All mocked in deployData.ts.
 *
 * Open questions for the team:
 * - Native deploy here, or hand off to platform.comfy.org like
 *   ComfyUI_frontend's "Deploy to Comfy API" card does today?
 * - Model upload: are models deduped across releases (we show "already in
 *   storage, skipped"), and what does storage cost per GB-month?
 * - No stages: one deployment = one endpoint. Is "staging" just a second
 *   deployment with another name, or do we need aliases / promote?
 * - Defaults: min 0 (cold starts), max 1-3, cheapest GPU that fits the
 *   build's VRAM, nearest region?
 * - Where do API keys live (account, workspace, per deployment) and can
 *   one key be scoped to one deployment?
 * - Credits pre-check: block below a minimum balance, or warn and let the
 *   deployment stop when credits run out?
 * - Updating to a new release: does the old release keep serving until
 *   the new one is up (no downtime)?
 */

const open = computed({
  get: () => Boolean(proto.deploying),
  set: (v) => {
    if (!v) proto.deploying = null
  }
})
const env = computed(() => (proto.deploying ? envById(proto.deploying) : undefined))
const versions = computed<EnvVersion[]>(() => {
  const v = env.value ? versionsOf(env.value) : []
  return v.length
    ? v
    : [{ id: 'v1', label: 'v1', note: 'Current build', when: 'Today', published: true }]
})
const build = computed(() => (env.value ? buildFor(env.value) : undefined))

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const draft = ref<Draft>({
  envId: '',
  version: 'v1',
  name: '',
  gpu: 'rtx6000',
  region: 'us-east',
  min: 0,
  max: 2
})

const isReleased = (v: EnvVersion): boolean =>
  Boolean(env.value) &&
  ((v.published && isPublished(env.value!)) || dep.released.includes(`${env.value!.id}:${v.id}`))
const version = computed(() => versions.value.find((v) => v.id === draft.value.version))
const needsRelease = computed(() => Boolean(version.value && !isReleased(version.value)))
const upload = computed(() =>
  build.value ? uploadFor(build.value, !needsRelease.value) : undefined
)
/** The files a release uploads, folded until asked for. */
const showModels = ref(false)
watch(
  () => draft.value.version,
  () => (showModels.value = false)
)

// ── Scenarios: UI Playground › States › Deploy state ────────────────────

/** Which build and version each state is shown on. */
function sourceFor(s: Scenario): { envId: string; version: string } | undefined {
  if (s === 'needs-publish' || s === 'uploading' || s === 'release-failed')
    return { envId: 'local-video', version: 'v2' }
  if (s === 'updating') return { envId: 'local-1', version: 'v4' }
  if (s === 'configure' || s === 'no-capacity' || s === 'insufficient-credits')
    return { envId: 'local-1', version: 'v3' }
  return { envId: 'local-1', version: 'v3' }
}

/** The env a state just switched to, so the open-watch doesn't reset it. */
let applied: string | null = null
function reset(envId: string, versionId?: string): void {
  const e = envById(envId)
  draft.value = {
    envId,
    version: versionId ?? versions.value[0]?.id ?? 'v1',
    name: slug(e?.name ?? 'build'),
    gpu: 'rtx6000',
    region: 'us-east',
    min: 0,
    max: 2
  }
  lang.value = 'curl'
  keyMode.value = 'pick'
  newKeyName.value = `${draft.value.name}-key`
}

function setScenario(s: Scenario): void {
  const src = sourceFor(s)!
  if (proto.deploying !== src.envId) applied = src.envId
  proto.deploying = src.envId
  reset(src.envId, src.version)
  if (s === 'no-capacity') draft.value.gpu = 'h100'
  if (s === 'ready' || s === 'stopped' || s === 'stopped-credits' || s === 'updating')
    draft.value.max = 3
  applyScenario(s, draft.value, build.value!)
}

watch(
  () => proto.deploying,
  (id) => {
    if (!id || id === applied) {
      applied = null
      return
    }
    reset(id)
    applyScenario(needsRelease.value ? 'needs-publish' : 'configure', draft.value, build.value!)
  },
  { immediate: true }
)
onBeforeUnmount(stopTimer)
watch(open, (v) => !v && stopTimer())

// ── Configure ───────────────────────────────────────────────────────────

const gpu = computed(() => gpuById(draft.value.gpu))
const region = computed(() => regionById(draft.value.region))
const offered = (g: GpuId, r: RegionId): boolean => gpuById(g).regions.includes(r)
const isFull = (g: GpuId, r: RegionId): boolean => dep.full.includes(`${g}@${r}`)
const noCapacity = computed(() => isFull(draft.value.gpu, draft.value.region))
const altRegion = computed(() =>
  gpu.value.regions.find((r) => r !== draft.value.region && !isFull(draft.value.gpu, r))
)

function pickRegion(r: RegionId): void {
  draft.value.region = r
  if (!offered(draft.value.gpu, r)) draft.value.gpu = 'rtx6000'
}

const planMax = computed(() => account.plan.maxWorkers)
function step(k: 'min' | 'max', d: number): void {
  const v = draft.value
  if (k === 'min') v.min = Math.max(0, Math.min(v.max, v.min + d))
  else v.max = Math.max(Math.max(1, v.min), Math.min(planMax.value, v.max + d))
}

const nameOk = computed(() => /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(draft.value.name))
const hourly = computed(() => perHour(gpu.value))
const idleCost = computed(() => draft.value.min * hourly.value)
const fullCost = computed(() => draft.value.max * hourly.value)
const storageCost = computed(() => (upload.value?.allGb ?? 0) * STORAGE_PER_GB_MONTH)
const hoursLeft = computed(() => (fullCost.value ? account.balance / fullCost.value : 0))

type Blocker = { kind: string; title: string; body: string; action?: string; run?: () => void }
const blocker = computed<Blocker | undefined>(() => {
  if (!account.signedIn)
    return {
      kind: 'signed-out',
      title: 'Sign in to deploy',
      body: 'Deployments run on your Comfy account and spend its credits.',
      action: 'Sign in',
      run: () => {
        hostActions.signIn()
        account.signedIn = true
      }
    }
  if (account.plan.used >= account.plan.deployments)
    return {
      kind: 'plan',
      title: `Your ${account.plan.name} plan allows ${account.plan.deployments} deployments`,
      body: 'Both are in use. Stop or delete one, or upgrade for more.',
      action: 'Upgrade plan',
      run: () => toast('Opens plans on platform.comfy.org')
    }
  if (account.balance < account.minBalance)
    return {
      kind: 'credits',
      title: 'Not enough credits to deploy',
      body: `Your balance is ${fmtUsd(account.balance)}. A deployment stops when credits run out, so add some before it starts.`,
      action: 'Add credits',
      run: () => {
        account.balance = 50
        toast('Added $50 in credits')
      }
    }
  if (noCapacity.value)
    return {
      kind: 'capacity',
      title: `No ${gpu.value.name} free in ${region.value.label} right now`,
      body: 'Pick another region or GPU. Nothing is billed until a worker starts.'
    }
  return undefined
})

const primaryLabel = computed(() =>
  !account.signedIn ? 'Sign in to deploy' : `Deploy ${draft.value.version}`
)
const canDeploy = computed(() => !blocker.value && nameOk.value)

function confirm(deploy = true): void {
  if (blocker.value?.kind === 'signed-out') return blocker.value.run?.()
  if (!canDeploy.value || !build.value) return
  startDeploy(draft.value, build.value, needsRelease.value, deploy)
}

// ── Progress ────────────────────────────────────────────────────────────

const STEP_LABEL = {
  upload: 'Upload models',
  release: 'Build release',
  provision: 'Provision endpoint',
  ready: 'Ready'
} as const
const stepState = (s: (typeof dep.steps)[number]): 'done' | 'now' | 'failed' | 'next' => {
  const i = dep.steps.indexOf(s)
  const at = dep.steps.indexOf(dep.step)
  if (i < at) return 'done'
  if (i > at) return 'next'
  return dep.failed ? 'failed' : s === 'ready' ? 'done' : 'now'
}
const uploadP = computed(() => (dep.uploadGb ? dep.uploadedGb / dep.uploadGb : 1))
/** Mock upload speed for the time left: 25 MB/s. */
const minutesLeft = computed(() =>
  Math.max(1, Math.round(((dep.uploadGb - dep.uploadedGb) * 1000) / 25 / 60))
)
const logEl = ref<HTMLElement>()
watch(
  () => dep.logs.length,
  () => requestAnimationFrame(() => logEl.value?.scrollTo({ top: 1e6 }))
)

// ── Live ────────────────────────────────────────────────────────────────

const endpoint = computed(() => `https://${dep.draft?.name ?? draft.value.name}.run.comfy.app`)
const lang = ref<SampleLang>('curl')
const LANGS: { value: SampleLang; label: string }[] = [
  { value: 'curl', label: 'cURL' },
  { value: 'python', label: 'Python' },
  { value: 'ts', label: 'TypeScript' }
]
const samples = computed(() =>
  build.value ? samplesFor(dep.draft?.name ?? draft.value.name, build.value) : undefined
)
const keyMode = ref<'pick' | 'new'>('pick')
const newKeyName = ref('')

const STATUS = {
  ready: 'Ready',
  stopped: 'Stopped',
  'stopped-credits': 'Stopped: out of credits',
  updating: 'Updating'
} as const
const liveGpu = computed(() => gpuById(dep.draft?.gpu ?? draft.value.gpu))
const liveRegion = computed(() => regionById(dep.draft?.region ?? draft.value.region))
const workers = computed(() => `${dep.draft?.min ?? 0}–${dep.draft?.max ?? 1} workers`)

function copy(text: string, what = 'Copied'): void {
  void navigator.clipboard?.writeText(text).catch(() => {})
  toast(what)
}
function startAgain(): void {
  if (account.balance < account.minBalance) return
  setLive('ready')
  toast(`${dep.draft?.name} is starting`)
}
function topUp(): void {
  account.balance = 50
  toast('Added $50 in credits')
}
function goDeployments(what: string): void {
  toast(`Opens ${what} for ${dep.draft?.name}`)
  open.value = false
  goIn('build', 'deployments')
}

const title = computed(() => {
  if (dep.phase === 'live') return dep.draft?.name ?? draft.value.name
  if (dep.phase === 'progress')
    return dep.deploying ? `Deploying ${dep.draft?.name}` : `Releasing ${dep.draft?.version}`
  return 'Deploy as API'
})
/** Clicks in the UI Playground (and its select menus) don't close the modal. */
function keepForTuner(e: Event): void {
  const t = (e as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent?.target
  if (t instanceof Element && t.closest("[aria-label='UI tuner'], [role='listbox']"))
    e.preventDefault()
}

// UI Playground › States › Deploy state asks for a state through
// scenarioPick; the modal owns the draft, so it applies it here.
watch(
  () => scenarioPick.want,
  (s) => {
    if (!s) return
    scenarioPick.want = null
    setScenario(s)
  }
)
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal :to="PORTAL_TO" defer>
      <DialogOverlay class="proto-ui mar-dep-scrim" />
      <DialogContent
        v-if="env && build"
        class="proto-ui mar-dep"
        :data-phase="dep.phase"
        @open-auto-focus.prevent
        @interact-outside="keepForTuner"
      >
        <header class="mar-dep-head">
          <InstanceGlyph :inst="env" size="sm" />
          <div class="min-w-0">
            <DialogTitle class="mar-dep-title">{{ title }}</DialogTitle>
            <DialogDescription v-if="dep.phase === 'configure'" class="mar-dep-sub">
              Serve a release of {{ env.name }} on dedicated GPUs, behind an endpoint you call from
              code.
            </DialogDescription>
            <p v-else class="mar-dep-sub">{{ env.name }} · ComfyUI {{ build.comfy }}</p>
          </div>
        </header>

        <!-- ─── Configure ─────────────────────────────────────────── -->
        <!-- One surface, three unnumbered sections (choose a version, where
             it runs, how it's called), and a summary rail: what happens,
             then what it costs, each figure once. -->
        <div v-if="dep.phase === 'configure'" class="mar-dep-body">
          <div class="mar-dep-form" data-flat>
            <section class="mar-dep-sec">
              <header class="mar-dep-sec-head">
                <h3>Version</h3>
                <span>ComfyUI {{ build.comfy }} · {{ build.nodes }} custom nodes</span>
              </header>
              <div class="mar-dep-versions" role="radiogroup" aria-label="Version">
                <button
                  v-for="v in versions"
                  :key="v.id"
                  type="button"
                  role="radio"
                  class="mar-dep-row"
                  :aria-checked="draft.version === v.id"
                  @click="draft.version = v.id"
                >
                  <span class="mar-dep-radio" />
                  <span class="mar-dep-row-text" data-inline>
                    <b>{{ v.label }}</b>
                    <span>{{ v.note }}</span>
                    <small>{{ v.when }}</small>
                  </span>
                  <span class="mar-dep-badge" :data-tone="isReleased(v) ? 'ok' : undefined">{{
                    isReleased(v) ? 'Released' : 'On this computer'
                  }}</span>
                </button>
              </div>

              <div
                v-if="needsRelease && upload"
                class="mar-dep-release"
                :data-open="showModels || undefined"
              >
                <p class="mar-dep-release-line">
                  <Upload :size="14" />
                  <span
                    ><b>{{ draft.version }} isn't released yet.</b> Deploying uploads
                    {{ fmtGb(upload.gb) }} once<template v-if="upload.skipped">
                      ({{ upload.skipped }} already in storage)</template
                    >, then later deployments reuse it.</span
                  >
                  <button
                    type="button"
                    class="mar-dep-disclose"
                    :aria-expanded="showModels"
                    @click="showModels = !showModels"
                  >
                    {{ showModels ? 'Hide' : 'Show' }} files<ChevronDown :size="13" />
                  </button>
                </p>
                <div v-if="showModels" class="mar-dep-release-more">
                  <p class="mar-dep-release-note">
                    A release is an immutable copy of {{ draft.version }} for linux / nvidia.
                  </p>
                  <ul class="mar-dep-models">
                    <li v-for="m in build.models" :key="m.name">
                      <ComfyModel :size="13" /><span>{{ m.name }}</span
                      ><em>{{ fmtGb(m.gb) }}</em>
                      <span class="mar-dep-mark" :data-m="m.stored ? 'stored' : 'new'">{{
                        m.stored ? 'In storage' : 'Uploads'
                      }}</span>
                    </li>
                    <li>
                      <ComfyNode :size="13" /><span>{{ build.nodes }} custom nodes</span
                      ><em>lockfile</em><span class="mar-dep-mark" data-m="new">Installs</span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            <section class="mar-dep-sec">
              <header class="mar-dep-sec-head">
                <h3>Hardware</h3>
                <span>One GPU per worker</span>
              </header>
              <div class="mar-dep-seg" role="radiogroup" aria-label="Region">
                <button
                  v-for="r in REGIONS"
                  :key="r.id"
                  type="button"
                  role="radio"
                  :aria-checked="draft.region === r.id"
                  @click="pickRegion(r.id)"
                >
                  {{ r.label }}<small>{{ r.place }}</small>
                </button>
              </div>
              <div class="mar-dep-gpus" role="radiogroup" aria-label="GPU">
                <button
                  v-for="g in GPUS"
                  :key="g.id"
                  type="button"
                  role="radio"
                  class="mar-dep-gpu"
                  :aria-checked="draft.gpu === g.id"
                  :disabled="!offered(g.id, draft.region)"
                  :data-full="isFull(g.id, draft.region) || undefined"
                  @click="draft.gpu = g.id"
                >
                  <span class="mar-dep-gpu-name">{{ g.name }}</span>
                  <span class="mar-dep-gpu-price">{{ fmtUsd(perHour(g)) }}<small>/ h</small></span>
                  <span class="mar-dep-gpu-note">{{
                    !offered(g.id, draft.region)
                      ? `Not in ${region.label}`
                      : isFull(g.id, draft.region)
                        ? 'No capacity right now'
                        : `${g.memGb} GB`
                  }}</span>
                </button>
              </div>
              <div v-if="noCapacity" class="mar-dep-callout" data-tone="warn">
                <CircleAlert :size="15" />
                <span
                  >No {{ gpu.name }} is free in {{ region.label }} right now.
                  <span class="mar-dep-fixes">
                    <button v-if="altRegion" type="button" @click="draft.region = altRegion">
                      Use {{ regionById(altRegion).label }}
                    </button>
                    <button type="button" @click="draft.gpu = 'rtx6000'">Use RTX 6000 PRO</button>
                  </span></span
                >
              </div>
            </section>

            <section class="mar-dep-sec">
              <header class="mar-dep-sec-head">
                <h3>Endpoint</h3>
                <span>Workers start on demand</span>
              </header>
              <label class="mar-dep-name">
                <span class="mar-dep-input" :data-invalid="!nameOk || undefined">
                  <input
                    v-model="draft.name"
                    spellcheck="false"
                    aria-label="Deployment name"
                    @input="draft.name = draft.name.toLowerCase()"
                  /><em>.run.comfy.app</em>
                </span>
                <small v-if="!nameOk" class="mar-dep-error"
                  >3–40 lowercase letters, numbers or dashes.</small
                >
              </label>
              <div class="mar-dep-scale">
                <div class="mar-dep-stepper">
                  <span class="mar-dep-field-label">Min workers</span>
                  <span class="mar-dep-step">
                    <button
                      type="button"
                      aria-label="Fewer"
                      :disabled="draft.min <= 0"
                      @click="step('min', -1)"
                    >
                      <Minus :size="14" /></button
                    ><b>{{ draft.min }}</b
                    ><button
                      type="button"
                      aria-label="More"
                      :disabled="draft.min >= draft.max"
                      @click="step('min', 1)"
                    >
                      <Plus :size="14" />
                    </button>
                  </span>
                  <small>{{
                    draft.min === 0
                      ? 'Cold starts, nothing billed when idle'
                      : `${draft.min} always on`
                  }}</small>
                </div>
                <div class="mar-dep-stepper">
                  <span class="mar-dep-field-label">Max workers</span>
                  <span class="mar-dep-step">
                    <button
                      type="button"
                      aria-label="Fewer"
                      :disabled="draft.max <= Math.max(1, draft.min)"
                      @click="step('max', -1)"
                    >
                      <Minus :size="14" /></button
                    ><b>{{ draft.max }}</b
                    ><button
                      type="button"
                      aria-label="More"
                      :disabled="draft.max >= planMax"
                      @click="step('max', 1)"
                    >
                      <Plus :size="14" />
                    </button>
                  </span>
                  <small
                    >Up to {{ planMax }} on {{ account.plan.name }} ·
                    <button type="button" class="mar-dep-link" @click="toast('Opens plans')">
                      Upgrade
                    </button></small
                  >
                </div>
              </div>
            </section>
          </div>

          <aside class="mar-dep-side">
            <!-- Capacity shows inline under the GPUs, with its fixes. -->
            <div
              v-if="blocker && blocker.kind !== 'capacity'"
              class="mar-dep-callout"
              data-tone="block"
              :data-kind="blocker.kind"
            >
              <CircleAlert :size="15" />
              <span
                ><b>{{ blocker.title }}</b
                >{{ blocker.body }}
                <button
                  v-if="blocker.action && blocker.kind !== 'signed-out'"
                  type="button"
                  class="mar-dep-inline"
                  @click="blocker.run?.()"
                >
                  {{ blocker.action }}
                </button></span
              >
            </div>

            <section class="mar-dep-panel mar-dep-summary">
              <h3 class="mar-dep-label">What happens</h3>
              <ol class="mar-dep-plan">
                <template v-if="needsRelease && upload">
                  <li>
                    <b>Upload {{ fmtGb(upload.gb) }}</b
                    ><span>Resumable, only once</span>
                  </li>
                  <li>
                    <b>Release {{ draft.version }}</b
                    ><span>Immutable, linux / nvidia</span>
                  </li>
                </template>
                <li>
                  <b>Deploy {{ draft.version }}</b
                  ><span>{{ gpu.name }} · {{ region.label }}</span>
                </li>
                <li>
                  <b>Call it</b><span class="mar-dep-mono">{{ draft.name }}.run.comfy.app</span>
                </li>
              </ol>

              <hr />

              <h3 class="mar-dep-label">Cost</h3>
              <div class="mar-dep-hero">
                <b :data-zero="idleCost === 0 || undefined">{{ fmtUsd(idleCost) }}</b>
                <span>/ h while idle</span>
              </div>
              <dl class="mar-dep-cost">
                <dt>Each busy worker</dt>
                <dd>{{ fmtUsd(hourly) }} / h</dd>
                <dt>All {{ draft.max }} busy</dt>
                <dd>{{ fmtUsd(fullCost) }} / h</dd>
                <dt>Model storage</dt>
                <dd>{{ fmtUsd(storageCost) }} / mo</dd>
              </dl>
              <p class="mar-dep-fine">
                Per second, only while a worker is up. Workers stop {{ IDLE_STOP_S }} s after the
                last job.
              </p>
              <p v-if="account.signedIn" class="mar-dep-balance">
                <span>Balance</span><b>{{ fmtUsd(account.balance) }}</b
                ><small v-if="fullCost && account.balance >= account.minBalance"
                  >~{{ Math.floor(hoursLeft) }} h with all busy</small
                >
              </p>
            </section>
          </aside>
        </div>

        <!-- ─── Progress ──────────────────────────────────────────── -->
        <div v-else-if="dep.phase === 'progress'" class="mar-dep-body">
          <div class="mar-dep-form">
            <DialogDescription class="mar-dep-lede">
              {{
                dep.deploying
                  ? `${dep.draft?.version} on ${gpuById(dep.draft!.gpu).name} in ${regionById(dep.draft!.region).label}. You can close this window; it keeps going.`
                  : `Uploading and releasing ${dep.draft?.version}. You can close this window; it keeps going.`
              }}
            </DialogDescription>
            <ol class="mar-dep-steps">
              <li v-for="s in dep.steps" :key="s" :data-s="stepState(s)">
                <span class="mar-dep-dot">
                  <Check v-if="stepState(s) === 'done'" :size="13" />
                  <MarSpin
                    v-else-if="stepState(s) === 'now' && !dep.paused"
                    :icon="Loader"
                    :size="13"
                    spin="mar-dep-spin"
                  />
                  <Pause v-else-if="stepState(s) === 'now'" :size="12" />
                  <X v-else-if="stepState(s) === 'failed'" :size="13" />
                </span>
                <div class="mar-dep-step-body">
                  <b>{{
                    s === 'release' ? `Build release ${dep.draft?.version}` : STEP_LABEL[s]
                  }}</b>
                  <template v-if="s === 'upload'">
                    <span v-if="stepState(s) === 'done'">{{ fmtGb(dep.uploadGb) }} uploaded</span>
                    <template v-else-if="stepState(s) === 'now'">
                      <span
                        >{{ fmtGb(dep.uploadedGb) }} of {{ fmtGb(dep.uploadGb) }} ·
                        {{ dep.paused ? 'Paused' : `about ${minutesLeft} min left` }}</span
                      >
                      <span class="mar-dep-bar"><i :style="{ width: `${uploadP * 100}%` }" /></span>
                      <span class="mar-dep-resume">
                        Resumable: if you go offline or quit, it picks up where it stopped.
                        <button type="button" class="mar-dep-chip" @click="togglePause">
                          <component :is="dep.paused ? Play : Pause" :size="12" />{{
                            dep.paused ? 'Resume' : 'Pause'
                          }}
                        </button>
                      </span>
                    </template>
                    <span v-else>{{ fmtGb(dep.uploadGb) }} of models</span>
                  </template>
                  <template v-else-if="s === 'release'">
                    <span v-if="stepState(s) === 'failed'" class="mar-dep-error"
                      >A custom node dependency conflicts. Nothing was billed.</span
                    >
                    <span v-else
                      >ComfyUI {{ build.comfy }} · {{ build.nodes }} nodes · linux / nvidia</span
                    >
                    <span v-if="stepState(s) === 'failed'" class="mar-dep-fixes">
                      <button type="button" @click="retryRelease(build)">
                        <RotateCw :size="12" />Retry release
                      </button>
                      <button type="button" @click="((open = false), goIn('build', 'overview'))">
                        Open build
                      </button>
                    </span>
                  </template>
                  <span v-else-if="s === 'provision'"
                    >{{
                      dep.draft?.min
                        ? `Starting ${dep.draft.min} worker`
                        : 'No worker stays on (min 0)'
                    }}
                    · {{ regionById(dep.draft!.region).label }}</span
                  >
                  <span v-else class="mar-dep-mono">{{ endpoint }}</span>
                </div>
              </li>
            </ol>
          </div>
          <aside class="mar-dep-side">
            <section class="mar-dep-panel mar-dep-logs-panel">
              <h3 class="mar-dep-label">
                Logs<span>{{ dep.failed ? 'Failed' : dep.paused ? 'Paused' : 'Live' }}</span>
              </h3>
              <pre
                ref="logEl"
                class="mar-dep-logs"
              ><template v-if="!dep.logs.length"><span class="mar-dep-dim">{{ dep.step === 'upload' ? 'Release logs show up once the upload finishes.' : 'Waiting…' }}</span></template><span v-for="(l, i) in dep.logs" :key="i" :data-err="/ERROR|✗|failed/.test(l) || undefined">{{ l }}
</span></pre>
            </section>
          </aside>
        </div>

        <!-- ─── Live ──────────────────────────────────────────────── -->
        <div v-else class="mar-dep-body" data-live>
          <div class="mar-dep-form">
            <div class="mar-dep-status" :data-s="dep.status">
              <span class="mar-dep-pulse" />
              <b>{{ STATUS[dep.status] }}</b>
              <span class="mar-dep-badge">{{ dep.release }}</span>
              <span class="mar-dep-status-meta"
                >{{ liveGpu.name }} · {{ liveRegion.label }} · {{ workers }}</span
              >
            </div>
            <DialogDescription class="sr-only"
              >Endpoint, API key and a sample request.</DialogDescription
            >

            <div v-if="dep.status === 'stopped-credits'" class="mar-dep-callout" data-tone="block">
              <CircleAlert :size="15" />
              <span
                ><b>Stopped on {{ dep.stoppedAt }}: your credits ran out</b>Requests are rejected
                until you add credits and start it again. Model storage is kept.
                <span class="mar-dep-fixes">
                  <button v-if="account.balance < account.minBalance" type="button" @click="topUp">
                    Add credits
                  </button>
                  <button v-else type="button" @click="startAgain"><Play :size="12" />Start</button>
                </span></span
              >
            </div>
            <div v-else-if="dep.status === 'stopped'" class="mar-dep-callout">
              <Square :size="13" />
              <span
                ><b>Stopped {{ dep.stoppedAt }}</b
                >No GPU is billed while it's stopped; model storage still is.
                <span class="mar-dep-fixes"
                  ><button type="button" @click="startAgain"><Play :size="12" />Start</button></span
                ></span
              >
            </div>
            <div v-else-if="dep.status === 'updating'" class="mar-dep-callout" data-tone="info">
              <MarSpin :icon="Loader" :size="14" spin="mar-dep-spin" />
              <span
                ><b>Updating to release {{ dep.nextRelease }}</b
                >{{ dep.release }} answers requests until {{ dep.nextRelease }} is up.
                <span class="mar-dep-bar"><i :style="{ width: `${dep.stepP * 100}%` }" /></span
              ></span>
            </div>

            <section class="mar-dep-panel">
              <h3 class="mar-dep-label">Endpoint</h3>
              <div class="mar-dep-copy">
                <span class="mar-dep-mono">{{ endpoint }}</span>
                <button
                  type="button"
                  aria-label="Copy endpoint"
                  @click="copy(endpoint, 'Endpoint copied')"
                >
                  <Copy :size="14" />
                </button>
              </div>
            </section>

            <section class="mar-dep-panel">
              <h3 class="mar-dep-label">API key<span>Sent as Authorization: Bearer</span></h3>
              <template v-if="dep.key?.secret">
                <div class="mar-dep-copy" data-secret>
                  <KeyRound :size="14" />
                  <span class="mar-dep-mono">{{ dep.key.secret }}</span>
                  <button
                    type="button"
                    aria-label="Copy key"
                    @click="copy(dep.key.secret!, 'API key copied')"
                  >
                    <Copy :size="14" />
                  </button>
                </div>
                <p class="mar-dep-warn">
                  <Eye :size="13" />Copy it now. You won't be able to see it again.
                  <button type="button" class="mar-dep-chip" @click="forgetSecret">
                    I saved it
                  </button>
                </p>
              </template>
              <template v-else>
                <div class="mar-dep-keys" role="radiogroup" aria-label="API key">
                  <button
                    v-for="k in account.keys"
                    :key="k.id"
                    type="button"
                    role="radio"
                    class="mar-dep-row"
                    :aria-checked="dep.key?.id === k.id"
                    @click="(selectKey(k.id), (keyMode = 'pick'))"
                  >
                    <KeyRound :size="14" class="mar-dep-row-icon" />
                    <span class="mar-dep-row-text"
                      ><span>{{ k.name }}</span
                      ><small>Created {{ k.created }}</small></span
                    >
                    <span class="mar-dep-mono mar-dep-dim">comfy_sk_••••{{ k.last4 }}</span>
                    <span class="mar-dep-radio" />
                  </button>
                </div>
                <div v-if="keyMode === 'new'" class="mar-dep-newkey">
                  <span class="mar-dep-input"
                    ><input v-model="newKeyName" aria-label="Key name"
                  /></span>
                  <button
                    type="button"
                    class="mar-dep-chip"
                    data-strong
                    @click="createKey(newKeyName)"
                  >
                    Create
                  </button>
                </div>
                <button v-else type="button" class="mar-dep-chip" @click="keyMode = 'new'">
                  <Plus :size="12" />New API key
                </button>
              </template>
            </section>

            <section class="mar-dep-panel">
              <h3 class="mar-dep-label">Scaling</h3>
              <dl class="mar-dep-cost">
                <dt>Workers up now</dt>
                <dd>
                  {{
                    dep.status === 'ready' || dep.status === 'updating' ? (dep.draft?.min ?? 0) : 0
                  }}
                  of {{ dep.draft?.max ?? 1 }}
                </dd>
                <dt>While idle</dt>
                <dd :data-zero="!dep.draft?.min || undefined">
                  {{ fmtUsd((dep.draft?.min ?? 0) * perHour(liveGpu)) }} / h
                </dd>
                <dt>Each busy worker</dt>
                <dd>{{ fmtUsd(perHour(liveGpu)) }} / h</dd>
              </dl>
            </section>

            <nav class="mar-dep-links">
              <button type="button" @click="goDeployments('logs')">
                Logs<ArrowUpRight :size="13" />
              </button>
              <button type="button" @click="goDeployments('usage')">
                Usage<ArrowUpRight :size="13" />
              </button>
              <button type="button" @click="goDeployments('scaling')">
                Scaling<ArrowUpRight :size="13" />
              </button>
            </nav>
          </div>

          <aside class="mar-dep-side">
            <section class="mar-dep-panel mar-dep-code-panel">
              <div class="mar-dep-code-head">
                <MarSeg v-model="lang" :options="LANGS" label="Language" />
                <button
                  type="button"
                  class="mar-dep-icon-btn"
                  aria-label="Copy request"
                  @click="copy(samples![lang], 'Request copied')"
                >
                  <Copy :size="14" />
                </button>
              </div>
              <pre class="mar-dep-code">{{ samples?.[lang] }}</pre>
            </section>
            <section class="mar-dep-panel mar-dep-test">
              <div class="mar-dep-test-head">
                <span
                  ><b>Test run</b
                  ><small>{{
                    dep.status === 'ready' || dep.status === 'updating'
                      ? 'Sends the inputs above. Billed like any job.'
                      : 'Start the deployment to test it.'
                  }}</small></span
                >
                <button
                  type="button"
                  class="mar-dep-chip"
                  data-strong
                  :disabled="
                    dep.test === 'running' || !(dep.status === 'ready' || dep.status === 'updating')
                  "
                  @click="testRun"
                >
                  <MarSpin
                    v-if="dep.test === 'running'"
                    :icon="Loader"
                    :size="12"
                    spin="mar-dep-spin"
                  /><Play v-else :size="12" />{{
                    dep.test === 'running' ? (dep.draft?.min ? 'Running' : 'Cold start…') : 'Run'
                  }}
                </button>
              </div>
              <div v-if="dep.test === 'done'" class="mar-dep-result">
                <img :src="sample" alt="Test output" />
                <div>
                  <span class="mar-dep-badge" data-tone="ok">completed</span>
                  <span
                    >{{ (dep.testMs / 1000).toFixed(1) }} s ·
                    {{ fmtUsd((dep.testMs / 1000) * liveGpu.perSec, 4) }}</span
                  >
                  <code class="mar-dep-mono"
                    >outputs[0]: output_00001.{{ build.output === 'video' ? 'mp4' : 'png' }}</code
                  >
                </div>
              </div>
            </section>
          </aside>
        </div>

        <footer class="mar-dep-foot">
          <div class="mar-dep-buttons">
            <template v-if="dep.phase === 'configure'">
              <DialogClose class="mar-dep-ghost">Cancel</DialogClose>
              <button
                v-if="needsRelease && account.signedIn"
                type="button"
                class="mar-dep-secondary"
                :disabled="!canDeploy"
                @click="confirm(false)"
              >
                Release only
              </button>
              <button
                type="button"
                class="mar-dep-primary"
                data-dep-primary
                :disabled="!canDeploy && blocker?.kind !== 'signed-out'"
                @click="confirm()"
              >
                {{ primaryLabel }}
              </button>
            </template>
            <template v-else-if="dep.phase === 'progress'">
              <DialogClose class="mar-dep-ghost">{{
                dep.failed ? 'Close' : 'Keep going in background'
              }}</DialogClose>
            </template>
            <template v-else>
              <button
                v-if="dep.status === 'ready'"
                type="button"
                class="mar-dep-ghost"
                @click="(setLive('stopped'), (dep.stoppedAt = 'just now'))"
              >
                <Square :size="12" />Stop
              </button>
              <DialogClose class="mar-dep-primary">Done</DialogClose>
            </template>
          </div>
        </footer>

        <DialogClose class="mar-dep-close" aria-label="Close"><X :size="16" /></DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
