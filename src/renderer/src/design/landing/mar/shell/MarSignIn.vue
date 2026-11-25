<script setup lang="ts">
import { LogIn } from 'lucide-vue-next'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import Button from '../../ui/Button.vue'
import { hostActions } from '../../useProto'
import { browserSignIn, SIGN_IN_COPY } from '../signIn/browserSignIn'

const {
  open = true,
  note = '',
  then
} = defineProps<{ open?: boolean; note?: string; then?: () => void }>()

function logIn(event: MouseEvent): void {
  if (event.detail > 1) return
  hostActions.signIn(then)
}
</script>

<template>
  <div v-if="open" class="mar-corner-card">
    <span class="mar-corner-mark is-brand"><ComfyCLogo :size="16" /></span>
    <div class="mar-corner-text">
      <p class="font-medium text-base-foreground">{{ SIGN_IN_COPY.title }}</p>
      <p class="text-subtle-foreground" aria-live="polite" data-testid="sidebar-signin-body">
        {{ browserSignIn.pending ? SIGN_IN_COPY.waiting : SIGN_IN_COPY.body }}
      </p>
      <p v-if="note" class="mt-1.5 text-muted-foreground">{{ note }}</p>
    </div>
    <Button variant="primary" block @click="logIn">{{ SIGN_IN_COPY.cta }}</Button>
  </div>
  <button
    v-else
    type="button"
    class="mar-signin-icon"
    :aria-label="SIGN_IN_COPY.cta"
    :title="SIGN_IN_COPY.cta"
    @click="logIn"
  >
    <LogIn :size="16" />
  </button>
</template>

<style scoped>
:root .proto-ui.proto-ui.proto-ui .mar-signin-icon {
  display: flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-signin-icon:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  color: var(--color-base-foreground);
}
</style>
