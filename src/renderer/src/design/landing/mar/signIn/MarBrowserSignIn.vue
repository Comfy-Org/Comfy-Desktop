<script setup lang="ts">
import { ref, watch } from 'vue'
import { AppWindow, ArrowLeftRight, Check, ChevronRight, Lock } from 'lucide-vue-next'
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
import { PORTAL_TO } from '../../ui/portal'
import { WORKSPACES, type Workspace } from '../../mock'
import { proto } from '../../useProto'
import {
  browserSignIn,
  cancelInBrowser,
  CONSENT_PERMISSIONS,
  continueInBrowser,
  FAKE_CALLBACK_URL,
  FAKE_LOGIN_URL
} from './browserSignIn'

const picked = ref<Workspace['id']>(proto.workspaceId)
const details = ref(false)

watch(
  () => browserSignIn.browser,
  (open) => {
    if (!open) return
    picked.value = proto.workspaceId
    details.value = false
  }
)

const roleLabel = (role: string): string => role.charAt(0) + role.slice(1).toLowerCase()
const host = new URL(FAKE_LOGIN_URL).host
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
                v-for="w in WORKSPACES"
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
                <ul class="mt-1 flex flex-col gap-0.5 font-mono text-[12px] text-muted-foreground">
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
              @click="continueInBrowser(picked)"
              >Continue</Button
            >
            <Button variant="ghost" size="lg" block class="mt-1" @click="cancelInBrowser"
              >Cancel</Button
            >
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
