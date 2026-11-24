<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AppWindow,
  ArrowLeftRight,
  Check,
  ChevronRight,
  CircleCheck,
  CreditCard,
  Lock,
  Mail
} from 'lucide-vue-next'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import Avatar from '../../ui/Avatar.vue'
import Button from '../../ui/Button.vue'
import Input from '../../ui/Input.vue'
import SegmentedControl from '../../ui/SegmentedControl.vue'
import { PORTAL_TO } from '../../ui/portal'
import { WORKSPACES, type Workspace } from '../../mock'
import { can } from '../../milestones'
import { proto } from '../../useProto'
import { marUser } from '../userStates/userState'
import {
  browserSignIn,
  cancelInBrowser,
  CONSENT_PERMISSIONS,
  continueInBrowser,
  createAccount,
  DEFAULT_TOP_UP,
  FAKE_BILLING_URL,
  FAKE_CALLBACK_URL,
  FAKE_LOGIN_URL,
  FAKE_SIGNUP_URL,
  forgetNewAccount,
  goToTopUp,
  needsFirstCredits,
  NEW_ACCOUNT_WORKSPACE,
  payInBrowser,
  SIGN_UP_COPY,
  startBrowserSteps,
  TOP_UP_AMOUNTS,
  TOP_UP_COPY
} from './browserSignIn'

const picked = ref<Workspace['id']>(proto.workspaceId)
const details = ref(false)
const email = ref('')
const amount = ref(String(DEFAULT_TOP_UP))

const newUser = computed(() => can.value.onboarding && marUser.user === 'first')
const workspaces = computed(() => (newUser.value ? [NEW_ACCOUNT_WORKSPACE] : WORKSPACES))

watch(
  () => marUser.user,
  () => forgetNewAccount()
)

watch(
  () => browserSignIn.browser,
  (open) => {
    if (!open) return
    startBrowserSteps(newUser.value)
    picked.value = newUser.value ? NEW_ACCOUNT_WORKSPACE.id : proto.workspaceId
    details.value = false
    email.value = ''
    amount.value = String(DEFAULT_TOP_UP)
  }
)

const NEW_ACCOUNT_STEPS = [
  { step: 'signup', label: 'Create account' },
  { step: 'consent', label: 'Permissions' },
  { step: 'topup', label: 'Add credits' }
] as const
const showSteps = computed(() => newUser.value && browserSignIn.step !== 'paid')
const stepIndex = computed(() => NEW_ACCOUNT_STEPS.findIndex((s) => s.step === browserSignIn.step))

function approve(): void {
  if (needsFirstCredits(newUser.value)) goToTopUp()
  else continueInBrowser(picked.value)
}

const usd = (n: number | string): string => `$${n}`
const amountOptions = TOP_UP_AMOUNTS.map((n) => ({ value: String(n), label: usd(n) }))

const roleLabel = (role: string): string => role.charAt(0) + role.slice(1).toLowerCase()
const host = computed(() => {
  const step = browserSignIn.step
  const url =
    step === 'signup' ? FAKE_SIGNUP_URL : step === 'consent' ? FAKE_LOGIN_URL : FAKE_BILLING_URL
  return new URL(url).host
})
</script>

