<script setup lang="ts">
import { LogIn } from 'lucide-vue-next'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import Button from '../../ui/Button.vue'
import { hostActions } from '../../useProto'
import hillsSunset from '../assets/hills-sunset.jpg'

/** Signed out, in place of the workspace at the sidebar's foot: Pablo's
 *  SignInCard (Nav options › Account), restyled. A landscape shows what logging in is for; on hover
 *  it drifts. On the rail it's one icon. */
const { open = true } = defineProps<{ open?: boolean }>()
</script>

<template>
  <div v-if="open" class="mar-signin">
    <div class="mar-signin-strip">
      <img :src="hillsSunset" alt="" class="mar-signin-shot size-full object-cover" />
      <span class="mar-signin-mark"><ComfyCLogo :size="14" /></span>
    </div>
    <div class="px-2 pt-2.5 pb-3">
      <p class="font-medium text-base-foreground">Log in to Comfy</p>
      <p class="mt-0.5 text-subtle-foreground">Sync and run on Comfy Cloud</p>
    </div>
    <Button variant="primary" block @click="hostActions.signIn()">Log in</Button>
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
/* 4px around the strip and the button, so their corners sit concentric
   inside the card's. */
.mar-signin {
  padding: 4px;
  border-radius: calc(var(--radius-control) + 4px);
  background: color-mix(in oklch, var(--color-base-foreground) 4%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  font-size: var(--text-ui);
  line-height: 1.35;
  text-wrap: pretty;
}
.mar-signin-strip {
  position: relative;
  height: 72px;
  overflow: hidden;
  border-radius: var(--radius-control);
}
.mar-signin-shot {
  transition: transform 600ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-signin:hover .mar-signin-shot {
  transform: scale(1.08) translateY(-2px);
}
/* The mark sits on the picture, so it keeps one look in both themes. */
.mar-signin-mark {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: #fff;
  color: #111;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.28);
  transform: translate(-50%, -50%);
  transition: transform 400ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-signin:hover .mar-signin-mark {
  transform: translate(-50%, calc(-50% - 2px)) scale(1.05);
}
@media (prefers-reduced-motion: reduce) {
  .mar-signin-shot,
  .mar-signin-mark {
    transition: none;
  }
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
