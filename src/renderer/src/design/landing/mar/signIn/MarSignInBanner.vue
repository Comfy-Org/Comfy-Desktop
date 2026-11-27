<script setup lang="ts">
import { ref } from 'vue'
import { Check, CircleAlert, Copy, ExternalLink, RotateCcw, X } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import { PORTAL_TO } from '../../ui/portal'
import {
  browserSignIn,
  dismissSignInBanner,
  FAKE_LOGIN_URL,
  openBrowserAgain,
  retrySignIn,
  SIGN_IN_COPY,
  signInWithoutAccount
} from './browserSignIn'
import { hostActions, instances } from '../../useProto'
import { signInCornerShown } from './signInCorner'
import { building } from '../../appFlow'
import { marSidebarClosed } from '../shell/marShell'

function withoutAccount(): void {
  signInWithoutAccount()
  if (!instances.value.some((i) => i.kind === 'local')) hostActions.newInstance()
}

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

function copyLink(): void {
  void navigator.clipboard?.writeText(FAKE_LOGIN_URL).catch(() => {})
  copied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <Teleport :to="PORTAL_TO">
    <div
      v-if="
        browserSignIn.banner &&
        !browserSignIn.browser &&
        (browserSignIn.failed || !signInCornerShown || building || marSidebarClosed)
      "
      class="proto-ui mar-signin-banner"
      role="status"
      data-testid="signin-banner"
      @pointerdown.stop
    >
      <template v-if="browserSignIn.failed">
        <CircleAlert :size="16" class="shrink-0 text-status-danger" />
        <span class="mar-signin-banner-msg" data-testid="signin-failed">{{
          SIGN_IN_COPY.failed[browserSignIn.failed]
        }}</span>
        <Button variant="primary" size="md" @click="retrySignIn">
          <RotateCcw :size="14" />{{ SIGN_IN_COPY.failed.retry }}
        </Button>
        <Button variant="subtle" size="md" @click="withoutAccount">
          {{ SIGN_IN_COPY.failed.local }}
        </Button>
      </template>
      <span v-else class="mar-signin-banner-msg">{{ SIGN_IN_COPY.banner.message }}</span>
      <Button v-if="!browserSignIn.failed" variant="primary" size="md" @click="copyLink">
        <Check v-if="copied" :size="14" /><Copy v-else :size="14" />
        {{ copied ? SIGN_IN_COPY.banner.copied : SIGN_IN_COPY.banner.copy }}
      </Button>
      <Button v-if="!browserSignIn.failed" variant="subtle" size="md" @click="openBrowserAgain">
        <ExternalLink :size="14" />{{ SIGN_IN_COPY.banner.openAgain }}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="SIGN_IN_COPY.banner.dismiss"
        @click="dismissSignInBanner"
      >
        <X :size="16" />
      </Button>
    </div>
  </Teleport>
</template>

<style scoped>
.mar-signin-banner {
  position: fixed;
  bottom: 16px;
  left: 16px;
  z-index: 2147483647;
  display: flex;
  width: max-content;
  max-width: calc(100vw - 32px);
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--color-border-strong);
  border-radius: 12px;
  background: var(--color-card-background);
  color: var(--color-muted-foreground);
  box-shadow: var(--shadow-popover);
  font-size: var(--text-ui);
  line-height: 1.45;
  pointer-events: auto;
}
.mar-signin-banner-msg {
  min-width: 0;
  white-space: nowrap;
}
</style>