<template>
  <DialogRoot :open="browserSignIn.browser" @update:open="(v: boolean) => !v && cancelInBrowser()">
    <DialogPortal :to="PORTAL_TO" defer>
      <DialogOverlay
        class="proto-ui fixed inset-0 z-[80] bg-media-overlay backdrop-blur-[3px] data-[state=open]:animate-fade-in"
      />
      <DialogContent
        class="proto-ui mar-browser fixed top-1/2 left-1/2 z-[80] flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-panel border border-border-strong bg-content-background text-base-foreground shadow-elev outline-none data-[state=open]:animate-pop-in"
        data-testid="browser-signin"
      >
        <div
          class="flex h-10 shrink-0 items-center gap-3 border-b border-border-default bg-titlebar-background px-3"
        >
          <span class="flex gap-1.5" aria-hidden="true">
            <span class="size-3 rounded-full bg-secondary-background-hover" />
            <span class="size-3 rounded-full bg-secondary-background-hover" />
            <span class="size-3 rounded-full bg-secondary-background-hover" />
          </span>
          <span
            class="mx-auto flex h-7 w-full max-w-md items-center justify-center gap-1.5 rounded-control bg-secondary-background text-ui text-muted-foreground"
          >
            <Lock :size="12" />{{ host }}
          </span>
          <span class="w-[42px]" aria-hidden="true" />
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <div class="mx-auto flex max-w-[400px] flex-col px-6 pt-10 pb-8">
            <ol
              v-if="showSteps"
              class="-mx-16 mb-8 flex items-center justify-center gap-2 text-ui whitespace-nowrap"
              aria-label="Account setup"
              data-testid="browser-steps"
            >
              <li
                v-for="(s, i) in NEW_ACCOUNT_STEPS"
                :key="s.step"
                class="flex shrink-0 items-center gap-2"
                :aria-current="i === stepIndex ? 'step' : undefined"
              >
                <span
                  class="inline-flex size-5 items-center justify-center rounded-full text-[11px] font-medium"
                  :class="
                    i < stepIndex
                      ? 'bg-status-running text-inverted-foreground'
                      : i === stepIndex
                        ? 'bg-inverted-background text-inverted-foreground'
                        : 'bg-secondary-background text-subtle-foreground'
                  "
                  ><Check v-if="i < stepIndex" :size="11" /><template v-else>{{
                    i + 1
                  }}</template></span
                >
                <span
                  :class="i === stepIndex ? 'text-base-foreground' : 'text-subtle-foreground'"
                  >{{ s.label }}</span
                >
                <span
                  v-if="i < NEW_ACCOUNT_STEPS.length - 1"
                  class="mx-1 h-px w-5 bg-border-default"
                  aria-hidden="true"
                />
              </li>
            </ol>

            <template v-if="browserSignIn.step === 'signup'">
              <span
                class="inline-flex size-12 items-center justify-center self-center rounded-[28%] bg-inverted-background text-inverted-foreground"
                aria-hidden="true"
                ><ComfyCLogo :size="20"
              /></span>
              <DialogTitle class="mt-5 text-center text-title font-semibold">{{
                SIGN_UP_COPY.title
              }}</DialogTitle>
              <DialogDescription class="mt-1 text-center text-ui text-muted-foreground">{{
                SIGN_UP_COPY.body
              }}</DialogDescription>

              <div class="mt-8 flex flex-col gap-2">
                <Button
                  size="lg"
                  block
                  data-testid="browser-signup-google"
                  @click="createAccount"
                  >{{ SIGN_UP_COPY.google }}</Button
                >
                <Button size="lg" block @click="createAccount">{{ SIGN_UP_COPY.apple }}</Button>
              </div>
              <div class="my-5 flex items-center gap-3 text-ui text-subtle-foreground">
                <span class="h-px flex-1 bg-border-default" />or<span
                  class="h-px flex-1 bg-border-default"
                />
              </div>
              <Input v-model="email" size="lg" :placeholder="SIGN_UP_COPY.emailPlaceholder">
                <template #leading><Mail :size="14" class="text-subtle-foreground" /></template>
              </Input>
              <Button variant="primary" size="lg" block class="mt-2" @click="createAccount">{{
                SIGN_UP_COPY.email
              }}</Button>
              <p class="mt-6 text-center text-ui text-subtle-foreground">
                {{ SIGN_UP_COPY.haveAccount }}
                <button
                  type="button"
                  class="rounded-min text-base-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus"
                  @click="createAccount"
                >
                  {{ SIGN_UP_COPY.logIn }}
                </button>
              </p>
            </template>

            <template v-else-if="browserSignIn.step === 'topup'">
              <span
                class="inline-flex size-12 items-center justify-center self-center rounded-[28%] bg-inverted-background text-inverted-foreground"
                aria-hidden="true"
                ><ComfyCLogo :size="20"
              /></span>
              <DialogTitle class="mt-5 text-center text-title font-semibold">{{
                TOP_UP_COPY.title
              }}</DialogTitle>
              <DialogDescription class="mt-1 text-center text-ui text-muted-foreground">{{
                TOP_UP_COPY.body
              }}</DialogDescription>

              <p
                id="browser-amount-label"
                class="mt-8 mb-2 text-ui font-medium text-muted-foreground"
              >
                {{ TOP_UP_COPY.amountLabel }}
              </p>
              <SegmentedControl
                v-model="amount"
                variant="contained"
                aria-labelledby="browser-amount-label"
                :options="amountOptions"
              />

              <div
                class="mt-6 flex items-center gap-3 rounded-control bg-card-background px-3 py-2.5 text-ui"
              >
                <CreditCard :size="15" class="text-subtle-foreground" />
                <span class="flex-1">{{ TOP_UP_COPY.card }}</span>
                <span class="text-subtle-foreground">{{ NEW_ACCOUNT_WORKSPACE.name }}</span>
              </div>

              <Button
                variant="primary"
                size="lg"
                block
                class="mt-8"
                data-testid="browser-topup-pay"
                @click="payInBrowser(Number(amount))"
                >{{ TOP_UP_COPY.pay(usd(amount)) }}</Button
              >
              <Button variant="ghost" size="lg" block class="mt-1" @click="cancelInBrowser"
                >Cancel</Button
              >
            </template>

            <template v-else-if="browserSignIn.step === 'paid'">
              <CircleCheck :size="44" class="self-center text-status-running" aria-hidden="true" />
              <DialogTitle class="mt-5 text-center text-title font-semibold">{{
                TOP_UP_COPY.paidTitle(usd(browserSignIn.added))
              }}</DialogTitle>
              <DialogDescription class="mt-1 text-center text-ui text-muted-foreground">{{
                TOP_UP_COPY.paidBody
              }}</DialogDescription>
              <Button
                variant="primary"
                size="lg"
                block
                class="mt-8"
                data-testid="browser-topup-back"
                @click="continueInBrowser(picked)"
                >{{ TOP_UP_COPY.back }}</Button
              >
            </template>

            <template v-else>
              <div class="flex items-center justify-center gap-3" aria-hidden="true">
                <Avatar size="xl" class="size-12"><AppWindow :size="20" /></Avatar>
                <ArrowLeftRight :size="16" class="text-subtle-foreground" />
                <span
                  class="inline-flex size-12 items-center justify-center rounded-[28%] bg-inverted-background text-inverted-foreground"
                  ><ComfyCLogo :size="20"
                /></span>
              </div>
              <DialogTitle class="mt-5 text-center text-title font-semibold"
                >Comfy Desktop wants access</DialogTitle
              >
              <DialogDescription class="mt-1 text-center text-ui text-muted-foreground"
                >Sign in to Comfy Cloud to continue</DialogDescription
              >

              <p id="browser-ws-label" class="mt-8 mb-2 text-ui font-medium text-muted-foreground">
                Workspace
              </p>
              <div
                role="radiogroup"
                aria-labelledby="browser-ws-label"
                class="flex flex-col gap-1 rounded-control bg-card-background p-1"
              >
                <button
                  v-for="w in workspaces"
                  :key="w.id"
                  type="button"
                  role="radio"
                  :aria-checked="picked === w.id"
                  class="flex items-center gap-3 rounded-control px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                  :class="
                    picked === w.id
                      ? 'bg-secondary-background-hover'
                      : 'hover:bg-secondary-background'
                  "
                  @click="picked = w.id"
                >
                  <Avatar size="lg">{{ w.initial }}</Avatar>
                  <span class="min-w-0 flex-1">
                    <span class="block text-ui font-medium">{{ w.name }}</span>
                    <span class="block text-ui text-subtle-foreground"
                      >{{ w.plan }} · {{ roleLabel(w.role) }}</span
                    >
                  </span>
                  <Check v-if="picked === w.id" :size="15" />
                </button>
              </div>

              <p class="mt-6 mb-2 text-ui font-medium text-muted-foreground">
                Comfy Desktop will be able to
              </p>
              <ul class="flex flex-col gap-1.5 text-ui">
                <li v-for="p in CONSENT_PERMISSIONS" :key="p.scope" class="flex items-center gap-2">
                  <Check :size="14" class="text-status-running" />{{ p.plain }}
                </li>
              </ul>

              <button
                type="button"
                class="mt-4 inline-flex items-center gap-1 self-start rounded-min text-ui text-subtle-foreground outline-none hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
                :aria-expanded="details"
                data-testid="browser-signin-details"
                @click="details = !details"
              >
                <ChevronRight
                  :size="13"
                  class="transition-transform duration-150"
                  :class="details && 'rotate-90'"
                />Details
              </button>
              <div
                v-if="details"
                class="mt-2 flex flex-col gap-3 rounded-control bg-card-background p-3 text-ui"
              >
                <div>
                  <p class="text-subtle-foreground">Permissions</p>
                  <ul
                    class="mt-1 flex flex-col gap-0.5 font-mono text-[12px] text-muted-foreground"
                  >
                    <li v-for="p in CONSENT_PERMISSIONS" :key="p.scope">{{ p.scope }}</li>
                  </ul>
                </div>
                <div>
                  <p class="text-subtle-foreground">You’ll be redirected to</p>
                  <p class="mt-1 font-mono text-[12px] break-all text-muted-foreground">
                    {{ FAKE_CALLBACK_URL }}
                  </p>
                </div>
              </div>

              <Button
                variant="primary"
                size="lg"
                block
                class="mt-8"
                data-testid="browser-signin-continue"
                @click="approve"
                >Continue</Button
              >
              <Button variant="ghost" size="lg" block class="mt-1" @click="cancelInBrowser"
                >Cancel</Button
              >
            </template>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.mar-browser {
  width: min(760px, calc(100vw - 48px));
  height: min(720px, calc(100vh - 48px));
}
</style>
