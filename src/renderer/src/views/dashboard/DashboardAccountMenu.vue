<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowLeftRight,
  Check,
  ChevronsUpDown,
  CreditCard,
  Globe,
  LogOut,
  Plus
} from 'lucide-vue-next'
import { DropdownMenuRoot, DropdownMenuSub, DropdownMenuTrigger } from 'reka-ui'
import Button from '../../design-system/components/Button.vue'
import Card from '../../design-system/components/Card.vue'
import DropdownMenuContent from '../../design-system/components/DropdownMenuContent.vue'
import DropdownMenuItem from '../../design-system/components/DropdownMenuItem.vue'
import DropdownMenuLabel from '../../design-system/components/DropdownMenuLabel.vue'
import DropdownMenuSeparator from '../../design-system/components/DropdownMenuSeparator.vue'
import DropdownMenuSubContent from '../../design-system/components/DropdownMenuSubContent.vue'
import DropdownMenuSubTrigger from '../../design-system/components/DropdownMenuSubTrigger.vue'
import DevPlatformAvatar from '../devplatform/DevPlatformAvatar.vue'
import { useAuthStore } from '../../stores/authStore'
import { useWorkspaceChoices } from '../../composables/useWorkspaceChoices'
import type { CloudPage } from '../../types/ipc'

/** The sidebar's foot: Log in when signed out; otherwise the selected
 *  workspace. Its menu: the workspace (plan and role; opens the switcher),
 *  plan and credits for its owner, then the account (email, language, log
 *  out). Creating a workspace and managing the plan happen on Comfy Cloud. */
const workspaceId = defineModel<string>('workspaceId', { required: true })

const { t, locale } = useI18n()
const authStore = useAuthStore()
const {
  workspaceChoices,
  currentWorkspaceName,
  currentMeta,
  canManagePlan,
  fetchWorkspacesIfNeeded
} = useWorkspaceChoices(workspaceId)
const email = computed(() => authStore.status.email ?? '')

const locales = ref<{ value: string; label: string }[]>([])
async function loadLocales(): Promise<void> {
  if (!locales.value.length) locales.value = await window.api.getAvailableLocales()
}
function setLanguage(value: string): void {
  void window.api.setSetting('language', value)
}

function openCloud(page: CloudPage): void {
  void window.api.comfybuilder.openCloudPage(page).catch(() => {})
}

function onOpen(open: boolean): void {
  if (!open) return
  fetchWorkspacesIfNeeded()
  void loadLocales().catch(() => {})
}

const signingIn = ref(false)
async function signIn(): Promise<void> {
  if (signingIn.value) return
  signingIn.value = true
  try {
    await authStore.signIn()
  } catch {
    // The browser flow reports its own errors; the card stays for a retry.
  } finally {
    signingIn.value = false
  }
}

function signOut(): void {
  void authStore.signOut().catch(() => {})
}
</script>

<template>
  <!-- Sidebar 16 /p8 -> card 8; card /p4 -> button 4. -->
  <Card v-if="!authStore.isSignedIn" variant="inset" class="px-1 pt-3 pb-1">
    <p class="px-2 text-ui font-semibold">{{ t('buildsDashboard.account.logInTitle') }}</p>
    <p class="mt-0.5 mb-3 px-2 text-ui text-subtle-foreground">
      {{ t('buildsDashboard.account.logInDescription') }}
    </p>
    <Button
      variant="primary"
      block
      class="rounded-min"
      :disabled="signingIn"
      data-testid="dashboard-log-in"
      @click="signIn"
      >{{ t('devPlatform.signIn.cta') }}</Button
    >
  </Card>

  <DropdownMenuRoot v-else :modal="false" @update:open="onOpen">
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        class="h-auto justify-start gap-2.5 p-1.5 text-left text-base-foreground [--dp-avatar-size:--spacing(7)] data-[state=open]:bg-secondary-background"
        data-testid="dashboard-account-menu"
      >
        <DevPlatformAvatar :name="currentWorkspaceName" />
        <span class="sidebar-label flex flex-col">
          <span class="truncate text-ui font-medium">{{ currentWorkspaceName }}</span>
          <span class="truncate text-ui font-normal text-subtle-foreground">{{ email }}</span>
        </span>
        <ChevronsUpDown :size="14" class="text-subtle-foreground" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" class="w-72">
      <!-- The workspace: opens the switcher beside it. -->
      <DropdownMenuSub>
        <DropdownMenuSubTrigger
          :chevron="false"
          class="gap-3 py-2 [--dp-avatar-size:--spacing(8)]"
          :aria-label="t('buildsDashboard.account.switchWorkspace')"
          data-testid="dashboard-workspace-switcher"
        >
          <DevPlatformAvatar :name="currentWorkspaceName" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate font-medium">{{ currentWorkspaceName }}</span>
            <span
              v-if="currentMeta.length"
              class="truncate tracking-wider text-subtle-foreground uppercase"
              >{{ currentMeta.join(' • ') }}</span
            >
          </span>
          <ArrowLeftRight :size="16" class="shrink-0 text-muted-foreground" />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent class="w-64 [--dp-avatar-size:--spacing(7)]">
          <DropdownMenuLabel>{{ t('buildsDashboard.account.workspaces') }}</DropdownMenuLabel>
          <DropdownMenuItem
            v-for="choice in workspaceChoices"
            :key="choice.id"
            class="py-1.5"
            :data-testid="`dashboard-workspace-${choice.id}`"
            @select="workspaceId = choice.id"
          >
            <DevPlatformAvatar :name="choice.label" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate">{{ choice.label }}</span>
              <span
                v-if="choice.tier"
                class="truncate tracking-wider text-subtle-foreground uppercase"
                >{{ choice.tier }}</span
              >
            </span>
            <Check v-if="workspaceId === choice.id" :size="14" />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            class="py-1.5 text-muted-foreground"
            data-testid="dashboard-add-workspace"
            @select="openCloud('create-workspace')"
          >
            <span
              class="flex size-7 shrink-0 items-center justify-center rounded-min border border-dashed border-border-strong"
              ><Plus :size="14"
            /></span>
            {{ t('buildsDashboard.account.addWorkspace') }}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem
        v-if="canManagePlan"
        data-testid="dashboard-manage-plan"
        @select="openCloud('plan-credits')"
        ><CreditCard :size="14" />{{ t('buildsDashboard.account.managePlan') }}</DropdownMenuItem
      >
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{{ email }}</DropdownMenuLabel>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger data-testid="dashboard-language"
          ><Globe :size="14" />{{ t('buildsDashboard.account.language') }}</DropdownMenuSubTrigger
        >
        <DropdownMenuSubContent class="w-48">
          <DropdownMenuItem
            v-for="option in locales"
            :key="option.value"
            @select="setLanguage(option.value)"
          >
            <span class="flex-1">{{ option.label }}</span>
            <Check v-if="option.value === locale" :size="14" />
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem data-testid="dashboard-sign-out" @select="signOut"
        ><LogOut :size="14" />{{ t('devPlatform.account.signOut') }}</DropdownMenuItem
      >
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>
