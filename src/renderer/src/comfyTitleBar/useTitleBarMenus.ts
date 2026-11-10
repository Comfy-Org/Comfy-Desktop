import {
  computed,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  type ComputedRef,
  type Ref,
  type ShallowRef
} from 'vue'
import { useI18n } from 'vue-i18n'

interface MenuAnchor {
  x: number
  y: number
}

interface DownloadsTrayEntry {
  url: string
  filename: string
  directory?: string
  progress: number
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error' | 'cancelled'
  error?: string
}

interface DownloadsTrayState {
  active: DownloadsTrayEntry[]
  recent: DownloadsTrayEntry[]
}

type TitleMenuKind = 'menu' | 'downloads' | 'instance-picker'

interface TitleBarMenusBridge {
  openFileMenu: (anchor: MenuAnchor) => void
  dismissFileMenu: () => void
  clickDownloadsTray: (anchor: MenuAnchor) => void
  clickInstallPill: (anchor: MenuAnchor) => void
  onMenuOpened: (cb: (info: { menu: TitleMenuKind }) => void) => () => void
  onMenuClosed: (cb: (info: { menu: TitleMenuKind }) => void) => () => void
  onDownloadsChanged: (cb: (state: DownloadsTrayState) => void) => () => void
}

interface UseTitleBarMenusOpts {
  bridge: TitleBarMenusBridge | undefined
  hideTip: () => void
  fileBtnRef: Readonly<ShallowRef<HTMLElement | null>>
  downloadsBtnRef: Readonly<ShallowRef<HTMLElement | null>>
  installPillRef: Readonly<ShallowRef<HTMLElement | null>>
}

interface TitleBarMenusApi {
  isMenuOpen: Ref<boolean>
  isDownloadsOpen: Ref<boolean>
  downloadsState: Ref<DownloadsTrayState>
  downloadsActiveCount: ComputedRef<number>
  unseenFinishedCount: ComputedRef<number>
  unseenErrorCount: ComputedRef<number>
  downloadsTrayLabel: ComputedRef<string>
  downloadsStartedAt: Ref<number>
  isInstancePickerOpen: Ref<boolean>
  handleFileMenu: () => void
  handleDownloadsTray: () => void
  handleInstallPill: () => void
}

