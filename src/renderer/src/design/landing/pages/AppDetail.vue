<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowUpRight,
  ChevronLeft,
  Clock,
  Globe,
  Copy,
  KeyRound,
  Link2,
  Lock,
  Play,
  Plus,
  RotateCcw,
  UserX,
  Wallet,
  EllipsisVertical,
  Rocket,
  Sparkles,
  Users,
  Waypoints
} from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import Badge from '../ui/Badge.vue'
import Button from '../ui/Button.vue'
import DropdownMenuContent from '../ui/DropdownMenuContent.vue'
import DropdownMenuItem from '../ui/DropdownMenuItem.vue'
import Meter from '../ui/Meter.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import Sparkline from '../ui/Sparkline.vue'
import Switch from '../ui/Switch.vue'
import Tabs from '../ui/Tabs.vue'
import MemberAvatar from '../parts/MemberAvatar.vue'
import AppRunPanel from '../parts/apps/AppRunPanel.vue'
import PreviewAsMenu from '../parts/apps/PreviewAsMenu.vue'
import { thumb } from '../mock'
import { go, hostActions, instanceById, toast } from '../useProto'
import {
  accessLabel,
  openAppUrl,
  copyLink,
  dialogs,
  libApp,
  payerLabel,
  startFromName,
  usd,
  type FieldKind,
  type LibApp
} from '../appFlow'

/**
 * One app, one page. Everyone gets Run; the line under it says who pays.
 * The creator also gets Activity, Access, Versions and API.
 */
const { id } = defineProps<{ id: string }>()
// The store's record (ModePages keys this page by id).
const app: LibApp = libApp(id)!
const yours = computed(() => app.group === 'yours')
type Tab = 'run' | 'activity' | 'access' | 'versions' | 'api'
const tab = ref<Tab>('run')

const payer = computed(() => {
  if (app.group === 'shared') return `About ${usd(app.cost)} a run, from your credits`
  if (app.group === 'team') return 'Paid by Silverside · team credits · 38 runs left this month'
  if (app.state === 'draft') return 'Paid by you while it is a draft'
  return app.team ? 'Paid by Silverside · team credits' : 'Paid by you'
})
const spentThisMonth = computed(() => app.history.reduce((n, r) => n + r.cost, 0) * 31)

// Soft, washed-out accents: color only where it means something.
const TINT = {
  green: 'bg-[oklch(0.78_0.15_155/0.14)] text-[oklch(0.86_0.11_155)]',
  blue: 'bg-[oklch(0.72_0.13_250/0.16)] text-[oklch(0.85_0.08_250)]',
  violet: 'bg-[oklch(0.7_0.15_290/0.16)] text-[oklch(0.84_0.09_290)]',
  amber: 'bg-[oklch(0.82_0.14_80/0.14)] text-[oklch(0.88_0.1_85)]'
} as const
type Tint = keyof typeof TINT
const seed = [...id].reduce((n, c) => n + c.charCodeAt(0), 0)
const trend = Array.from({ length: 14 }, (_, i) => 20 + ((seed * (i + 3)) % 40) + i * 2)
const STATS = computed<
  { label: string; value: string; icon: unknown; tint: Tint; trend?: boolean }[]
>(() => [
  {
    label: 'Runs',
    value: app.runs.toLocaleString('en-US'),
    icon: Play,
    tint: 'green',
    trend: true
  },
  { label: 'Cost this month', value: usd(spentThisMonth.value), icon: Wallet, tint: 'amber' },
  {
    label: 'People',
    value: String(app.people.length + (app.team ? 8 : 0) + 1),
    icon: Users,
    tint: 'blue'
  },
  { label: 'Average run', value: '18 s', icon: Clock, tint: 'violet' }
])
const paidTint = (by: string): Tint =>
  by.startsWith('Team') ? 'green' : by.includes('free') ? 'violet' : 'blue'
const LOOKS = [
  'contrast(1.12) saturate(1.15)',
  'sepia(0.35) saturate(1.35) hue-rotate(-12deg)',
  'contrast(1.3) brightness(0.95)',
  'brightness(1.1) saturate(0.8) hue-rotate(8deg)'
]
const NOTES = [
  'Added the Golden hour preset',
  'Sharper edges with the new relight LoRA',
  'Inputs renamed in plain words',
  'First version'
]

