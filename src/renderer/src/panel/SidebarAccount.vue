<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LogIn } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import ComfyCLogo from '../components/icons/ComfyCLogo.vue'
import SidebarWorkspaceSwitcher from './SidebarWorkspaceSwitcher.vue'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import hillsSunset from '../assets/sidebar/hills-sunset.jpg'
import portraitGarden from '../assets/sidebar/portrait-garden.jpg'
import portraitSun from '../assets/sidebar/portrait-sun.jpg'

const { collapsed } = defineProps<{
  collapsed: boolean
}>()

const SHOWCASE_IMAGES = [portraitSun, hillsSunset, portraitGarden]

const { t } = useI18n()
const store = useAuthStore()
const dashboardScope = useDashboardScopeStore()
void dashboardScope.initialize()

const signingIn = ref(false)

async function onSignIn(): Promise<void> {
  if (signingIn.value) return
  signingIn.value = true
  try {
    await store.signIn()
  } catch {
    return
  } finally {
    signingIn.value = false
  }
}
</script>

<template>
  <div class="sidebar-account">
    <SidebarWorkspaceSwitcher v-if="store.isSignedIn" :collapsed="collapsed" />

    <Button
      v-else-if="collapsed"
      type="button"
      variant="muted-textonly"
      size="unset"
      class="mx-auto size-10 rounded-xl p-0 hover:bg-secondary hover:text-foreground"
      data-testid="devplatform-account-signin"
      :aria-label="t('devPlatform.signIn.cta')"
      :title="t('devPlatform.signIn.cta')"
      :disabled="signingIn"
      @click="onSignIn"
    >
      <LogIn :size="16" aria-hidden="true" />
    </Button>

    <div
      v-else
      class="group/signin rounded-xl bg-[oklch(1_0_0/0.04)] p-1 text-[13px]/[1.35] text-pretty [box-shadow:inset_0_0_0_1px_oklch(1_0_0/0.06)]"
    >
      <div class="relative grid h-16 grid-cols-3 gap-0.5 overflow-hidden rounded-lg">
        <span
          v-for="image in SHOWCASE_IMAGES"
          :key="image"
          class="relative isolate overflow-hidden bg-[oklch(0.87_0.075_350)]"
        >
          <img
            :src="image"
            alt=""
            class="size-full object-cover mix-blend-multiply transition-transform duration-600 ease-out group-hover/signin:scale-108 motion-reduce:transition-none"
          />
          <span class="absolute inset-0 bg-[oklch(0.26_0.1_282)] mix-blend-lighten" />
        </span>
        <span
          class="absolute top-1/2 left-1/2 flex size-[30px] -translate-1/2 items-center justify-center rounded-[9px] bg-white text-[#111] shadow-lg"
          aria-hidden="true"
        >
          <ComfyCLogo :size="14" />
        </span>
      </div>
      <div class="px-2 pt-2.5 pb-3">
        <p class="font-medium text-foreground">{{ t('sidebar.signInTitle') }}</p>
        <p class="mt-0.5 text-subtle-foreground">{{ t('sidebar.signInBody') }}</p>
      </div>
      <Button
        type="button"
        variant="inverted"
        size="md"
        class="w-full"
        data-testid="devplatform-account-signin"
        :disabled="signingIn"
        @click="onSignIn"
        >{{ t('devPlatform.signIn.cta') }}</Button
      >
    </div>
  </div>
</template>
