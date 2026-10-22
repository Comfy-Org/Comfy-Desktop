<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, LayoutGrid, Waypoints } from 'lucide-vue-next'
import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import Button from '../../ui/Button.vue'
import Checkbox from '../../ui/Checkbox.vue'
import DialogContent from '../../ui/DialogContent.vue'
import Input from '../../ui/Input.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import { cn } from '../../ui/cn'
import SpaceMark from './SpaceMark.vue'
import { allWorkflows } from '../../gallery'
import {
  ACCESS_LABEL,
  createSpace,
  deployTool,
  GPU_OPTIONS,
  REGION_OPTIONS,
  type Access,
  type Flavor,
  type Payer
} from '../../spaces'
import { go, proto, toast } from '../../useProto'
import { APPS, BRAND_SWATCHES, thumb } from '../../mock'

/**
 * New space, in five short steps. Only the name is required; the space
 * starts as a draft nobody else sees until you go live.
 */
const open = computed({
  get: () => proto.creatingSpace,
  set: (v: boolean) => (proto.creatingSpace = v)
})
const STEPS = ['Name', 'Brand', 'Tools', 'People', 'Review'] as const
const step = ref(0)

const name = ref('')
const slug = ref('')
const slugEdited = ref(false)
watch(name, (n) => {
  if (!slugEdited.value)
    slug.value = n
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
})
const color = ref(BRAND_SWATCHES[1]!)
const headline = ref('Hi {name}, what are we making today?')
const brand = computed(() => ({
  color: color.value,
  logo: { name: name.value || 'New space', mark: (name.value || 'S').charAt(0).toUpperCase() },
  headline: headline.value,
  announcement: ''
}))

// Tools: pick from apps and workflows, choose how members see each.
const TOOLS = computed(() => [
  ...APPS.map((a) => ({
    key: `app:${a.id}`,
    kind: 'app' as Flavor,
    name: a.name,
    thumbId: a.thumbId
  })),
  ...allWorkflows.value.slice(0, 4).map((w) => ({
    key: `wf:${w.name}`,
    kind: 'workflow' as Flavor,
    name: w.name,
    thumbId: w.thumbId
  }))
])
const picked = ref<Record<string, Flavor>>({})
function toggle(key: string, kind: Flavor, on: boolean): void {
  const next = { ...picked.value }
  if (on) next[key] = kind
  else delete next[key]
  picked.value = next
}

const access = ref<Access>('invite')
const payer = ref<Payer>('owner')
const invites = ref('')
const emails = computed(() => invites.value.split(/[\s,]+/).filter((e) => e.includes('@')))