export function useTitleBarMenus(opts: UseTitleBarMenusOpts): TitleBarMenusApi {
  const { t } = useI18n()

  const MENU_REOPEN_GUARD_MS = 100
  const menuClosedAt: Record<TitleMenuKind, number> = {
    menu: 0,
    downloads: 0,
    'instance-picker': 0
  }

  const isMenuOpen = ref(false)
  const isDownloadsOpen = ref(false)
  const isInstancePickerOpen = ref(false)
  const downloadsState = ref<DownloadsTrayState>({ active: [], recent: [] })
  const seenUrls = reactive(new Set<string>())
  const previousActiveUrls = new Set<string>()
  let firstDownloadsPush = true
  const downloadsStartedAt = ref(0)

  const downloadsActiveCount = computed(() => downloadsState.value.active.length)
  const unseenFinishedCount = computed(
    () => downloadsState.value.recent.filter((d) => !seenUrls.has(d.url)).length
  )
  const unseenErrorCount = computed(
    () =>
      downloadsState.value.recent.filter((d) => d.status === 'error' && !seenUrls.has(d.url)).length
  )
  const downloadsTrayLabel = computed<string>(() => {
    const active = downloadsActiveCount.value
    const errors = unseenErrorCount.value
    if (active > 0) {
      const inProgress = t('titleBar.downloadsInProgress', { n: active }, active)
      if (errors > 0) {
        return `${inProgress} · ${t('titleBar.downloadsFailedUnseen', { n: errors }, errors)}`
      }
      return inProgress
    }
    if (errors > 0) return t('titleBar.downloadsFailedUnseen', { n: errors }, errors)
    const unseen = unseenFinishedCount.value
    if (unseen > 0) return t('titleBar.downloadsCompleteUnseen', { n: unseen }, unseen)
    return t('titleBar.downloads')
  })

  function anchorBelow(el: HTMLElement | null | undefined): MenuAnchor {
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return { x: Math.round(rect.left), y: Math.round(rect.bottom) }
  }

  function anchorDownloadsBelow(el: HTMLElement | null | undefined): MenuAnchor {
    const base = anchorBelow(el)
    const DOWNLOADS_POPUP_GAP_BELOW_TRIGGER_PX = 12
    return { x: base.x, y: base.y + DOWNLOADS_POPUP_GAP_BELOW_TRIGGER_PX }
  }

  const isFileMenuOpen = computed(
    () => isMenuOpen.value && !isDownloadsOpen.value && !isInstancePickerOpen.value
  )

  function handleFileMenu(): void {
    opts.hideTip()
    if (isFileMenuOpen.value) {
      opts.bridge?.dismissFileMenu()
      return
    }
    if (Date.now() - menuClosedAt.menu < MENU_REOPEN_GUARD_MS) return
    opts.bridge?.openFileMenu(anchorBelow(opts.fileBtnRef.value))
  }

  function handleDownloadsTray(): void {
    opts.hideTip()
    opts.bridge?.clickDownloadsTray(anchorDownloadsBelow(opts.downloadsBtnRef.value))
  }

  function handleInstallPill(): void {
    opts.hideTip()
    opts.bridge?.clickInstallPill(anchorDownloadsBelow(opts.installPillRef.value))
  }

  function acknowledgeRecent(): void {
    for (const d of downloadsState.value.recent) seenUrls.add(d.url)
  }

  function hasNewActive(next: DownloadsTrayState): boolean {
    for (const d of next.active) {
      if (!previousActiveUrls.has(d.url)) return true
    }
    return false
  }

  function ingestDownloadsState(next: DownloadsTrayState): void {
    if (firstDownloadsPush) {
      for (const d of next.active) previousActiveUrls.add(d.url)
      for (const d of next.recent) seenUrls.add(d.url)
      firstDownloadsPush = false
      downloadsState.value = next
      return
    }
    if (hasNewActive(next)) downloadsStartedAt.value = Date.now()
    previousActiveUrls.clear()
    for (const d of next.active) previousActiveUrls.add(d.url)
    const stillRecent = new Set(next.recent.map((d) => d.url))
    for (const url of [...seenUrls]) {
      if (!stillRecent.has(url)) seenUrls.delete(url)
    }
    downloadsState.value = next
  }

  let unsubMenuOpened: (() => void) | undefined
  let unsubMenuClosed: (() => void) | undefined
  let unsubDownloads: (() => void) | undefined

  onMounted(() => {
    if (!opts.bridge) return
    unsubMenuOpened = opts.bridge.onMenuOpened((info) => {
      isMenuOpen.value = true
      if (info.menu === 'downloads') {
        isDownloadsOpen.value = true
        acknowledgeRecent()
      } else if (info.menu === 'instance-picker') {
        isInstancePickerOpen.value = true
      }
    })
    unsubMenuClosed = opts.bridge.onMenuClosed(({ menu }) => {
      menuClosedAt[menu] = Date.now()
      isMenuOpen.value = false
      if (menu === 'downloads') isDownloadsOpen.value = false
      if (menu === 'instance-picker') isInstancePickerOpen.value = false
    })
    unsubDownloads = opts.bridge.onDownloadsChanged(ingestDownloadsState)
  })

  onUnmounted(() => {
    unsubMenuOpened?.()
    unsubMenuClosed?.()
    unsubDownloads?.()
  })

  return {
    isMenuOpen,
    isDownloadsOpen,
    isInstancePickerOpen,
    downloadsState,
    downloadsActiveCount,
    unseenFinishedCount,
    unseenErrorCount,
    downloadsTrayLabel,
    downloadsStartedAt,
    handleFileMenu,
    handleDownloadsTray,
    handleInstallPill
  }
}
