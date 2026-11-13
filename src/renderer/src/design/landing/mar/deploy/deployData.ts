import { reactive } from 'vue'
import type { ProtoInstance } from '../../mock'

/**
 * Deploy as API, mocked in memory on Comfy's real serverless model
 * (docs.comfy.org/development/serverless):
 *
 *   Build       the environment: ComfyUI version + custom nodes + models
 *   Release     a numbered, immutable version of a build (linux / nvidia).
 *               A release is not a deployment.
 *   Deployment  an endpoint on one release, with its own GPU, region and
 *               min / max workers. Flex workers stop after 30 s idle;
 *               min 0 means cold starts and $0 while idle.
 *
 * Endpoint: https://{deployment}.run.comfy.app, `Authorization: Bearer
 * <api key>`, jobs are polled. Billing: GPU per second + model storage per
 * GB-month; deployments stop when credits run out.
 *
 * Everything below the CATALOG is a stand-in for platform.comfy.org / API
 * v2 calls. Prices, regions, availability, the plan, the job path and the
 * model sizes are placeholders, not published numbers. The modal only
 * reads `catalog`, `account`, `buildFor`, `samplesFor` and the `dep` store
 * and calls the actions at the bottom, so swapping them for the real
 * client doesn't touch the component.
 */

// ── Catalog ─────────────────────────────────────────────────────────────

export type GpuId = 'rtx6000' | 'h100' | 'b200'
export type RegionId = 'us-east' | 'us-west' | 'eu-west'

export interface Gpu {
  id: GpuId
  name: string
  memGb: number
  /** USD per second while a worker is up. Placeholder. */
  perSec: number
  regions: RegionId[]
  note: string
}

export const GPUS: Gpu[] = [
  {
    id: 'rtx6000',
    name: 'RTX 6000 PRO',
    memGb: 96,
    perSec: 0.00042,
    regions: ['us-east', 'us-west', 'eu-west'],
    note: 'Best value for image and most video'
  },
  {
    id: 'h100',
    name: 'H100',
    memGb: 80,
    perSec: 0.00076,
    regions: ['us-east', 'eu-west'],
    note: 'Faster on large video models'
  },
  {
    id: 'b200',
    name: 'B200',
    memGb: 180,
    perSec: 0.00139,
    regions: ['us-east'],
    note: 'Largest models, highest throughput'
  }
]

export const REGIONS: { id: RegionId; label: string; place: string }[] = [
  { id: 'us-east', label: 'US East', place: 'Virginia' },
  { id: 'us-west', label: 'US West', place: 'Oregon' },
  { id: 'eu-west', label: 'EU West', place: 'Netherlands' }
]

/** USD per GB-month of model storage. Placeholder. */
export const STORAGE_PER_GB_MONTH = 0.1
/** Flex workers stop after this long without jobs. */
export const IDLE_STOP_S = 30

export const gpuById = (id: GpuId): Gpu => GPUS.find((g) => g.id === id)!
export const regionById = (id: RegionId) => REGIONS.find((r) => r.id === id)!

// ── States (UI Playground › States › Deploy state) ─────────────────────

export const SCENARIOS = [
  { id: 'configure', label: 'Configure (released version)' },
  { id: 'needs-publish', label: 'Needs upload & release' },
  { id: 'uploading', label: 'Uploading (long, resumable)' },
  { id: 'release-failed', label: 'Release failed' },
  { id: 'no-capacity', label: 'No GPU capacity' },
  { id: 'insufficient-credits', label: 'Not enough credits' },
  { id: 'plan-limit', label: 'Plan limit reached' },
  { id: 'signed-out', label: 'Signed out' },
  { id: 'ready', label: 'Ready' },
  { id: 'stopped', label: 'Stopped' },
  { id: 'stopped-credits', label: 'Stopped: out of credits' },
  { id: 'updating', label: 'Updating to a new release' }
] as const
export type Scenario = (typeof SCENARIOS)[number]['id']

/** A state asked for from the UI Playground; the open modal applies it
 *  (it owns the draft) and clears it. */
export const scenarioPick = reactive({ want: null as Scenario | null })

// ── Account ─────────────────────────────────────────────────────────────

export const account = reactive({
  signedIn: true,
  balance: 42.1,
  /** Below this the modal blocks Deploy. Placeholder pre-check. */
  minBalance: 1,
  plan: { name: 'Creator', maxWorkers: 3, deployments: 2, used: 1 },
  /** Saved API keys (secret never comes back after creation). */
  keys: [{ id: 'k-laptop', name: 'laptop-dev', last4: '9c1e', created: 'Sep 14' }] as ApiKey[]
})

export interface ApiKey {
  id: string
  name: string
  last4: string
  created: string
}

