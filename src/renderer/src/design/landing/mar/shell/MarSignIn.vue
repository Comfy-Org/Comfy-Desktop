<script setup lang="ts">
import { LogIn } from 'lucide-vue-next'
import ComfyCLogo from '../../../../components/icons/ComfyCLogo.vue'
import Button from '../../ui/Button.vue'
import { hostActions } from '../../useProto'
import hillsSunset from '../assets/hills-sunset.jpg'
import portraitGarden from '../assets/portrait-garden.jpg'
import portraitSun from '../assets/portrait-sun.jpg'
import GradedImage from '../brand/GradedImage.vue'
import { SILVER_GRADE } from '../brand/imagery'

/** Signed out, in place of the workspace at the sidebar's foot: Pablo's
 *  SignInCard (Nav options › Account), restyled. A strip of outputs in the
 *  Silver grade (DS › Brand imagery) shows what logging in is for; on hover
 *  it drifts. On the rail it's one icon. */
const { open = true } = defineProps<{ open?: boolean }>()

const STRIP = [portraitSun, hillsSunset, portraitGarden]
</script>

<template>
  <div v-if="open" class="mar-signin">
    <div class="mar-signin-strip">
      <span v-for="src in STRIP" :key="src" class="mar-signin-shot">
        <GradedImage :src="src" :grade="SILVER_GRADE" class="size-full" />
      </span>
      <span class="mar-signin-mark"><ComfyCLogo :size="14" /></span>
    </div>
    <p class="px-2 pt-2.5 pb-3 font-medium text-base-foreground">Sync and run on Comfy Cloud</p>
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
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  height: 64px;
  overflow: hidden;
  border-radius: var(--radius-control);
}
.mar-signin-shot {
  overflow: hidden;
}
.mar-signin-shot > * {
  transition: transform 600ms cubic-bezier(0.16, 1, 0.3, 1);
}
.mar-signin-shot:nth-child(2) > * {
  transition-delay: 40ms;
}
.mar-signin-shot:nth-child(3) > * {
  transition-delay: 80ms;
}
.mar-signin:hover .mar-signin-shot > * {
  transform: scale(1.08) translateY(-2px);
}
/* The mark sits on the pictures, so it keeps one look in both themes. */
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
  .mar-signin-shot > *,
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
