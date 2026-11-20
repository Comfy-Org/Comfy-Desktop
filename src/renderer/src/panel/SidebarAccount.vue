<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { LogIn } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import ComfyCLogo from '../components/icons/ComfyCLogo.vue'
import SidebarWorkspaceSwitcher from './SidebarWorkspaceSwitcher.vue'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import hillsSunset from '../assets/sidebar/hills-sunset.jpg'

const { collapsed } = defineProps<{
  collapsed: boolean
}>()

const { t } = useI18n()
const store = useAuthStore()
const dashboardScope = useDashboardScopeStore()
void dashboardScope.initialize()

async function onSignIn(event: MouseEvent): Promise<void> {
  if (event.detail > 1) return
  await store.signIn().catch(() => {})
}
</script>

<template>
  <div class="sidebar-account">
    <SidebarWorkspaceSwitcher v-if="store.isSignedIn" :collapsed="collapsed" />

    <template v-else>
      <div
        class="grid transition-[grid-template-rows,opacity] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-opacity"
        :class="
          collapsed ? 'grid-rows-[0fr] opacity-0 duration-300' : 'grid-rows-[1fr] duration-260'
        "
        :inert="collapsed"
        data-testid="sidebar-signin-card"
      >
        <div class="min-h-0 overflow-hidden">
          <div
            class="group/signin w-[220px] rounded-xl bg-[oklch(1_0_0/0.04)] p-1 text-[13px]/[1.35] text-pretty [box-shadow:inset_0_0_0_1px_oklch(1_0_0/0.06)]"
          >
            <div class="relative h-18 overflow-hidden rounded-lg">
              <img
                :src="hillsSunset"
                alt=""
                class="size-full object-cover transition-transform duration-600 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/signin:-translate-y-0.5 group-hover/signin:scale-108 motion-reduce:transition-none"
              />
              <span
                class="absolute top-1/2 left-1/2 flex size-[30px] -translate-1/2 items-center justify-center rounded-[9px] bg-white text-[#111] shadow-lg transition-transform duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/signin:-translate-y-[calc(50%+2px)] group-hover/signin:scale-105 motion-reduce:transition-none"
                aria-hidden="true"
              >
                <ComfyCLogo :size="14" />
              </span>
            </div>
            <div class="px-2 pt-2.5 pb-3">
              <p class="font-medium text-foreground">{{ t('sidebar.signInTitle') }}</p>
              <p
                class="mt-0.5 text-subtle-foreground"
                aria-live="polite"
                data-testid="sidebar-signin-body"
              >
                {{
                  store.signInPending ? t('devPlatform.signIn.waiting') : t('sidebar.signInBody')
                }}
              </p>
            </div>
            <Button
              type="button"
              variant="inverted"
              size="md"
              class="w-full"
              :data-testid="collapsed ? undefined : 'devplatform-account-signin'"
              @click="onSignIn"
              >{{ t('devPlatform.signIn.cta') }}</Button
            >
          </div>
        </div>
      </div>
      <div
        class="grid transition-[grid-template-rows,opacity] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-opacity"
        :class="
          collapsed ? 'grid-rows-[1fr] duration-300' : 'grid-rows-[0fr] opacity-0 duration-260'
        "
        :inert="!collapsed"
        data-testid="sidebar-signin-icon"
      >
        <div class="min-h-0 overflow-hidden">
          <Button
            type="button"
            variant="muted-textonly"
            size="unset"
            class="size-10 rounded-xl p-0 hover:bg-secondary hover:text-foreground"
            :data-testid="collapsed ? 'devplatform-account-signin' : undefined"
            :aria-label="t('devPlatform.signIn.cta')"
            :title="t('devPlatform.signIn.cta')"
            @click="onSignIn"
          >
            <LogIn :size="16" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </template>
  </div>
</template>