// ── Build (what gets uploaded and released) ─────────────────────────────

export interface BuildModel {
  name: string
  gb: number
  /** Already in your Comfy storage from an earlier release. */
  stored: boolean
}
export interface BuildInfo {
  comfy: string
  nodes: number
  models: BuildModel[]
  inputs: Record<string, string | number>
  /** What a test run returns. */
  output: 'image' | 'video'
}

const BUILDS: Record<string, BuildInfo> = {
  'local-1': {
    comfy: '0.37.4',
    nodes: 9,
    models: [
      { name: 'qwen_image_edit_2511_fp8', gb: 20.4, stored: true },
      { name: 'qwen_2.5_vl_7b_fp8', gb: 9.38, stored: true },
      { name: 'qwen_image_vae', gb: 0.25, stored: true },
      { name: 'seedvr2_ema_3b_fp8', gb: 3.39, stored: true },
      { name: 'product_photo_v3 (LoRA)', gb: 0.42, stored: false }
    ],
    inputs: {
      prompt: 'white sneaker on a marble plinth, soft daylight',
      product_image: 'https://example.com/sneaker.png',
      seed: 42
    },
    output: 'image'
  },
  'local-video': {
    comfy: '0.38.0-dev',
    nodes: 14,
    models: [
      { name: 'wan2.2_i2v_high_noise_14B_fp8', gb: 14.3, stored: false },
      { name: 'wan2.2_i2v_low_noise_14B_fp8', gb: 14.3, stored: false },
      { name: 'umt5_xxl_fp8', gb: 6.74, stored: false },
      { name: 'ltx-2.5-distilled', gb: 11.2, stored: false },
      { name: 'wan_2.1_vae', gb: 0.25, stored: false }
    ],
    inputs: {
      image: 'https://example.com/terraces.png',
      prompt: 'slow drone push over rice terraces at dawn',
      frames: 81
    },
    output: 'video'
  },
  'local-flux': {
    comfy: '0.37.2',
    nodes: 4,
    models: [
      { name: 'flux1-dev-fp8', gb: 17.2, stored: false },
      { name: 't5xxl_fp8', gb: 4.89, stored: false },
      { name: 'ae', gb: 0.33, stored: false }
    ],
    inputs: { prompt: 'a lighthouse in fog, 35mm film', width: 1024, height: 1024 },
    output: 'image'
  }
}

const FALLBACK: BuildInfo = {
  comfy: '0.37.4',
  nodes: 6,
  models: [{ name: 'model.safetensors', gb: 6.5, stored: true }],
  inputs: { prompt: 'a red fox in snow' },
  output: 'image'
}

export const buildFor = (e: ProtoInstance): BuildInfo => BUILDS[e.id] ?? FALLBACK

/** What a release of this version still has to upload (models already in
 *  storage are skipped). Placeholder for the platform's dedupe. */
export function uploadFor(b: BuildInfo, released: boolean) {
  const all = b.models.reduce((s, m) => s + m.gb, 0)
  const fresh = released ? [] : b.models.filter((m) => !m.stored)
  const gb = fresh.reduce((s, m) => s + m.gb, 0)
  return {
    allGb: all,
    gb,
    fresh,
    skipped: released ? b.models.length : b.models.length - fresh.length
  }
}

// ── Money ───────────────────────────────────────────────────────────────

export const perHour = (g: Gpu): number => g.perSec * 3600
export const fmtUsd = (n: number, digits = 2): string =>
  n === 0
    ? '$0'
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
export const fmtGb = (gb: number): string =>
  gb < 1 ? `${Math.round(gb * 1000)} MB` : `${gb.toFixed(1)} GB`

// ── Request samples (prefilled with the build's workflow inputs) ────────

export type SampleLang = 'curl' | 'python' | 'ts'

/** The job path is a placeholder until it's checked against
 *  api-reference/v2; the host, auth header and polling are the real model. */