// API
const KIND_LABEL: Record<FieldKind, string> = {
  image: 'image URL',
  text: 'text',
  choice: 'one of',
  count: 'number'
}
const KIND_TINT: Record<FieldKind, Tint> = {
  image: 'violet',
  text: 'blue',
  choice: 'amber',
  count: 'green'
}
const lang = ref<'curl' | 'python' | 'js'>('curl')
const code = computed(() => {
  const url = `https://api.comfy.org/apps/${app.slug}/runs`
  const pairs = app.fields
    .filter((f) => f.on)
    .map((f) => [
      f.id,
      f.kind === 'image'
        ? 'https://…/photo.png'
        : f.kind === 'count'
          ? 1
          : (f.options?.[0] ?? 'On a marble counter')
    ])
  const json = (indent: string): string =>
    pairs.map(([k, v]) => `${indent}"${k}": ${JSON.stringify(v)}`).join(',\n')
  if (lang.value === 'python')
    return `import requests\n\nrun = requests.post(\n    "${url}",\n    headers={"Authorization": f"Bearer {COMFY_API_KEY}"},\n    json={\n${json('        ')}\n    },\n)\nprint(run.json()["outputs"])`
  if (lang.value === 'js')
    return `const run = await fetch("${url}", {\n  method: "POST",\n  headers: { Authorization: \`Bearer \${COMFY_API_KEY}\` },\n  body: JSON.stringify({\n${json('    ')}\n  })\n})\nconsole.log((await run.json()).outputs)`
  return `curl -X POST ${url} \\\n  -H "Authorization: Bearer $COMFY_API_KEY" \\\n  -d '{\n${json('    ')}\n  }'`
})

