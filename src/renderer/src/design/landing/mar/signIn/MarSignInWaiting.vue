<script setup lang="ts">
import { ref } from 'vue'
import { PopoverRoot, PopoverTrigger } from 'reka-ui'
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import PopoverContent from '../../ui/PopoverContent.vue'
import Tooltip from '../../ui/Tooltip.vue'
import WorkspaceAvatar from '../../parts/WorkspaceAvatar.vue'
import { proto } from '../../useProto'
import { shownWorkspace } from '../../account'
import {
  dismissSignInBanner,
  FAKE_LOGIN_URL,
  openBrowserAgain,
  SIGN_IN_COPY
} from './browserSignIn'
import { useSignInCorner } from './signInCorner'

const { rail = false } = defineProps<{ rail?: boolean }>()

const emit = defineEmits<{ cancel: [] }>()

useSignInCorner()

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

function copyLink(): void {
  void navigator.clipboard?.writeText(FAKE_LOGIN_URL).catch(() => {})
  copied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1500)
}

function dismiss(): void {
  dismissSignInBanner()
  emit('cancel')
}
</script>

<template>
  <Tooltip v-if="rail" :content="SIGN_IN_COPY.waiting" side="right" wrap>
    <PopoverRoot>
      <PopoverTrigger as-child>
        <button
          type="button"
          class="mar-signin-wait-rail"
          :aria-label="SIGN_IN_COPY.waiting"
          data-testid="signin-waiting-rail"
        >
          <template v-if="proto.signedIn">
            <WorkspaceAvatar :ws="shownWorkspace" />
            <span class="mar-signin-wait-badge"
              ><Loader2 :size="10" class="animate-spin motion-reduce:animate-none"
            /></span>
          </template>
          <Loader2 v-else :size="16" class="animate-spin motion-reduce:animate-none" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" :side-offset="10" class="proto-ui w-60 p-1">
        <MarSignInWaiting class="is-pop" @cancel="emit('cancel')" />
      </PopoverContent>
    </PopoverRoot>
  </Tooltip>

  <div v-else class="mar-corner-card" role="status" aria-live="polite" data-testid="signin-waiting">
    <div class="mar-corner-top">
      <span class="mar-corner-mark"
        ><Loader2 :size="16" class="animate-spin motion-reduce:animate-none"
      /></span>
      <Button variant="ghost" size="sm" class="-mr-1.5" @click="dismiss">{{
        SIGN_IN_COPY.banner.dismiss
      }}</Button>
    </div>
    <p class="mar-corner-text text-base-foreground">{{ SIGN_IN_COPY.banner.message }}</p>
    <div class="mar-signin-wait-actions">
      <Button variant="primary" block @click="copyLink">
        <Check v-if="copied" :size="14" /><Copy v-else :size="14" />
        {{ copied ? SIGN_IN_COPY.banner.copied : SIGN_IN_COPY.banner.copy }}
      </Button>
      <Button variant="secondary" block @click="openBrowserAgain">
        <ExternalLink :size="14" />{{ SIGN_IN_COPY.banner.openAgain }}
      </Button>
    </div>
  </div>
</template>

<style scoped>
:root .proto-ui.proto-ui.proto-ui .mar-corner-card.is-pop {
  padding: 8px;
  background: none;
  box-shadow: none;
}
:root .proto-ui.proto-ui.proto-ui .mar-signin-wait-rail {
  position: relative;
  display: flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-signin-wait-rail:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
.mar-signin-wait-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mar-signin-wait-badge {
  position: absolute;
  right: 2px;
  bottom: 2px;
  display: flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--color-card-background);
  box-shadow: 0 0 0 2px var(--glyph-ring, var(--color-app-background));
  color: var(--color-base-foreground);
}
</style>
