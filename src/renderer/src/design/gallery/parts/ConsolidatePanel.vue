<script setup lang="ts">
import { computed } from 'vue'
import {
  ArrowRight,
  Check,
  CornerLeftUp,
  MousePointerClick,
  Sparkles,
  Undo2,
  X
} from 'lucide-vue-next'
import Badge from '../../landing/ui/Badge.vue'
import Button from '../../landing/ui/Button.vue'
import Card from '../../landing/ui/Card.vue'
import NumberField from '../../landing/ui/NumberField.vue'
import SegmentedControl from '../../landing/ui/SegmentedControl.vue'
import Select from '../../landing/ui/Select.vue'
import Switch from '../../landing/ui/Switch.vue'
import TokenChip from './TokenChip.vue'
import { rulesFor, comparable } from '../consolidate/rules'
import {
  changeCount,
  choices,
  customised,
  dontChange,
  dontMerge,
  keepers,
  keepInstead,
  mergeByHand,
  mergePicked,
  pickKeeper,
  plan,
  proposed,
  reasonsOf,
  resetRules,
  restore,
  session,
  sessionLabel,
  setRule,
  settingOf,
  skipped,
  stats,
  togglePick,
  valueChanges
} from '../consolidate/session'
import { copyAdvicePrompt } from '../consolidate/prompt'
import { toast } from '../../landing/useProto'
import { tokenByName } from '../inspect/selection'
import { usageOf } from '../inspect/usage'
import { tokenOptions } from '../tokenOptions'
import { shortName, type Token } from '../tokens'
import { valueOf } from '../tweaks'

/**
 * Consolidation, in the inspector: 1 Rules (proposed from the group's
 * tokens and usage, each one tunable), 2 Review (what stays, what merges
 * into it, value changes, and anything that needs a person). Clicking
 * tokens in the section picks them for a merge by hand.
 */
const rules = computed(() => rulesFor(session.value!.group))
const step = computed({
  get: () => session.value!.step,
  set: (s) => (session.value!.step = s)
})
const uses = (t: Token): number => usageOf(t).total
/** Values short enough to sit in a row; colors show as the chip's swatch. */
const short = (v: string): string => (v.length > 10 ? '' : v)
const picked = computed(() => choices.picked.map((n) => tokenByName(n)!))
const flagged = computed(() => [...(plan.value?.flagged.values() ?? [])].map((f) => f.token))
const live = (t: Token): boolean =>
  !plan.value?.merges.has(t.name) && !choices.manual.some((m) => m.retire.includes(t.name))
const homesFor = (t: Token) =>
  tokenOptions(t.group).filter((o) => {
    const other = tokenByName(o.value)!
    return comparable(t, other) && live(other)
  })
const absorbed = (retire: Token[]): number => retire.reduce((sum, t) => sum + uses(t), 0)

async function askAgent(): Promise<void> {
  await copyAdvicePrompt(session.value!.group, plan.value!, settingOf)
  toast('Copied - paste it into your coding agent for a merge strategy')
}
</script>