export function samplesFor(name: string, b: BuildInfo): Record<SampleLang, string> {
  const url = `https://${name}.run.comfy.app`
  const json = JSON.stringify({ inputs: b.inputs }, null, 2)
  const py = Object.entries(b.inputs)
    .map(([k, v]) => `        "${k}": ${JSON.stringify(v)},`)
    .join('\n')
  const ts = Object.entries(b.inputs)
    .map(([k, v]) => `      ${k}: ${JSON.stringify(v)},`)
    .join('\n')
  return {
    curl: `curl ${url}/jobs \\
  -H "Authorization: Bearer $COMFY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${json.replace(/\n/g, '\n  ')}'

# Returns {"id": "job_…"}. Poll it:
curl ${url}/jobs/$JOB_ID \\
  -H "Authorization: Bearer $COMFY_API_KEY"`,
    python: `import os, time, requests

URL = "${url}"
HEADERS = {"Authorization": f"Bearer {os.environ['COMFY_API_KEY']}"}

job = requests.post(
    f"{URL}/jobs",
    headers=HEADERS,
    json={
      "inputs": {
${py}
      }
    },
).json()

while (res := requests.get(f"{URL}/jobs/{job['id']}", headers=HEADERS).json())["status"] not in ("completed", "failed"):
    time.sleep(1)

print(res["outputs"])`,
    ts: `const URL = "${url}";
const headers = {
  Authorization: \`Bearer \${process.env.COMFY_API_KEY}\`,
  "Content-Type": "application/json",
};

const job = await fetch(\`\${URL}/jobs\`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    inputs: {
${ts}
    },
  }),
}).then((r) => r.json());

let res;
do {
  await new Promise((r) => setTimeout(r, 1000));
  res = await fetch(\`\${URL}/jobs/\${job.id}\`, { headers }).then((r) => r.json());
} while (res.status !== "completed" && res.status !== "failed");

console.log(res.outputs);`
  }
}

// ── The deployment flow (one at a time, in memory) ──────────────────────

export type Phase = 'configure' | 'progress' | 'live'
export type Step = 'upload' | 'release' | 'provision' | 'ready'
export type LiveStatus = 'ready' | 'stopped' | 'stopped-credits' | 'updating'

export interface Draft {
  envId: string
  version: string
  name: string
  gpu: GpuId
  region: RegionId
  min: number
  max: number
}

export const dep = reactive({
  scenario: 'configure' as Scenario,
  phase: 'configure' as Phase,
  /** Pairs with no capacity right now (`${gpu}@${region}`). */
  full: [] as string[],
  draft: null as Draft | null,
  /** Progress */
  steps: [] as Step[],
  step: 'upload' as Step,
  uploadGb: 0,
  uploadedGb: 0,
  paused: false,
  failed: false,
  /** 0..1 within the current non-upload step. */
  stepP: 0,
  logs: [] as string[],
  /** Live */
  status: 'ready' as LiveStatus,
  release: '',
  nextRelease: '',
  key: null as null | { id: string; name: string; secret?: string; last4: string },
  test: 'idle' as 'idle' | 'running' | 'done',
  testMs: 0,
  stoppedAt: '',
  /** false: "Release only" (no deployment at the end). */
  deploying: true,
  /** Versions released during this session (`envId:version`). */
  released: [] as string[]
})

let timer: ReturnType<typeof setInterval> | undefined
export function stopTimer(): void {
  clearInterval(timer)
  timer = undefined
}

const RELEASE_LOG = (v: string, b: BuildInfo, gpu: string): string[] => [
  `release ${v}: target linux/nvidia`,
  `resolving ComfyUI ${b.comfy}`,
  `installing ${b.nodes} custom nodes from the build lockfile`,
  `  ✓ comfyui-kjnodes 1.1.7`,
  `  ✓ comfyui-videohelpersuite 1.6.1`,
  `  ✓ comfyui_essentials 1.1.0`,
  `linking ${b.models.length} models from storage`,
  `smoke test: loading workflow graph on ${gpu}`,
  `release ${v} sealed (immutable)`
]
const FAIL_LOG = [
  `  ✗ comfyui-videohelpersuite 1.6.1`,
  `ERROR: opencv-python-headless>=4.10 conflicts with comfyui-kjnodes (opencv<4.9)`,
  `release failed after 1 m 12 s - nothing was billed for GPU time`
]

/** Start (or resume) a run of the flow from `dep.step`. */
function run(b: BuildInfo, slow = false): void {
  stopTimer()
  const d = dep.draft!
  const gpu = gpuById(d.gpu).name
  const log = RELEASE_LOG(d.version, b, gpu)
  timer = setInterval(() => {
    if (dep.paused || dep.failed) return
    if (dep.step === 'upload') {
      dep.uploadedGb = Math.min(
        dep.uploadGb,
        dep.uploadedGb + dep.uploadGb * (slow ? 0.0008 : 0.02)
      )
      if (dep.uploadedGb >= dep.uploadGb) next()
      return
    }
    dep.stepP = Math.min(1, dep.stepP + 0.03)
    if (dep.step === 'release') {
      const n = Math.ceil(dep.stepP * log.length)
      while (dep.logs.length < n) dep.logs.push(log[dep.logs.length]!)
    }
    if (dep.step === 'provision' && dep.stepP > 0.3 && dep.logs.at(-1) !== 'endpoint registered')
      dep.logs.push(
        `deployment ${d.name}: ${gpu} in ${regionById(d.region).label}`,
        'endpoint registered'
      )
    if (dep.stepP >= 1) next()
  }, 60)
}

