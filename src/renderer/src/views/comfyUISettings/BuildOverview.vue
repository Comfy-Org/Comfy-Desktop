<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DropdownMenuLabel, DropdownMenuRadioGroup } from 'reka-ui'
import { ArrowUpCircle, ChevronDown, FolderOpen, Loader2 } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Menu from '@comfyorg/design-system/menu/Menu'
import MenuItem from '@comfyorg/design-system/menu/MenuItem'
import MenuRadioItem from '@comfyorg/design-system/menu/MenuRadioItem'
import MenuSub from '@comfyorg/design-system/menu/MenuSub'
import MenuSubContent from '@comfyorg/design-system/menu/MenuSubContent'
import MenuSubTrigger from '@comfyorg/design-system/menu/MenuSubTrigger'
import SplitButton from '../../components/ui/SplitButton.vue'
import BaseCopyButton from '../../components/ui/BaseCopyButton.vue'
import Tooltip from '../../components/ui/Tooltip.vue'
import { formatRelativeFromMs } from '../../lib/datetime'
import { useSessionStore } from '../../stores/sessionStore'
import type { ActionDef, Installation } from '../../types/ipc'
import { TID } from '../../../../shared/testIds'
import { channelAction, splitVersion, type BuildOverviewModel } from './overviewModel'

const {
  installation,
  model,
  diskUsage = null,
  diskFree = null,
  runningActionIds = new Set<string>()
} = defineProps<{
  installation: Installation
  model: BuildOverviewModel
  diskUsage?: string | null
  diskFree?: string | null
  runningActionIds?: Set<string>
}>()

const emit = defineEmits<{ action: [action: ActionDef] }>()

const { t } = useI18n()
const sessionStore = useSessionStore()

const pickedChannel = ref(model.currentChannel)
watch(
  () => [installation.id, model.currentChannel] as const,
  ([, current]) => {
    pickedChannel.value = current
  }
)

const channel = computed(
  () =>
    model.channels.find((c) => c.value === pickedChannel.value) ??
    model.channels.find((c) => c.value === model.currentChannel)
)
const switching = computed(() => !!channel.value && channel.value.value !== model.currentChannel)
const updateAction = computed(() =>
  channel.value ? channelAction(channel.value, 'update-comfyui') : undefined
)
const copyUpdateAction = computed(() =>
  channel.value ? channelAction(channel.value, 'copy-update') : undefined
)
const switchAction = computed(() =>
  channel.value ? channelAction(channel.value, 'switch-channel') : undefined
)
const updateMenuOpen = ref(false)

const comfyVersion = computed(() =>
  splitVersion(
    model.channels.find((c) => c.value === model.currentChannel)?.installedVersion ??
      model.facts['comfyui-version']?.value
  )
)

const lastChecked = computed(() => {
  const c = channel.value
  if (!c) return ''
  if (c.lastCheckedAt) return formatRelativeFromMs(c.lastCheckedAt, t)
  return c.lastChecked ?? ''
})

const checkedText = computed(() =>
  lastChecked.value
    ? t('buildOverview.checked', {
        time: lastChecked.value.charAt(0).toLocaleLowerCase() + lastChecked.value.slice(1)
      })
    : ''
)
const updateNote = computed(() =>
  [t('buildOverview.savesSnapshot'), checkedText.value].filter(Boolean).join(' · ')
)

const switchHeadline = computed(() =>
  t('channelCards.switchTo', { channel: channel.value?.label ?? '' })
)
const updateHeadline = computed(() =>
  switching.value
    ? switchHeadline.value
    : t('buildOverview.available', { version: channel.value?.latestVersion ?? '' })
)

const checkRunning = computed(
  () => !!model.checkAction && runningActionIds.has(model.checkAction.id)
)

const torchVersion = computed(() => model.torch?.current || model.facts.pytorch?.value || '—')
const torchGroups = computed(() => model.torch?.groups ?? [])
const showTorchGroupLabels = computed(() => torchGroups.value.length > 1)

const location = computed(() => model.facts.location?.value)
const port = computed(() =>
  sessionStore.isRunning(installation.id) ? model.facts['active-port'] : undefined
)
const lineage = computed(() => model.facts.lineage)

function run(action: ActionDef | undefined): void {
  if (action) emit('action', action)
}

function openLocation(): void {
  if (location.value) void window.api.openPath(location.value)
}
</script>