<template>
  <div v-if="plan && stats" class="flex flex-col gap-4">
    <!-- Outcome, always visible -->
    <div>
      <p class="flex items-baseline gap-2">
        <span class="text-title font-semibold tabular-nums">{{ plan.before }}</span>
        <ArrowRight :size="14" class="self-center text-subtle-foreground" />
        <span class="text-title font-semibold tabular-nums">{{ plan.after }}</span>
        <span class="text-ui text-muted-foreground">{{ sessionLabel.toLowerCase() }} tokens</span>
      </p>
      <p class="text-ui text-subtle-foreground">
        {{ plan.merges.size }} {{ plan.merges.size === 1 ? 'merge' : 'merges' }} ·
        {{ plan.sets.size }} value {{ plan.sets.size === 1 ? 'change' : 'changes' }}
        <template v-if="flagged.length">
          · {{ flagged.length }} {{ flagged.length === 1 ? 'needs' : 'need' }} your call</template
        >
      </p>
    </div>

    <!-- Unsure? Hand the whole picture to an agent. -->
    <Card variant="inset" padding="sm" class="flex flex-col items-start gap-2">
      <p class="text-ui text-muted-foreground">
        Not sure what to merge? Copy a prompt with every token, its usage and code, and paste it
        into your coding agent for a strategy.
      </p>
      <Button size="sm" @click="askAgent"><Sparkles :size="13" />Ask your agent</Button>
    </Card>

    <SegmentedControl
      v-model="step"
      variant="contained"
      size="sm"
      class="self-start"
      :options="[
        { value: 'rules', label: '1  Rules' },
        { value: 'review', label: '2  Review', count: changeCount + flagged.length }
      ]"
    />

    <!-- 1 · Rules -->
    <template v-if="step === 'rules'">
      <p class="text-ui text-muted-foreground">
        Proposed from your {{ stats.count }} {{ sessionLabel.toLowerCase() }} tokens and how often
        each is used. Turn rules on or off and tune them; the count above updates live.
      </p>
      <div class="flex flex-col">
        <div
          v-for="rule in rules"
          :key="rule.id"
          class="flex flex-col gap-1.5 border-t border-border-default py-3"
        >
          <div class="flex items-center gap-3">
            <Switch
              :model-value="settingOf(rule).on"
              :aria-label="rule.title"
              @update:model-value="(on: boolean) => setRule(rule, { on })"
            />
            <span class="flex-1 text-ui font-medium">{{ rule.title }}</span>
            <span
              v-if="settingOf(rule).on && plan.hits[rule.id]"
              class="text-ui text-muted-foreground tabular-nums"
              >{{ plan.hits[rule.id] }} {{ plan.hits[rule.id] === 1 ? 'token' : 'tokens' }}</span
            >
          </div>
          <div :class="['flex flex-col gap-2 pl-12', !settingOf(rule).on && 'opacity-50']">
            <p class="text-ui text-muted-foreground">
              {{ rule.why(stats, settingOf(rule).value) }}
            </p>
            <div v-if="rule.param" class="flex items-center gap-2">
              <span class="text-ui whitespace-nowrap text-muted-foreground">{{
                rule.param.label
              }}</span>
              <NumberField
                :model-value="settingOf(rule).value"
                :min="rule.param.min"
                :max="rule.param.max(stats)"
                :step="rule.param.step"
                :unit="rule.param.unit"
                :aria-label="`${rule.title}: ${rule.param.label}`"
                :disabled="!settingOf(rule).on"
                class="min-w-32"
                @update:model-value="(value: number) => setRule(rule, { value })"
              />
              <Button
                v-if="settingOf(rule).value !== proposed(rule).value"
                variant="link"
                size="sm"
                class="ml-auto text-ui"
                :title="`Use the proposed ${proposed(rule).value} ${rule.param.unit}`"
                @click="setRule(rule, { value: proposed(rule).value })"
                >proposed {{ proposed(rule).value }}</Button
              >
            </div>
          </div>
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <Button v-if="customised" variant="ghost" size="sm" class="self-start" @click="resetRules"
          ><Undo2 :size="13" />Back to proposed rules</Button
        >
        <Button variant="primary" block @click="step = 'review'"
          >Review {{ changeCount }} {{ changeCount === 1 ? 'change' : 'changes'
          }}<ArrowRight :size="13"
        /></Button>
      </div>
    </template>

    <!-- 2 · Review -->
    <template v-else>
      <!-- Merge by hand -->
      <Card variant="inset" padding="sm" class="flex flex-col gap-2">
        <p v-if="!picked.length" class="flex items-start gap-2 text-ui text-muted-foreground">
          <MousePointerClick :size="13" class="mt-0.5 shrink-0" />
          <span
            >Merge by hand: click tokens in the {{ sessionLabel }} section, then choose the one to
            keep.</span
          >
        </p>
        <template v-else>
          <p class="text-ui font-medium">Merge by hand</p>
          <div v-for="t in picked" :key="t.name" class="flex items-center gap-2">
            <Badge
              v-if="pickKeeper?.name === t.name"
              class="w-16 justify-center bg-(--gallery-accent)/15 text-base-foreground"
              ><Check :size="11" />Keep</Badge
            >
            <Button
              v-else
              variant="ghost"
              size="sm"
              class="h-5 w-16 px-0 text-ui"
              @click="choices.pickKeep = t.name"
              >Keep this</Button
            >
            <TokenChip :token="t" :struck="pickKeeper?.name !== t.name" class="max-w-36" />
            <span class="ml-auto text-ui text-subtle-foreground tabular-nums">{{ uses(t) }}×</span>
            <Button
              variant="ghost"
              size="icon-xs"
              :aria-label="`Unpick ${shortName(t)}`"
              @click="togglePick(t)"
              ><X :size="12"
            /></Button>
          </div>
          <div class="flex items-center gap-2 pt-1">
            <span class="flex-1 text-ui text-subtle-foreground">
              <template v-if="picked.length < 2">Pick at least one more.</template>
              <template v-else
                >{{ picked.length - 1 }} merge into
                <span class="text-base-foreground">{{ shortName(pickKeeper!) }}</span></template
              >
            </span>
            <Button variant="primary" size="sm" :disabled="picked.length < 2" @click="mergePicked"
              >Merge</Button
            >
          </div>
        </template>
      </Card>

      <p
        v-if="!changeCount && !flagged.length"
        class="flex items-center gap-2 text-ui text-muted-foreground"
      >
        <Check :size="14" class="text-status-running" />Nothing to change with these rules.
      </p>

      <!-- What stays, and what merges into it -->
      <section v-if="keepers.length" class="flex flex-col gap-2">
        <h3 class="text-ui font-semibold">Merges</h3>
        <Card v-for="g in keepers" :key="g.keep.name" class="overflow-hidden">
          <div class="flex items-center gap-2 bg-(--gallery-accent)/10 px-3 py-2">
            <span
              class="flex items-center gap-1 text-ui font-semibold tracking-wider text-(--gallery-accent) uppercase"
              ><Check :size="12" />Keep</span
            >
            <TokenChip :token="g.keep" class="max-w-40" />
            <span class="truncate font-mono text-ui text-subtle-foreground">{{
              short(plan.sets.get(g.keep.name)?.value ?? valueOf(g.keep))
            }}</span>
            <span class="ml-auto shrink-0 text-ui tabular-nums"
              >{{ uses(g.keep) }}×<span class="text-subtle-foreground">
                +{{ absorbed(g.retire) }}</span
              ></span
            >
          </div>
          <div
            v-for="t in g.retire"
            :key="t.name"
            class="flex flex-col gap-1.5 border-t border-border-default px-3 py-2"
          >
            <div class="flex items-center gap-2">
              <CornerLeftUp :size="13" class="shrink-0 text-subtle-foreground" />
              <TokenChip :token="t" struck class="max-w-40" />
              <span class="truncate font-mono text-ui text-subtle-foreground">{{
                short(valueOf(t))
              }}</span>
              <span class="ml-auto shrink-0 text-ui text-subtle-foreground tabular-nums"
                >{{ uses(t) }}×</span
              >
            </div>
            <div class="flex items-center gap-1 pl-5">
              <span class="flex min-w-0 flex-1 flex-wrap gap-1">
                <Badge v-for="r in reasonsOf(t)" :key="r" variant="outline">{{ r }}</Badge>
              </span>
              <Button
                variant="ghost"
                size="sm"
                class="h-6 px-2 text-ui"
                :title="`Keep ${shortName(t)} and merge ${shortName(g.keep)} into it`"
                @click="keepInstead(t, g.keep)"
                >Keep this</Button
              >
              <Button
                variant="ghost"
                size="icon-xs"
                :aria-label="`Don't merge ${shortName(t)}`"
                :title="`Don't merge ${shortName(t)}`"
                @click="dontMerge(t)"
                ><X :size="12"
              /></Button>
            </div>
          </div>
        </Card>
      </section>

      <!-- Value changes on tokens that stay -->
      <section v-if="valueChanges.length" class="flex flex-col gap-2">
        <h3 class="text-ui font-semibold">Value changes</h3>
        <Card class="divide-y divide-border-default overflow-hidden">
          <div
            v-for="s in valueChanges"
            :key="s.token.name"
            class="flex flex-col gap-1.5 px-3 py-2"
          >
            <div class="flex items-center gap-2">
              <TokenChip :token="s.token" class="max-w-36" />
              <span class="font-mono text-ui text-subtle-foreground"
                >{{ valueOf(s.token) }} →
                <span class="text-base-foreground">{{ s.value }}</span></span
              >
              <Button
                variant="ghost"
                size="icon-xs"
                class="ml-auto"
                :aria-label="`Don't change ${shortName(s.token)}`"
                :title="`Don't change ${shortName(s.token)}`"
                @click="dontChange(s.token)"
                ><X :size="12"
              /></Button>
            </div>
            <span class="flex flex-wrap gap-1">
              <Badge v-for="r in reasonsOf(s.token)" :key="r" variant="outline">{{ r }}</Badge>
            </span>
          </div>
        </Card>
      </section>

      <!-- Broke a rule, but no safe merge: a person decides -->
      <section v-if="flagged.length" class="flex flex-col gap-2">
        <h3 class="text-ui font-semibold">Needs your call</h3>
        <p class="-mt-1 text-ui text-muted-foreground">
          No close neighbour: merging would visibly change these. Pick a home or leave them.
        </p>
        <Card class="divide-y divide-border-default overflow-hidden">
          <div v-for="t in flagged" :key="t.name" class="flex flex-col gap-2 px-3 py-2">
            <div class="flex items-center gap-2">
              <TokenChip :token="t" class="max-w-40" />
              <span class="truncate font-mono text-ui text-subtle-foreground">{{
                short(valueOf(t))
              }}</span>
              <span class="ml-auto text-ui text-subtle-foreground tabular-nums"
                >{{ uses(t) }}×</span
              >
            </div>
            <span class="flex flex-wrap gap-1">
              <Badge v-for="r in reasonsOf(t)" :key="r" variant="outline">{{ r }}</Badge>
            </span>
            <div class="flex items-center gap-2">
              <Select
                model-value=""
                size="sm"
                label="Merge into…"
                class="flex-1"
                :options="homesFor(t)"
                @update:model-value="(v: string) => mergeByHand(tokenByName(v)!, [t])"
              />
              <Button variant="ghost" size="sm" @click="dontMerge(t)">Leave it</Button>
            </div>
          </div>
        </Card>
      </section>

      <!-- Kept out of the plan -->
      <section v-if="skipped.length" class="flex flex-col gap-2">
        <h3 class="text-ui font-semibold">Left as is</h3>
        <div class="flex flex-wrap gap-2">
          <span v-for="t in skipped" :key="t.name" class="flex items-center gap-1">
            <TokenChip :token="t" />
            <Button
              variant="ghost"
              size="icon-xs"
              :aria-label="`Put ${shortName(t)} back in the plan`"
              :title="`Put ${shortName(t)} back in the plan`"
              @click="restore(t.name)"
              ><Undo2 :size="12"
            /></Button>
          </span>
        </div>
      </section>
    </template>
  </div>
</template>