function next(): void {
  const i = dep.steps.indexOf(dep.step)
  if (dep.step === 'release') dep.released.push(`${dep.draft!.envId}:${dep.draft!.version}`)
  dep.stepP = 0
  dep.step = dep.steps[i + 1] ?? 'ready'
  if (dep.step === 'ready') {
    stopTimer()
    if (!dep.deploying) {
      dep.phase = 'configure'
      return
    }
    dep.phase = 'live'
    dep.status = 'ready'
    dep.release = dep.draft!.version
  }
}

export function startDeploy(d: Draft, b: BuildInfo, needsRelease: boolean, deploy = true): void {
  const up = uploadFor(b, !needsRelease)
  dep.draft = { ...d }
  dep.deploying = deploy
  dep.phase = 'progress'
  dep.steps = [
    ...(needsRelease && up.gb > 0 ? (['upload'] as Step[]) : []),
    ...(needsRelease ? (['release'] as Step[]) : []),
    ...(deploy ? (['provision'] as Step[]) : []),
    'ready'
  ]
  dep.step = dep.steps[0]!
  dep.uploadGb = up.gb
  dep.uploadedGb = 0
  dep.paused = false
  dep.failed = false
  dep.stepP = 0
  dep.logs = []
  dep.test = 'idle'
  run(b)
}

export function togglePause(): void {
  dep.paused = !dep.paused
}

export function retryRelease(b: BuildInfo): void {
  dep.failed = false
  dep.step = 'release'
  dep.stepP = 0
  dep.logs = []
  run(b)
}

export function setLive(status: LiveStatus): void {
  dep.status = status
}

export function createKey(name: string): void {
  const hex = Array.from(
    { length: 32 },
    () => '0123456789abcdef'[Math.floor(Math.random() * 16)]
  ).join('')
  const k = { id: `k-${Date.now()}`, name, last4: hex.slice(-4), created: 'Just now' }
  account.keys.unshift(k)
  dep.key = { ...k, secret: `comfy_sk_${hex}` }
}
export function selectKey(id: string): void {
  const k = account.keys.find((x) => x.id === id)
  if (k) dep.key = { id: k.id, name: k.name, last4: k.last4 }
}
/** The secret is shown once; after this only the last four remain. */
export function forgetSecret(): void {
  if (dep.key) dep.key = { ...dep.key, secret: undefined }
}

export function testRun(): void {
  dep.test = 'running'
  const t0 = Date.now()
  setTimeout(() => {
    dep.test = 'done'
    dep.testMs = 6200 + ((Date.now() - t0) % 900)
  }, 1400)
}

/** Put the whole flow in one of the states, with believable data. The
 *  modal calls this on open and when the UI Playground picks a state. */
export function applyScenario(s: Scenario, draft: Draft, b: BuildInfo): void {
  stopTimer()
  dep.scenario = s
  account.signedIn = s !== 'signed-out'
  account.balance = s === 'insufficient-credits' ? 0.35 : s === 'stopped-credits' ? 0 : 42.1
  account.plan.used = s === 'plan-limit' ? 2 : 1
  dep.full = s === 'no-capacity' ? ['h100@us-east'] : []
  dep.draft = { ...draft }
  dep.deploying = true
  dep.failed = false
  dep.paused = false
  dep.test = 'idle'
  dep.logs = []
  dep.key = null
  dep.release = draft.version
  dep.nextRelease = ''
  if (s === 'uploading' || s === 'release-failed') {
    const up = uploadFor(b, false)
    dep.phase = 'progress'
    dep.steps = ['upload', 'release', 'provision', 'ready']
    dep.uploadGb = up.gb
    if (s === 'uploading') {
      dep.step = 'upload'
      dep.uploadedGb = up.gb * 0.41
      run(b, true)
    } else {
      dep.step = 'release'
      dep.uploadedGb = up.gb
      dep.stepP = 0.62
      dep.failed = true
      dep.logs = [
        ...RELEASE_LOG(draft.version, b, gpuById(draft.gpu).name).slice(0, 5),
        ...FAIL_LOG
      ]
    }
    return
  }
  if (s === 'ready' || s === 'stopped' || s === 'stopped-credits' || s === 'updating') {
    dep.phase = 'live'
    dep.status = s
    dep.stoppedAt =
      s === 'stopped-credits' ? 'Oct 28, 14:02' : s === 'stopped' ? 'Yesterday, 18:40' : ''
    if (s === 'updating') {
      dep.release = 'v3'
      dep.nextRelease = 'v4'
      dep.stepP = 0.55
    }
    if (s === 'ready') selectKey('k-laptop')
    return
  }
  dep.phase = 'configure'
}