<template>
  <div class="build-overview @container/overview w-full" data-testid="build-overview">
    <div
      class="build-overview-grid grid gap-2.5 @[760px]/overview:grid-cols-[minmax(0,1.35fr)_minmax(0,3fr)]"
    >
      <section
        class="build-overview-card flex min-w-0 flex-col gap-1 overflow-hidden rounded-[14px] bg-card px-[18px] py-4 @[760px]/overview:[contain:size]"
        aria-labelledby="build-overview-comfyui"
        data-testid="build-overview-comfyui"
      >
        <span id="build-overview-comfyui" class="text-[12px]/4 text-muted-foreground">{{
          t('buildOverview.comfyui')
        }}</span>
        <span class="flex min-w-0 items-baseline gap-2">
          <span
            class="truncate text-[22px]/7 font-semibold tracking-[-0.01em] text-foreground tabular-nums"
            :title="comfyVersion.main"
            data-testid="build-overview-comfyui-version"
            >{{ comfyVersion.main }}</span
          >
          <span
            v-if="comfyVersion.rest"
            class="min-w-0 truncate text-[12px]/4 text-muted-foreground"
            :title="comfyVersion.rest"
            >{{ comfyVersion.rest }}</span
          >
        </span>
        <Menu
          :modal="false"
          align="start"
          :side-offset="6"
          class="z-20 max-w-80 min-w-60"
          :aria-label="model.channelLabel"
        >
          <template #trigger>
            <Button
              type="button"
              variant="muted-textonly"
              size="sm"
              class="-mx-2 mt-0.5 max-w-[calc(100%+1rem)] min-w-0 gap-0.5 self-start text-[12px]/4 font-normal data-[state=open]:bg-accent data-[state=open]:text-foreground"
              :aria-label="`${model.channelLabel}: ${channel?.label ?? ''}`"
              :title="model.channelTooltip"
              :data-testid="TID.buildOverviewChannel"
            >
              <span class="truncate">{{ channel?.label }}</span>
              <ChevronDown :size="13" class="shrink-0" aria-hidden="true" />
            </Button>
          </template>
          <DropdownMenuLabel
            class="px-3 pt-1.5 pb-1 text-[11px]/4 font-medium tracking-[0.09em] text-subtle-foreground uppercase"
          >
            {{ model.channelLabel }}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            :model-value="pickedChannel"
            class="flex flex-col gap-0.5"
            @update:model-value="pickedChannel = String($event)"
          >
            <MenuRadioItem
              v-for="c in model.channels"
              :key="c.value"
              :value="c.value"
              class="h-auto items-start py-1.5 data-[state=checked]:bg-muted data-[state=checked]:data-highlighted:bg-muted"
              :data-testid="TID.buildOverviewChannelOption(c.value)"
            >
              <span class="flex min-w-0 flex-col text-left">
                <span>{{ c.label }}</span>
                <span v-if="c.description" class="text-[12px]/4 text-muted-foreground">{{
                  c.description
                }}</span>
              </span>
            </MenuRadioItem>
          </DropdownMenuRadioGroup>
        </Menu>

        <div
          class="mt-auto flex min-w-0 items-end gap-2.5 pt-3 text-[12px]/4 text-muted-foreground"
          data-testid="build-overview-update"
        >
          <template v-if="updateAction">
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-foreground" :title="updateHeadline">{{
                updateHeadline
              }}</span>
              <span class="truncate" :title="updateNote">{{ updateNote }}</span>
            </span>
            <SplitButton
              v-model:open="updateMenuOpen"
              class="ml-auto shrink-0"
              :label="updateAction.label"
              :menu-label="t('buildOverview.moreUpdateOptions')"
              :tooltip="updateAction.tooltip"
              :main-testid="TID.updateActionButton(updateAction.id)"
              :menu-testid="TID.buildOverviewUpdateMenu"
              @run="run(updateAction)"
            >
              <ArrowUpCircle :size="14" aria-hidden="true" />
              <span>{{ t('buildOverview.update') }}</span>
              <template v-if="copyUpdateAction" #menu>
                <Tooltip :text="copyUpdateAction.tooltip" side="left">
                  <MenuItem
                    class="w-full pr-5"
                    :disabled="copyUpdateAction.enabled === false"
                    :data-testid="TID.updateActionButton(copyUpdateAction.id)"
                    @select="run(copyUpdateAction)"
                  >
                    {{ copyUpdateAction.label }}
                  </MenuItem>
                </Tooltip>
              </template>
            </SplitButton>
          </template>
          <template v-else-if="switching">
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-foreground" :title="switchHeadline">{{
                switchHeadline
              }}</span>
              <span v-if="!switchAction" class="truncate" :title="t('channelCards.noInfo')">{{
                t('channelCards.noInfo')
              }}</span>
            </span>
            <Button
              v-if="switchAction"
              type="button"
              variant="secondary"
              size="md"
              class="ml-auto shrink-0 px-3 text-[13px]/5"
              :disabled="switchAction.enabled === false"
              :data-testid="TID.updateActionButton(switchAction.id)"
              @click="run(switchAction)"
            >
              {{ switchAction.label }}
            </Button>
          </template>
          <template v-else>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-foreground">{{
                channel?.latestVersion ? t('channelCards.upToDate') : t('buildOverview.notChecked')
              }}</span>
              <span v-if="channel?.enriching" class="inline-flex items-center gap-1 truncate">
                <Loader2
                  :size="12"
                  class="flex-none animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                {{ t('channelCards.computingCommitsAhead') }}
              </span>
              <span v-else-if="checkedText" class="truncate" :title="checkedText">{{
                checkedText
              }}</span>
            </span>
            <Button
              v-if="model.checkAction"
              type="button"
              variant="muted-textonly"
              size="md"
              class="ml-auto shrink-0 gap-1.5 px-2.5 text-[12px]/4"
              :disabled="model.checkAction.enabled === false || checkRunning"
              :title="model.checkAction.tooltip"
              :data-testid="TID.updateActionButton(model.checkAction.id)"
              @click="run(model.checkAction)"
            >
              <Loader2
                v-if="checkRunning"
                :size="13"
                class="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              {{ model.checkAction.label }}
            </Button>
          </template>
        </div>
      </section>

      <div class="build-overview-facts grid grid-cols-3 gap-2.5 self-start">
        <section
          class="build-overview-card flex min-w-0 flex-col gap-1 rounded-[14px] bg-card px-[18px] py-4"
          aria-labelledby="build-overview-pytorch"
          data-testid="build-overview-pytorch"
        >
          <span id="build-overview-pytorch" class="text-[12px]/4 text-muted-foreground">{{
            model.torch?.label ?? t('buildOverview.pytorch')
          }}</span>
          <span
            class="truncate text-[22px]/7 font-semibold tracking-[-0.01em] text-foreground tabular-nums"
            >{{ torchVersion }}</span
          >
          <div
            class="mt-auto flex min-w-0 items-center justify-between gap-2"
            :class="torchGroups.length > 0 && '-mr-2'"
          >
            <span
              class="min-w-0 truncate text-[12px]/4 text-muted-foreground"
              :title="model.facts.variant?.value"
              data-testid="build-overview-variant"
              >{{ model.facts.variant?.value }}</span
            >
            <Menu
              v-if="torchGroups.length > 0"
              :modal="false"
              align="end"
              :side-offset="6"
              class="z-20 max-w-80 min-w-64"
              :aria-label="model.torch?.label"
            >
              <template #trigger>
                <Button
                  type="button"
                  variant="muted-textonly"
                  size="sm"
                  class="-my-1.5 h-7 shrink-0 gap-0.5 text-[12px]/4 font-normal data-[state=open]:bg-accent data-[state=open]:text-foreground"
                  :data-testid="TID.buildOverviewPytorchChange"
                >
                  {{ t('buildOverview.change') }}
                  <ChevronDown :size="13" aria-hidden="true" />
                </Button>
              </template>
              <template v-for="group in torchGroups" :key="group.id">
                <DropdownMenuLabel
                  v-if="showTorchGroupLabels || group === torchGroups[0]"
                  class="px-3 pt-1.5 pb-1 text-[11px]/4 font-medium tracking-[0.09em] text-subtle-foreground uppercase"
                >
                  {{ showTorchGroupLabels ? group.label : model.torch?.label }}
                </DropdownMenuLabel>
                <div class="flex flex-col gap-0.5">
                  <template v-for="v in group.versions" :key="v.value">
                    <MenuSub v-if="v.actions.length > 0">
                      <MenuSubTrigger
                        class="h-auto items-start py-1.5"
                        :data-testid="TID.buildOverviewPytorchOption(v.value)"
                      >
                        <span class="flex min-w-0 flex-col text-left">
                          <span>{{ v.version }}</span>
                          <span
                            v-if="v.description"
                            class="line-clamp-2 text-[12px]/4 text-muted-foreground"
                            :title="v.description"
                            >{{ v.description }}</span
                          >
                        </span>
                      </MenuSubTrigger>
                      <MenuSubContent class="z-20 min-w-48">
                        <Tooltip v-for="a in v.actions" :key="a.id" :text="a.tooltip" side="right">
                          <MenuItem
                            class="w-full pr-5"
                            :disabled="a.enabled === false"
                            :data-testid="TID.updateActionButton(a.id)"
                            @select="run(a)"
                          >
                            {{ a.label }}
                          </MenuItem>
                        </Tooltip>
                      </MenuSubContent>
                    </MenuSub>
                    <MenuItem
                      v-else
                      class="h-auto items-start py-1.5"
                      :class="v.current && 'bg-muted data-highlighted:bg-muted'"
                      :data-testid="TID.buildOverviewPytorchOption(v.value)"
                      @select.prevent
                    >
                      <span class="flex min-w-0 flex-col text-left">
                        <span>{{ v.version }}</span>
                        <span v-if="v.current" class="text-[12px]/4 text-muted-foreground">{{
                          t('buildOverview.inUse')
                        }}</span>
                        <span
                          v-if="v.description"
                          class="line-clamp-2 text-[12px]/4 text-muted-foreground"
                          :title="v.description"
                          >{{ v.description }}</span
                        >
                      </span>
                    </MenuItem>
                  </template>
                </div>
              </template>
            </Menu>
          </div>
        </section>

        <section
          class="build-overview-card flex min-w-0 flex-col gap-1 rounded-[14px] bg-card px-[18px] py-4"
          aria-labelledby="build-overview-disk"
          data-testid="build-overview-disk"
        >
          <span id="build-overview-disk" class="text-[12px]/4 text-muted-foreground">{{
            t('buildOverview.onDisk')
          }}</span>
          <span
            class="truncate text-[22px]/7 font-semibold tracking-[-0.01em] text-foreground tabular-nums"
            >{{ diskUsage ?? '—' }}</span
          >
          <span v-if="diskFree" class="truncate text-[12px]/4 text-muted-foreground">{{
            t('buildOverview.free', { size: diskFree })
          }}</span>
        </section>

        <section
          class="build-overview-card flex min-w-0 flex-col gap-1 rounded-[14px] bg-card px-[18px] py-4"
          aria-labelledby="build-overview-python"
          data-testid="build-overview-python"
        >
          <span id="build-overview-python" class="text-[12px]/4 text-muted-foreground">{{
            t('buildOverview.python')
          }}</span>
          <span
            class="truncate text-[22px]/7 font-semibold tracking-[-0.01em] text-foreground tabular-nums"
            >{{ model.facts.python?.value ?? '—' }}</span
          >
          <span class="truncate text-[12px]/4 text-muted-foreground">{{
            installation.sourceLabel
          }}</span>
        </section>

        <section
          class="build-overview-card col-span-full flex min-w-0 flex-col justify-center rounded-[14px] bg-card px-[18px] py-2"
          :aria-label="t('buildOverview.details')"
          data-testid="build-overview-facts"
        >
          <div
            v-if="location"
            class="grid min-h-9 grid-cols-[110px_minmax(0,1fr)] items-center gap-4"
            data-testid="build-overview-location"
          >
            <span class="text-[12px]/4 text-muted-foreground">{{
              model.facts.location?.label
            }}</span>
            <span class="flex min-w-0 items-center gap-0.5">
              <span
                class="mr-auto min-w-0 truncate pr-3 font-mono text-[12px]/4 text-foreground"
                :title="location"
                >{{ location }}</span
              >
              <Button
                type="button"
                variant="muted-textonly"
                size="icon"
                class="size-7 shrink-0"
                :aria-label="t('buildOverview.openFolder')"
                :title="t('buildOverview.openFolder')"
                data-testid="build-overview-open-folder"
                @click="openLocation"
              >
                <FolderOpen :size="14" aria-hidden="true" />
              </Button>
              <BaseCopyButton :value="location" :aria-label="t('buildOverview.copyPath')" />
            </span>
          </div>
          <div
            v-if="lineage"
            class="grid min-h-9 grid-cols-[110px_minmax(0,1fr)] items-center gap-4"
            data-testid="build-overview-lineage"
          >
            <span class="text-[12px]/4 text-muted-foreground">{{ lineage.label }}</span>
            <span class="truncate text-[13px]/5 text-foreground" :title="lineage.value">{{
              lineage.value
            }}</span>
          </div>
          <div
            v-if="port"
            class="grid min-h-9 grid-cols-[110px_minmax(0,1fr)] items-center gap-4"
            data-testid="build-overview-port"
          >
            <span class="text-[12px]/4 text-muted-foreground">{{ port.label }}</span>
            <span class="text-[13px]/5 text-foreground tabular-nums">{{ port.value }}</span>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
