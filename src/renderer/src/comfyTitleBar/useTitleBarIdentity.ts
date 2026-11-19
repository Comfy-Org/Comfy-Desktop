import { computed, onMounted, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { installTypeMetaFor } from '../lib/installTypeIcon'
import {
  isChromeLockedMode,
  isFirstUseLockdownMode,
  isLoadingLockdownMode,
  type FirstUseMode
} from '../../../shared/firstUseMode'
import { isColorLight } from '../lib/colorScheme'

interface InstallTypeMeta {
  icon: ReturnType<typeof installTypeMetaFor>['icon']
  labelKey: ReturnType<typeof installTypeMetaFor>['labelKey']
}

interface TitleBarIdentityBridge {
  onTitleChanged: (cb: (title: string) => void) => () => void
  onSourceCategoryChanged: (cb: (category: string | null) => void) => () => void
  onThemeChanged: (cb: (theme: { bg: string; text: string }) => void) => () => void
  onFullscreenChanged: (cb: (fullscreen: boolean) => void) => () => void
  onFirstUseModeChanged: (cb: (mode: FirstUseMode) => void) => () => void
  onPreviewModeChanged: (cb: (preview: boolean) => void) => () => void
}

interface UseTitleBarIdentityOpts {
  bridge: TitleBarIdentityBridge | undefined
  isInstallLess: Ref<boolean>
}

interface TitleBarIdentityApi {
  installLabel: Ref<string>
  sourceCategory: Ref<string | null>
  themeBg: Ref<string | null>
  themeText: Ref<string | null>
  isFullscreen: Ref<boolean>
  firstUseMode: Ref<FirstUseMode>
  isPreviewMode: Ref<boolean>
  isConsentLockdown: ComputedRef<boolean>
  isFirstUseLockdown: ComputedRef<boolean>
  isLoadingLockdown: ComputedRef<boolean>
  isChromeLocked: ComputedRef<boolean>
  installTypeMeta: ComputedRef<InstallTypeMeta>
  installTypeLabel: ComputedRef<string>
  showInstallTypeIcon: ComputedRef<boolean>
  showBrandMark: ComputedRef<boolean>
  isLight: ComputedRef<boolean>
}

export function useTitleBarIdentity(opts: UseTitleBarIdentityOpts): TitleBarIdentityApi {
  const { t } = useI18n()

  const installLabel = ref('ComfyUI')
  const sourceCategory = ref<string | null>(null)
  const themeBg = ref<string | null>(null)
  const themeText = ref<string | null>(null)
  const isFullscreen = ref(false)
  const firstUseMode = ref<FirstUseMode>('none')
  const isPreviewMode = ref(false)

  const isConsentLockdown = computed(() => firstUseMode.value === 'consent-lockdown')
  const isFirstUseLockdown = computed(() => isFirstUseLockdownMode(firstUseMode.value))
  const isLoadingLockdown = computed(() => isLoadingLockdownMode(firstUseMode.value))
  const isChromeLocked = computed(() => isChromeLockedMode(firstUseMode.value))

  const installTypeMeta = computed<InstallTypeMeta>(() => installTypeMetaFor(sourceCategory.value))

  const installTypeLabel = computed(() =>
    t(installTypeMeta.value.labelKey, t('installType.unknown'))
  )

  const showInstallTypeIcon = computed(
    () => (!opts.isInstallLess.value || isPreviewMode.value) && sourceCategory.value !== null
  )

  const showBrandMark = computed(() => opts.isInstallLess.value && !isPreviewMode.value)

  const isLight = computed(() => isColorLight(themeBg.value))

  let unsubTitle: (() => void) | undefined
  let unsubSourceCategory: (() => void) | undefined
  let unsubTheme: (() => void) | undefined
  let unsubFullscreen: (() => void) | undefined
  let unsubFirstUseMode: (() => void) | undefined
  let unsubPreviewMode: (() => void) | undefined

  onMounted(() => {
    if (!opts.bridge) return
    unsubTitle = opts.bridge.onTitleChanged((title) => {
      installLabel.value = title || 'ComfyUI'
    })
    unsubSourceCategory = opts.bridge.onSourceCategoryChanged((category) => {
      sourceCategory.value = category
    })
    unsubTheme = opts.bridge.onThemeChanged(({ bg, text }) => {
      themeBg.value = bg
      themeText.value = text
    })
    unsubFullscreen = opts.bridge.onFullscreenChanged((fullscreen) => {
      isFullscreen.value = fullscreen
    })
    unsubFirstUseMode = opts.bridge.onFirstUseModeChanged((mode) => {
      firstUseMode.value = mode
    })
    unsubPreviewMode = opts.bridge.onPreviewModeChanged((preview) => {
      isPreviewMode.value = preview
    })
  })

  onUnmounted(() => {
    unsubTitle?.()
    unsubSourceCategory?.()
    unsubTheme?.()
    unsubFullscreen?.()
    unsubFirstUseMode?.()
    unsubPreviewMode?.()
  })

  return {
    installLabel,
    sourceCategory,
    themeBg,
    themeText,
    isFullscreen,
    firstUseMode,
    isPreviewMode,
    isConsentLockdown,
    isFirstUseLockdown,
    isLoadingLockdown,
    isChromeLocked,
    installTypeMeta,
    installTypeLabel,
    showInstallTypeIcon,
    showBrandMark,
    isLight
  }
}