function publishDraft(): void {
  app.state = 'live'
  toast(`${app.name} is live for only you. Share it when you are ready.`)
}
function publishUpdate(): void {
  app.version++
  app.unpublished = false
  toast(`Version ${app.version} is live. People get it on their next run.`)
}
function revokeAll(): void {
  app.link = false
  app.people = []
  app.team = false
  toast('Access revoked. Runs in progress stop. People keep their past results.')
}
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <button
      type="button"
      class="mt-8 inline-flex items-center gap-1 text-ui text-muted-foreground outline-none hover:text-base-foreground focus-visible:text-base-foreground"
      @click="go('apps')"
    >
      <ChevronLeft :size="14" />Apps
    </button>

    <header class="flex items-end justify-between gap-6 pt-5 pb-8">
      <div class="flex min-w-0 items-center gap-4">
        <img
          :src="thumb(app.thumbId)"
          alt=""
          class="aspect-[4/3] w-20 shrink-0 rounded-control border border-border-default object-cover"
        />
        <div class="min-w-0">
          <div class="flex items-center gap-2.5">
            <h1 class="truncate text-title font-semibold tracking-[-0.01em]">{{ app.name }}</h1>
            <Badge v-if="app.state === 'draft'">Draft</Badge>
            <Badge v-else variant="outline"
              ><span class="size-1.5 rounded-full bg-status-running" />Live</Badge
            >
          </div>
          <p class="mt-1 truncate text-ui text-muted-foreground">
            {{ app.blurb }} · by {{ app.owner === 'You' ? 'you' : app.owner }}
          </p>
          <!-- The app is a website: its URL, one click away -->
          <div v-if="app.state === 'live'" class="mt-2 flex items-center gap-1">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-min font-mono text-ui text-base-foreground underline decoration-border-strong underline-offset-4 outline-none hover:decoration-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
              @click="openAppUrl(app.id)"
            >
              <Globe :size="13" class="text-muted-foreground" />comfy.org/a/{{ app.slug }}
            </button>
            <Button variant="ghost" size="icon-xs" aria-label="Copy link" @click="copyLink(app)"
              ><Copy :size="12"
            /></Button>
          </div>
          <p v-else class="mt-2 text-ui text-subtle-foreground">
            No URL yet. Publish it to get one.
          </p>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <template v-if="app.state === 'live'">
          <PreviewAsMenu v-if="yours" :app-id="app.id" size="lg" />
          <Button v-if="yours" size="lg" @click="dialogs.share = app.id"
            ><Users :size="14" />Share</Button
          >
          <Button variant="primary" size="lg" class="px-5" @click="openAppUrl(app.id)"
            >Open app<ArrowUpRight :size="15"
          /></Button>
        </template>
        <Button v-else variant="primary" size="lg" @click="publishDraft"
          ><Rocket :size="14" />Publish</Button
        >
        <DropdownMenuRoot v-if="yours" :modal="false">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" aria-label="More"
              ><EllipsisVertical :size="15"
            /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-60">
            <DropdownMenuItem @select="startFromName('product-relight-studio', app.thumbId)"
              ><Sparkles :size="14" />Edit with Comfy Agent</DropdownMenuItem
            >
            <DropdownMenuItem
              @select="hostActions.launch(instanceById('local-1')!, 'product-relight-studio')"
              ><Waypoints :size="14" />Edit the workflow in ComfyUI</DropdownMenuItem
            >
          </DropdownMenuContent>
        </DropdownMenuRoot>
      </div>
    </header>

    <Tabs
      v-if="yours"
      v-model="tab"
      :options="[
        { value: 'run', label: 'Run' },
        { value: 'activity', label: 'Activity' },
        { value: 'access', label: 'Access' },
        { value: 'versions', label: 'Versions' },
        { value: 'api', label: 'API' }
      ]"
    />

    <div class="pt-8">
      <AppRunPanel
        v-if="tab === 'run' || !yours"
        :layout="app.layout"
        :fields="app.fields"
        :thumb-id="app.thumbId"
        :cost="app.cost"
        :payer
      />

      <!-- Activity: numbers first, then the latest runs as results -->
      <div v-else-if="tab === 'activity'" class="flex flex-col gap-10">
        <div class="grid grid-cols-4 gap-4">
          <div
            v-for="s in STATS"
            :key="s.label"
            class="flex flex-col gap-4 rounded-panel border border-border-default p-5"
          >
            <span class="flex items-center justify-between">
              <span
                :class="[
                  'inline-flex size-8 items-center justify-center rounded-full',
                  TINT[s.tint]
                ]"
                ><component :is="s.icon" :size="15"
              /></span>
              <Sparkline v-if="s.trend" :values="trend" :width="72" :height="24" />
            </span>
            <span>
              <span class="block text-display font-semibold tracking-[-0.03em] tabular-nums">{{
                s.value
              }}</span>
              <span class="block text-ui text-subtle-foreground">{{ s.label }}</span>
            </span>
          </div>
        </div>

        <section>
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-heading font-semibold">Latest runs</h2>
            <span class="flex items-center gap-2 text-ui text-subtle-foreground">
              <span class="relative flex size-2"
                ><span
                  class="absolute inset-0 animate-ping rounded-full bg-status-running/60" /><span
                  class="relative size-2 rounded-full bg-status-running"
              /></span>
              Updates as people run it
            </span>
          </div>
          <div
            v-if="app.history.length"
            class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4"
          >
            <div
              v-for="(r, i) in app.history"
              :key="r.who + r.when"
              class="group flex flex-col gap-3 rounded-panel border border-border-default p-2 pb-3"
            >
              <span class="relative aspect-[4/3] overflow-hidden rounded-card">
                <img
                  :src="thumb(app.thumbId)"
                  alt=""
                  class="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  :style="{ filter: LOOKS[i % LOOKS.length] }"
                />
                <span
                  class="absolute top-2 right-2 rounded-full bg-media-overlay px-2 py-0.5 text-ui tabular-nums backdrop-blur-sm"
                  >{{ usd(r.cost) }}</span
                >
              </span>
              <span class="flex items-center gap-2 px-1.5">
                <MemberAvatar :name="r.who" size="sm" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-ui">{{ r.who }}</span>
                  <span class="block text-ui text-subtle-foreground">{{ r.when }}</span>
                </span>
              </span>
              <span
                :class="[
                  'mx-1.5 self-start rounded-full px-2.5 py-0.5 text-ui',
                  TINT[paidTint(r.paidBy)]
                ]"
                >{{ r.paidBy }}</span
              >
            </div>
          </div>
          <div
            v-else
            class="flex flex-col items-center gap-2 rounded-panel border border-dashed border-border-strong py-16 text-center"
          >
            <span
              :class="['inline-flex size-10 items-center justify-center rounded-full', TINT.violet]"
              ><Play :size="16"
            /></span>
            <p class="text-heading font-semibold">No runs yet</p>
            <p class="text-ui text-subtle-foreground">
              Share the link and watch the first ones come in.
            </p>
          </div>
        </section>
      </div>

      <!-- Access: three cards, then the people -->
      <div v-else-if="tab === 'access'" class="flex flex-col gap-10">
        <div class="grid grid-cols-3 gap-4">
          <div class="flex flex-col gap-4 rounded-panel border border-border-default p-5">
            <span
              :class="['inline-flex size-9 items-center justify-center rounded-full', TINT.blue]"
            >
              <Link2 v-if="app.link" :size="16" /><Users v-else-if="app.team" :size="16" /><Lock
                v-else
                :size="16"
              />
            </span>
            <span>
              <span class="block text-ui text-subtle-foreground">Who can use it</span>
              <span class="block text-heading font-semibold">{{
                app.state === 'draft' ? 'Not published' : accessLabel(app)
              }}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              class="-ml-2 self-start"
              @click="dialogs.share = app.id"
              >Change</Button
            >
          </div>

          <div class="flex flex-col gap-4 rounded-panel border border-border-default p-5">
            <span
              :class="['inline-flex size-9 items-center justify-center rounded-full', TINT.amber]"
              ><Wallet :size="16"
            /></span>
            <span>
              <span class="block text-ui text-subtle-foreground">Who pays</span>
              <span class="block text-heading font-semibold">{{ payerLabel(app) }}</span>
            </span>
            <span
              v-if="app.payer === 'you' && (app.link || app.people.length)"
              class="flex flex-col gap-2"
            >
              <Meter :value="app.spent" :max="app.cap" />
              <span class="text-ui text-subtle-foreground"
                >{{ usd(app.spent) }} of {{ usd(app.cap) }} · {{ app.freeRuns }} free per
                person</span
              >
            </span>
            <span v-else class="text-ui text-subtle-foreground">Charged at cost, no markup.</span>
          </div>

          <div class="flex flex-col gap-4 rounded-panel border border-border-default p-5">
            <span class="flex items-start justify-between">
              <span
                :class="[
                  'inline-flex size-9 items-center justify-center rounded-full',
                  TINT.violet
                ]"
                ><UserX :size="16"
              /></span>
              <Switch v-model="app.noAccount" aria-label="Runs without an account" />
            </span>
            <span>
              <span class="block text-ui text-subtle-foreground">Runs without an account</span>
              <span class="block text-heading font-semibold">{{
                app.noAccount ? 'Allowed, inside the cap' : 'Sign in to run'
              }}</span>
            </span>
            <span class="text-ui text-subtle-foreground">Only for free runs you pay for.</span>
          </div>
        </div>

        <section>
          <div class="mb-4 flex items-center justify-between">
            <h2 class="flex items-center gap-3 text-heading font-semibold">
              People
              <span class="flex -space-x-1.5">
                <MemberAvatar
                  v-for="n in [
                    'Pablo',
                    'Jane Park',
                    'Marcus Lin',
                    ...app.people.map((p) => p.name)
                  ].slice(0, 5)"
                  :key="n"
                  :name="n"
                  size="sm"
                  class="ring-2 ring-app-background"
                />
              </span>
            </h2>
            <Button size="sm" @click="dialogs.share = app.id"><Plus :size="13" />Invite</Button>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div
              class="flex items-center gap-3 rounded-card border border-border-default px-4 py-3"
            >
              <MemberAvatar name="Pablo" size="md" />
              <span class="min-w-0 flex-1">
                <span class="block text-ui font-medium">Pablo (you)</span>
                <span class="block text-ui text-subtle-foreground">pablo@silverside.studio</span>
              </span>
              <span :class="['rounded-full px-2.5 py-0.5 text-ui', TINT.green]">Owner</span>
            </div>
            <div
              v-if="app.team"
              class="flex items-center gap-3 rounded-card border border-border-default px-4 py-3"
            >
              <span
                class="inline-flex size-7 items-center justify-center rounded-full bg-secondary-background"
                ><Users :size="13"
              /></span>
              <span class="min-w-0 flex-1">
                <span class="block text-ui font-medium">Silverside team</span>
                <span class="block text-ui text-subtle-foreground">8 people · team credits</span>
              </span>
              <span :class="['rounded-full px-2.5 py-0.5 text-ui', TINT.blue]">Can run</span>
            </div>
            <div
              v-for="p in app.people"
              :key="p.email"
              class="flex items-center gap-3 rounded-card border border-border-default px-4 py-3"
            >
              <MemberAvatar :name="p.name" size="md" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-ui font-medium">{{ p.email }}</span>
                <span class="block text-ui text-subtle-foreground">Invited · outside the team</span>
              </span>
              <span
                :class="[
                  'rounded-full px-2.5 py-0.5 text-ui',
                  p.role === 'Can edit' ? TINT.violet : TINT.blue
                ]"
                >{{ p.role }}</span
              >
            </div>
          </div>
        </section>

        <div class="flex items-center justify-between border-t border-border-default pt-5">
          <span class="text-ui text-subtle-foreground"
            >Revoking stops runs in progress. People keep their past results.</span
          >
          <Button variant="ghost" size="sm" @click="revokeAll">Revoke all access</Button>
        </div>
      </div>

      <!-- Versions: a timeline -->
      <div v-else-if="tab === 'versions'" class="relative flex flex-col gap-3 pl-9">
        <span
          class="absolute top-3 bottom-3 left-[11px] w-px bg-border-default"
          aria-hidden="true"
        />
        <div v-if="app.unpublished" class="relative">
          <span
            class="absolute top-5 -left-9 size-[23px] rounded-full border-2 border-dashed border-border-strong bg-app-background"
          />
          <div
            class="flex items-center gap-4 rounded-panel border border-dashed border-border-strong px-5 py-4"
          >
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-2 text-ui font-medium"
                >Draft<span :class="['rounded-full px-2 py-0.5 text-ui', TINT.amber]"
                  >Unpublished changes</span
                ></span
              >
              <span class="mt-0.5 block text-ui text-subtle-foreground"
                >Only you see it. People keep version {{ app.version }} until you publish.</span
              >
            </span>
            <Button size="sm" variant="ghost" @click="toast('Trying the draft')">Try it</Button>
            <Button size="sm" variant="primary" @click="publishUpdate">Publish update</Button>
          </div>
        </div>
        <div
          v-for="v in Array.from({ length: app.version }, (_, i) => app.version - i)"
          :key="v"
          class="group relative"
        >
          <span
            :class="[
              'absolute top-5 -left-9 inline-flex size-[23px] items-center justify-center rounded-full border-4 border-app-background',
              v === app.version ? 'bg-status-running' : 'bg-secondary-background-hover'
            ]"
          />
          <div
            :class="[
              'flex items-center gap-4 rounded-panel border px-5 py-4 transition-colors',
              v === app.version
                ? 'border-border-strong'
                : 'border-border-default hover:bg-secondary-background/40'
            ]"
          >
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-2 text-ui font-medium"
                >Version {{ v
                }}<span
                  v-if="v === app.version"
                  :class="['rounded-full px-2 py-0.5 text-ui', TINT.green]"
                  >Live</span
                ></span
              >
              <span class="mt-0.5 block text-ui text-muted-foreground">{{
                NOTES[(app.version - v) % NOTES.length]
              }}</span>
            </span>
            <span class="flex items-center gap-2 text-ui text-subtle-foreground">
              <MemberAvatar name="Pablo" size="sm" />{{
                v === app.version ? app.updated : `${(app.version - v) * 9} days earlier`
              }}
            </span>
            <Button
              v-if="v !== app.version"
              size="sm"
              variant="ghost"
              class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              @click="toast(`Version ${v} is live again`)"
              ><RotateCcw :size="12" />Restore</Button
            >
          </div>
        </div>
      </div>

      <!-- API: the inputs, and the request in three languages -->
      <div v-else class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-6">
        <div class="flex flex-col gap-5 rounded-panel border border-border-default p-5">
          <span>
            <span class="block text-heading font-semibold">Call it from code</span>
            <span class="mt-1 block text-ui text-muted-foreground"
              >The same app, by name. It takes only these inputs. Each call is charged to the
              workspace of the API key.</span
            >
          </span>
          <div class="flex flex-col divide-y divide-border-default">
            <div
              v-for="f in app.fields.filter((x) => x.on)"
              :key="f.id"
              class="flex items-center gap-3 py-2.5"
            >
              <span class="font-mono text-ui">{{ f.id }}</span>
              <span :class="['rounded-full px-2 py-0.5 text-[12px]', TINT[KIND_TINT[f.kind]]]">{{
                KIND_LABEL[f.kind]
              }}</span>
              <span class="ml-auto truncate text-ui text-subtle-foreground">{{ f.label }}</span>
            </div>
          </div>
          <div class="mt-auto flex gap-2">
            <Button size="sm" @click="toast('Opening API keys')"
              ><KeyRound :size="13" />API keys</Button
            >
            <Button size="sm" variant="ghost" @click="toast('Opening docs.comfy.org')">Docs</Button>
          </div>
        </div>
        <div
          class="flex min-w-0 flex-col overflow-hidden rounded-panel border border-border-default bg-black/25"
        >
          <div class="flex items-center justify-between border-b border-border-default px-3 py-2">
            <SegmentedControl
              v-model="lang"
              size="sm"
              :options="[
                { value: 'curl', label: 'cURL' },
                { value: 'python', label: 'Python' },
                { value: 'js', label: 'JavaScript' }
              ]"
            />
            <Button size="sm" variant="ghost" @click="toast('Copied the request')"
              ><Copy :size="12" />Copy</Button
            >
          </div>
          <pre
            class="overflow-x-auto p-5 font-mono text-[12.5px] leading-6 text-muted-foreground"
            >{{ code }}</pre
          >
        </div>
      </div>
    </div>
  </div>
</template>
