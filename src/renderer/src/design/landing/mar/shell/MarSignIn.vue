<script setup lang="ts">
import { LogIn } from 'lucide-vue-next'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import { hostActions } from '../../useProto'

/** Signed out, in place of the workspace at the sidebar's foot: Pablo's
 *  SignInCard (From Pablo › Account), restyled. On the rail it's one icon. */
const { open = true } = defineProps<{ open?: boolean }>()
</script>

<template>
  <div v-if="open" class="mar-signin">
    <div class="flex items-start gap-2.5">
      <span class="mar-signin-mark"><ComfyCLogo :size="13" /></span>
      <div class="min-w-0">
        <p class="font-medium text-base-foreground">Log in to Comfy</p>
        <p class="mt-0.5 text-subtle-foreground">Sync your work and run it on Comfy Cloud.</p>
      </div>
    </div>
    <button type="button" class="mar-signin-btn" @click="hostActions.signIn()">Log in</button>
  </div>
  <button
    v-else
    type="button"
    class="mar-signin-icon"
    aria-label="Log in"
    title="Log in"
    @click="hostActions.signIn()"
  >
    <LogIn :size="16" />
  </button>
</template>

<style scoped>
/* A faint light from the mark's corner, so it reads as an invitation,
   not a form. */
.mar-signin {
  padding: 12px 10px 10px 12px;
  border-radius: 14px;
  background:
    radial-gradient(
      120% 90% at 0% 0%,
      color-mix(in oklch, var(--color-base-foreground) 7%, transparent),
      transparent 70%
    ),
    color-mix(in oklch, var(--color-base-foreground) 4%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  font-size: var(--text-ui);
  line-height: 1.35;
  text-wrap: pretty;
}
.mar-signin-mark {
  display: flex;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
  border-radius: 8px;
  background: var(--color-base-foreground);
  color: var(--color-content-background);
}
/* Mar's CTAs are pills (MarStartWhere, the home prompt). */
:root .proto-ui.proto-ui.proto-ui .mar-signin-btn {
  display: flex;
  width: 100%;
  height: 32px;
  align-items: center;
  justify-content: center;
  margin-top: 12px;
  border-radius: 999px;
  background: var(--color-base-foreground);
  color: var(--color-content-background);
  font-weight: 500;
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-signin-btn:hover {
  opacity: 0.88;
}
:root .proto-ui.proto-ui.proto-ui .mar-signin-btn:active {
  transform: scale(0.98);
}
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