const canNext = computed(() => step.value !== 0 || name.value.trim().length > 0)
function reset(): void {
  step.value = 0
  name.value = ''
  slugEdited.value = false
  picked.value = {}
  invites.value = ''
}
function create(live: boolean): void {
  const id = createSpace({
    name: name.value.trim(),
    slug: slug.value,
    color: color.value,
    headline: headline.value,
    access: access.value,
    payer: payer.value,
    invites: emails.value,
    live
  })
  for (const t of TOOLS.value.filter((x) => picked.value[x.key])) {
    deployTool(t, [id], {
      flavor: picked.value[t.key]!,
      gpu: GPU_OPTIONS[0]!.value,
      region: REGION_OPTIONS[0]!.value,
      warm: false,
      version: null
    })
  }
  toast(live ? `${name.value} is live · invites sent` : `${name.value} saved as a draft`)
  proto.creatingSpace = false
  go(`space:${id}`)
  reset()
}
const PAYERS: { value: Payer; label: string }[] = [
  { value: 'owner', label: 'You pay' },
  { value: 'split', label: 'Split' },
  { value: 'members', label: 'Members pay' }
]
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogContent size="lg" class="grid h-[600px] grid-cols-[200px_minmax(0,1fr)] p-0">
      <!-- Steps -->
      <aside class="flex flex-col gap-1 border-r border-border-default p-5">
        <DialogTitle class="mb-4 text-heading font-semibold">New space</DialogTitle>
        <button
          v-for="(s, i) in STEPS"
          :key="s"
          type="button"
          :disabled="i > 0 && !name.trim()"
          :class="
            cn(
              'flex h-8 items-center gap-2.5 rounded-control px-2 text-left text-ui text-muted-foreground outline-none hover:bg-secondary-background disabled:opacity-40',
              step === i && 'bg-secondary-background-hover text-base-foreground'
            )
          "
          @click="step = i"
        >
          <span
            :class="
              cn(
                'inline-flex size-5 items-center justify-center rounded-full border border-border-strong text-ui',
                i < step && 'border-transparent bg-base-foreground text-inverted-foreground'
              )
            "
            ><Check v-if="i < step" :size="11" /><template v-else>{{ i + 1 }}</template></span
          >{{ s }}
        </button>
        <p class="mt-auto text-ui text-subtle-foreground">
          Starts as a draft. Nobody sees it until you go live.
        </p>
      </aside>

      <section class="flex min-h-0 flex-col">
        <div class="min-h-0 flex-1 overflow-y-auto p-6">
          <!-- 1 Name -->
          <template v-if="step === 0">
            <h3 class="text-title font-semibold">Name your space</h3>
            <DialogDescription class="mt-1 text-ui text-muted-foreground">
              One per team, customer or brand.
            </DialogDescription>
            <label class="mt-6 block text-ui font-medium">Name</label>
            <Input v-model="name" placeholder="e.g. Nike" class="mt-2" />
            <label class="mt-5 block text-ui font-medium">Address</label>
            <Input v-model="slug" mono class="mt-2" @update:model-value="slugEdited = true"
              ><template #trailing
                ><span class="text-ui text-subtle-foreground">.comfy.app</span></template
              ></Input
            >
            <p class="mt-1.5 text-ui text-subtle-foreground">
              Members open the space here. You can connect your own domain later.
            </p>
          </template>

          <!-- 2 Brand -->
          <template v-else-if="step === 1">
            <h3 class="text-title font-semibold">Make it theirs</h3>
            <p class="mt-1 text-ui text-muted-foreground">You can change all of this later.</p>
            <div class="mt-6 grid grid-cols-2 gap-6">
              <div>
                <p class="mb-2 text-ui font-medium">Colour</p>
                <div class="flex flex-wrap gap-2.5">
                  <button
                    v-for="c in BRAND_SWATCHES"
                    :key="c"
                    type="button"
                    :aria-label="`Colour ${c}`"
                    :class="
                      cn(
                        'inline-flex size-8 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                        color === c &&
                          'ring-2 ring-base-foreground ring-offset-2 ring-offset-card-background'
                      )
                    "
                    :style="{ background: c }"
                    @click="color = c"
                  >
                    <Check v-if="color === c" :size="14" class="text-white" />
                  </button>
                </div>
                <p class="mt-5 mb-2 text-ui font-medium">Logo</p>
                <Button size="sm" @click="toast('Upload logo (SVG or PNG)')">Upload logo</Button>
                <p class="mt-5 mb-2 text-ui font-medium">Headline</p>
                <Input v-model="headline" />
              </div>
              <div
                class="flex flex-col items-center justify-center rounded-card border border-border-default p-6 text-center"
                :style="{
                  background: `radial-gradient(420px 220px at 50% -10%, color-mix(in srgb, ${color} 35%, transparent), transparent 70%)`
                }"
              >
                <SpaceMark :brand size="lg" />
                <p class="mt-4 text-heading font-semibold">
                  {{ headline.replaceAll('{name}', 'Maya') }}
                </p>
                <p class="mt-2 text-ui text-subtle-foreground">
                  {{ slug || 'your-space' }}.comfy.app
                </p>
              </div>
            </div>
          </template>

          <!-- 3 Tools -->
          <template v-else-if="step === 2">
            <h3 class="text-title font-semibold">Add tools</h3>
            <p class="mt-1 text-ui text-muted-foreground">
              Each gets its own endpoint. Pick how members see it. You can add more anytime.
            </p>
            <div class="mt-5 flex flex-col gap-1">
              <label
                v-for="t in TOOLS"
                :key="t.key"
                class="flex min-h-12 cursor-pointer items-center gap-3 rounded-control px-2 hover:bg-secondary-background"
              >
                <Checkbox
                  :model-value="!!picked[t.key]"
                  @update:model-value="(v: boolean) => toggle(t.key, t.kind, v)"
                />
                <img :src="thumb(t.thumbId)" alt="" class="h-8 w-11 rounded-min object-cover" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-ui font-medium">{{ t.name }}</span>
                  <span class="text-ui text-subtle-foreground">{{
                    t.kind === 'app' ? 'App' : 'Workflow'
                  }}</span>
                </span>
                <SegmentedControl
                  v-if="picked[t.key]"
                  :model-value="picked[t.key]!"
                  size="sm"
                  :options="[
                    { value: 'app', label: 'App', icon: LayoutGrid },
                    { value: 'workflow', label: 'Workflow', icon: Waypoints }
                  ]"
                  @click.prevent
                  @update:model-value="(v: Flavor) => (picked = { ...picked, [t.key]: v })"
                />
              </label>
            </div>
          </template>

          <!-- 4 People -->
          <template v-else-if="step === 3">
            <h3 class="text-title font-semibold">Who gets in, and who pays</h3>
            <p class="mt-1 text-ui text-muted-foreground">
              Everyone signs in with a Comfy account. No download - it runs in the browser.
            </p>
            <p class="mt-6 mb-2 text-ui font-medium">Access</p>
            <SegmentedControl
              v-model="access"
              variant="contained"
              :options="
                (Object.keys(ACCESS_LABEL) as Access[]).map((a) => ({
                  value: a,
                  label: ACCESS_LABEL[a]
                }))
              "
            />
            <p class="mt-5 mb-2 text-ui font-medium">Who pays for runs</p>
            <SegmentedControl v-model="payer" variant="contained" :options="PAYERS" />
            <p class="mt-1.5 text-ui text-subtle-foreground">
              {{
                payer === 'owner'
                  ? 'Runs use the space’s budget. Members never see a price.'
                  : payer === 'split'
                    ? 'You cover a monthly allowance per member, then they pay.'
                    : 'Members pay with their own Comfy credits, plus your markup.'
              }}
            </p>
            <p class="mt-5 mb-2 text-ui font-medium">Invite people</p>
            <Input v-model="invites" placeholder="maya@nike.com, tom@nike.com" />
            <p class="mt-1.5 text-ui text-subtle-foreground">
              Invites go out when the space goes live. They get a branded email with a sign-in link.
            </p>
          </template>

          <!-- 5 Review -->
          <template v-else>
            <h3 class="text-title font-semibold">Ready</h3>
            <div class="mt-5 flex items-center gap-3">
              <SpaceMark :brand size="md" />
              <div>
                <p class="text-ui font-semibold">{{ name }}</p>
                <p class="text-ui text-subtle-foreground">{{ slug }}.comfy.app</p>
              </div>
            </div>
            <dl class="mt-5 grid grid-cols-[120px_minmax(0,1fr)] gap-y-2.5 text-ui">
              <dt class="text-muted-foreground">Tools</dt>
              <dd>{{ Object.keys(picked).length || 'None yet' }}</dd>
              <dt class="text-muted-foreground">Access</dt>
              <dd>{{ ACCESS_LABEL[access] }}</dd>
              <dt class="text-muted-foreground">Who pays</dt>
              <dd>{{ PAYERS.find((p) => p.value === payer)!.label }}</dd>
              <dt class="text-muted-foreground">Invites</dt>
              <dd>{{ emails.length ? emails.join(', ') : 'None yet' }}</dd>
            </dl>
          </template>
        </div>

        <footer class="flex items-center gap-2 border-t border-border-default px-6 py-4">
          <Button v-if="step > 0" variant="ghost" @click="step--">Back</Button>
          <span class="flex-1" />
          <template v-if="step < STEPS.length - 1">
            <Button v-if="step > 1" variant="ghost" @click="step++">Skip</Button>
            <Button variant="primary" :disabled="!canNext" @click="step++">Continue</Button>
          </template>
          <template v-else>
            <Button @click="create(false)">Save as draft</Button>
            <Button variant="primary" @click="create(true)">Create and go live</Button>
          </template>
        </footer>
      </section>
    </DialogContent>
  </DialogRoot>
</template>
